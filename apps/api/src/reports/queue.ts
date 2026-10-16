import type { Browser } from "puppeteer-core";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { notify } from "../lib/notify.js";
import { logger } from "../logger.js";
import { browserPool } from "./browser-pool.js";
import { buildReport, PermanentReportError } from "./data.js";
import { deleteReportFile, saveReportPdf } from "./storage.js";
import { headerFooter, renderReportHtml, type ReportDocument } from "./template.js";

/**
 * Durable, Postgres-backed job queue for report generation (no Redis needed).
 *  - Jobs are GeneratedReport rows. A worker claims one with FOR UPDATE SKIP LOCKED, so several
 *    API processes can run workers without double-processing.
 *  - Failures retry with exponential backoff up to REPORT_MAX_ATTEMPTS; permanent failures
 *    (lost access, missing project) fail immediately. Every failure is written to the report row
 *    and to IntegrationLog (REPORTS) for admins.
 *  - Jobs left RUNNING by a crashed process are re-queued on startup.
 *  - The HTTP request only inserts the row, so generation never blocks a request.
 */

const STALE_RUNNING_MS = 10 * 60_000;
const RENDER_TIMEOUT_MS = 60_000;
const POLL_MS = 3_000;

export async function renderPdf(browser: Browser, doc: ReportDocument): Promise<Uint8Array> {
  const page = await browser.newPage();
  try {
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    await page.setJavaScriptEnabled(false);
    // The document is fully self-contained; refuse every network request (no SSRF, no trackers).
    await page.setRequestInterception(true);
    page.on("request", (r) => (r.url().startsWith("data:") || r.url() === "about:blank" ? void r.continue() : void r.abort()));
    await page.setContent(renderReportHtml(doc), { waitUntil: "load", timeout: RENDER_TIMEOUT_MS });
    const { headerTemplate, footerTemplate } = headerFooter(doc);
    return await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: { top: "20mm", bottom: "18mm", left: "16mm", right: "16mm" },
      preferCSSPageSize: false,
      timeout: RENDER_TIMEOUT_MS,
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function logFailure(reportId: string, attempt: number, err: unknown, final: boolean) {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err, reportId, attempt, final }, "report generation failed");
  await prisma.integrationLog
    .create({ data: { integration: "REPORTS", level: final ? "ERROR" : "WARN", message: `Report ${reportId} attempt ${attempt} failed: ${message.slice(0, 500)}`, context: { reportId, attempt, final } } })
    .catch(() => undefined);
}

const defaultRender = (doc: ReportDocument) => browserPool().use((browser) => renderPdf(browser, doc));

/** Claims and processes one due job. Returns false when the queue is empty. `render` is injectable for tests. */
export async function processNextReport(render: (doc: ReportDocument) => Promise<Uint8Array> = defaultRender): Promise<boolean> {
  // Prisma stores UTC in timestamp-without-time-zone columns, so pass "now" as a parameter
  // instead of using Postgres now() (which follows the session time zone).
  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "GeneratedReport" SET status = 'RUNNING', attempts = attempts + 1, "startedAt" = CAST(${now} AS timestamp(3)), "updatedAt" = CAST(${now} AS timestamp(3))
    WHERE id = (
      SELECT id FROM "GeneratedReport"
      WHERE status = 'QUEUED' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= CAST(${now} AS timestamp(3)))
      ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING id`;
  const id = claimed[0]?.id;
  if (!id) return false;
  const report = await prisma.generatedReport.findUniqueOrThrow({ where: { id } });
  try {
    const doc = await buildReport(report);
    const pdf = await render(doc);
    const { storageKey, sizeBytes } = await saveReportPdf(pdf);
    const done = await prisma.generatedReport.updateMany({
      where: { id, status: "RUNNING" },
      data: { status: "COMPLETED", storageKey, sizeBytes, error: null, completedAt: new Date(), nextAttemptAt: null, expiresAt: new Date(Date.now() + config.REPORT_RETENTION_DAYS * 86400_000) },
    });
    if (done.count === 0) {
      await deleteReportFile(storageKey); // deleted/cancelled while rendering
      return true;
    }
    await notify({ userId: report.requestedById, type: "report.completed", title: `Report ready: ${report.title}`, link: "/reports", dedupeKey: `report.completed:${id}` });
  } catch (err) {
    const permanent = err instanceof PermanentReportError;
    const final = permanent || report.attempts >= config.REPORT_MAX_ATTEMPTS;
    await logFailure(id, report.attempts, err, final);
    const message = (err instanceof Error ? err.message : "Unknown error").slice(0, 500);
    await prisma.generatedReport.updateMany({
      where: { id, status: "RUNNING" },
      data: final
        ? { status: "FAILED", error: message, nextAttemptAt: null }
        : { status: "QUEUED", error: message, nextAttemptAt: new Date(Date.now() + 2 ** report.attempts * 5_000) },
    });
  }
  return true;
}

/** Re-queues jobs stranded RUNNING by a crash; removes expired PDFs. */
export async function reportMaintenance() {
  await prisma.generatedReport.updateMany({
    where: { status: "RUNNING", startedAt: { lt: new Date(Date.now() - STALE_RUNNING_MS) } },
    data: { status: "QUEUED", nextAttemptAt: null },
  });
  const expired = await prisma.generatedReport.findMany({ where: { expiresAt: { lt: new Date() }, storageKey: { not: null } }, select: { id: true, storageKey: true }, take: 100 });
  for (const r of expired) {
    await deleteReportFile(r.storageKey);
    await prisma.generatedReport.update({ where: { id: r.id }, data: { storageKey: null } });
  }
}

let timer: NodeJS.Timeout | null = null;
let maintenanceTimer: NodeJS.Timeout | null = null;
let running = 0;

/** Fills free worker slots (bounded by REPORT_CONCURRENCY = browser pool size). */
export function kickReportWorker() {
  if (!timer) return; // worker not started (tests, or REPORT_WORKER=false)
  while (running < config.REPORT_CONCURRENCY) {
    running += 1;
    void (async () => {
      try {
        while (await processNextReport(defaultRender)) {
          /* drain */
        }
      } catch (err) {
        logger.error({ err }, "report worker loop error");
      } finally {
        running -= 1;
      }
    })();
  }
}

export function startReportWorker() {
  if (timer) return;
  timer = setInterval(kickReportWorker, POLL_MS);
  maintenanceTimer = setInterval(() => void reportMaintenance().catch((err: unknown) => logger.error({ err }, "report maintenance failed")), 10 * 60_000);
  void reportMaintenance().catch((err: unknown) => logger.error({ err }, "report maintenance failed")).finally(kickReportWorker);
  logger.info({ concurrency: config.REPORT_CONCURRENCY }, "report worker started");
}

export function stopReportWorker() {
  if (timer) clearInterval(timer);
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  timer = null;
  maintenanceTimer = null;
}
