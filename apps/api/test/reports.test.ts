import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db.js";
import { BrowserPool, closeBrowserPool, resolveChromePath } from "../src/reports/browser-pool.js";
import { processNextReport } from "../src/reports/queue.js";
import { reportPath } from "../src/reports/storage.js";
import { loginAs, resetDb, world } from "./helpers.js";

type World = Awaited<ReturnType<typeof world>>;
let w: World;
const hasChrome = !!resolveChromePath();
const hasPdftotext = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

beforeEach(async () => {
  await resetDb();
  w = await world();
});
afterAll(async () => {
  await closeBrowserPool();
});

/** Real activity for project Alpha so the report has something to say. */
async function seedActivity() {
  const now = new Date();
  await prisma.task.createMany({
    data: [
      { projectId: w.project.id, title: "Build prototype", status: "DONE", completedAt: now, createdById: w.lead.id },
      { projectId: w.project.id, title: "Customer interviews", status: "IN_PROGRESS", dueDate: new Date(now.getTime() - 3 * 86400_000), createdById: w.lead.id },
    ],
  });
  await prisma.milestone.create({ data: { projectId: w.project.id, title: "POC demo", stage: "POC", status: "APPROVED", approvedAt: now } });
  const session = await prisma.attendanceSession.create({
    data: { name: "Design thinking workshop", startsAt: now, endsAt: new Date(now.getTime() + 3600_000), eligibility: "PROJECT", projectId: w.project.id, status: "CLOSED", createdById: w.admin.id },
  });
  await prisma.attendanceRecord.create({ data: { sessionId: session.id, userId: w.lead.id, method: "QR" } });
  const comp = await prisma.competition.create({ data: { name: "Smart India Hackathon", organizer: "AICTE", endDate: now, createdById: w.admin.id } });
  await prisma.competitionRegistration.create({ data: { competitionId: comp.id, projectId: w.project.id, outcome: "WINNER", outcomeVerifiedAt: now, outcomeVerifiedById: w.mentor.id } });
  await prisma.fundingAward.createMany({
    data: [
      { projectId: w.project.id, source: "COMPETITION", title: "SIH prize", amount: new Prisma.Decimal("100000.00"), currency: "INR", verification: "VERIFIED", verifiedById: w.mentor.id, verifiedAt: now, awardedAt: now, createdById: w.lead.id },
      { projectId: w.project.id, source: "GRANT", title: "Pending grant", amount: new Prisma.Decimal("2500.75"), currency: "USD", verification: "ESTIMATED", awardedAt: now, createdById: w.lead.id },
    ],
  });
}

const today = new Date().toISOString().slice(0, 10);

describe("report authorization", () => {
  it("only staff can request reports; mentors only for their projects; executive summary is admin-only", async () => {
    const lead = await loginAs(w.lead.email);
    expect((await lead.post("/api/reports").send({ type: "PROJECT", projectId: w.project.id })).status).toBe(403);
    expect((await lead.get("/api/reports")).status).toBe(403);
    const mentor = await loginAs(w.mentor.email);
    expect((await mentor.post("/api/reports").send({ type: "PROJECT", projectId: w.otherProject.id })).status).toBe(404);
    expect((await mentor.post("/api/reports").send({ type: "EXECUTIVE_SUMMARY", periodStart: "2026-01-01", periodEnd: today })).status).toBe(403);
    expect((await mentor.post("/api/reports").send({ type: "TERM" })).status).toBe(400); // period required
    expect((await mentor.post("/api/reports").send({ type: "TERM", periodStart: "2026-05-01", periodEnd: "2026-01-01" })).status).toBe(400);
    const ok = await mentor.post("/api/reports").send({ type: "PROJECT", projectId: w.project.id });
    expect(ok.status).toBe(202);
    expect(ok.body.report.status).toBe("QUEUED");
    expect(ok.body.report.storageKey).toBeUndefined();
    // Another mentor cannot see or download it.
    const other = await loginAs(w.otherMentor.email);
    expect((await other.get(`/api/reports/${ok.body.report.id}`)).status).toBe(404);
    expect((await other.get(`/api/reports/${ok.body.report.id}/download`)).status).toBe(404);
    expect((await other.get("/api/reports")).body.reports).toHaveLength(0);
  });

  it("caps open jobs per user", async () => {
    const admin = await loginAs(w.admin.email);
    for (let i = 0; i < 5; i++) expect((await admin.post("/api/reports").send({ type: "FUNDING", periodStart: "2026-01-01", periodEnd: today })).status).toBe(202);
    expect((await admin.post("/api/reports").send({ type: "FUNDING", periodStart: "2026-01-01", periodEnd: today })).status).toBe(429);
  });
});

describe.skipIf(!hasChrome)("PDF generation end to end", () => {
  it("renders a project report from real data, stores it privately and serves it only to authorized users", async () => {
    await seedActivity();
    const mentor = await loginAs(w.mentor.email);
    const { report } = (await mentor.post("/api/reports").send({ type: "PROJECT", projectId: w.project.id })).body;
    expect((await mentor.get(`/api/reports/${report.id}/download`)).status).toBe(409); // not ready

    expect(await processNextReport()).toBe(true);
    const row = await prisma.generatedReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(row).toMatchObject({ status: "COMPLETED", attempts: 1, error: null });
    expect(row.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(row.storageKey).toMatch(/^reports\/[0-9a-f-]{36}\.pdf$/);

    const res = await mentor.get(`/api/reports/${report.id}/download`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename=".+\.pdf"$/);
    expect(res.headers["cache-control"]).toContain("no-store");
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    // Keep a copy for inspection and check the text content.
    const outDir = mkdtempSync(path.join(tmpdir(), "iic-report-"));
    const file = path.join(outDir, "project-report.pdf");
    writeFileSync(file, pdf);
    process.env.LAST_REPORT_PDF = file;
    if (hasPdftotext) {
      const text = execFileSync("pdftotext", ["-layout", file, "-"]).toString();
      for (const needle of ["Project report", "Alpha", "Smart India Hackathon", "INR 100,000.00", "USD 2,500.75", "Customer interviews", "Design thinking workshop", "Approval & sign-off", "Page 1 of"]) {
        expect(text, needle).toContain(needle);
      }
      expect(text.toLowerCase()).toContain("verified funding");
      const info = execFileSync("pdfinfo", [file]).toString();
      expect(info).toMatch(/Page size:\s+595\.\d+ x 841\.\d+ pts \(A4\)/);
    }

    // Other users: lead (not staff) 403, other mentor 404.
    expect((await (await loginAs(w.lead.email)).get(`/api/reports/${report.id}/download`)).status).toBe(403);
    expect((await (await loginAs(w.otherMentor.email)).get(`/api/reports/${report.id}/download`)).status).toBe(404);

    // Mentor reassigned away from the project loses access to the file.
    await prisma.project.update({ where: { id: w.project.id }, data: { mentorId: w.otherMentor.id } });
    expect((await mentor.get(`/api/reports/${report.id}/download`)).status).toBe(404);

    // Expired reports are refused.
    const admin = await loginAs(w.admin.email);
    await prisma.generatedReport.update({ where: { id: report.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await admin.get(`/api/reports/${report.id}/download`)).status).toBe(410);

    // Deleting removes the file.
    const filePath = reportPath(row.storageKey!);
    expect(existsSync(filePath)).toBe(true);
    expect((await admin.delete(`/api/reports/${report.id}`)).status).toBe(204);
    expect(existsSync(filePath)).toBe(false);
  });

  it("an empty period yields an explicit empty state, never fabricated figures", async () => {
    const admin = await loginAs(w.admin.email);
    const { report } = (await admin.post("/api/reports").send({ type: "FUNDING", periodStart: "2020-01-01", periodEnd: "2020-03-31" })).body;
    await processNextReport();
    const row = await prisma.generatedReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(row.status).toBe("COMPLETED");
    if (hasPdftotext) {
      const text = execFileSync("pdftotext", ["-layout", reportPath(row.storageKey!), "-"]).toString();
      expect(text).toContain("No funding was recorded in this period.");
      expect(text).not.toMatch(/INR|USD/);
    }
  });

  it("Discord engagement is a clearly labelled pending-integration stub", async () => {
    const admin = await loginAs(w.admin.email);
    const { report } = (await admin.post("/api/reports").send({ type: "DISCORD_ENGAGEMENT", periodStart: "2026-01-01", periodEnd: today })).body;
    await processNextReport();
    const row = await prisma.generatedReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(row.status).toBe("COMPLETED");
    if (hasPdftotext) expect(execFileSync("pdftotext", [reportPath(row.storageKey!), "-"]).toString()).toContain("Pending integration");
  });

  it("every report type renders", async () => {
    await seedActivity();
    const admin = await loginAs(w.admin.email);
    const cohort = await prisma.cohort.create({ data: { name: "C1", term: "2026 Odd" } });
    await prisma.project.update({ where: { id: w.project.id }, data: { cohortId: cohort.id } });
    const period = { periodStart: "2026-01-01", periodEnd: today };
    const bodies = [
      { type: "COHORT", cohortId: cohort.id }, { type: "TERM", ...period }, { type: "ATTENDANCE_COMPLIANCE", ...period },
      { type: "MILESTONE_PROGRESSION", ...period }, { type: "COMPETITION_OUTCOMES", ...period },
    ];
    const ids: string[] = [];
    for (const b of bodies) ids.push((await admin.post("/api/reports").send(b)).body.report.id);
    // Second batch after the per-user cap frees up.
    while (await processNextReport()) { /* drain */ }
    const exec = (await admin.post("/api/reports").send({ type: "EXECUTIVE_SUMMARY", ...period })).body.report.id as string;
    while (await processNextReport()) { /* drain */ }
    const rows = await prisma.generatedReport.findMany({ where: { id: { in: [...ids, exec] } } });
    expect(rows.map((r) => [r.type, r.status, r.error])).toEqual(expect.arrayContaining(rows.map((r) => [r.type, "COMPLETED", null])));
    expect(rows).toHaveLength(6);
  });
});

describe("job failure handling", () => {
  it("permanent failures fail immediately and are logged; failed jobs can be retried", async () => {
    const admin = await loginAs(w.admin.email);
    const { report } = (await admin.post("/api/reports").send({ type: "PROJECT", projectId: w.project.id })).body;
    // Requester loses access before the worker runs.
    await prisma.user.update({ where: { id: w.admin.id }, data: { status: "DISABLED" } });
    await processNextReport();
    const row = await prisma.generatedReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(row.status).toBe("FAILED");
    expect(row.error).toMatch(/no longer active/);
    const log = await prisma.integrationLog.findFirstOrThrow({ where: { integration: "REPORTS" } });
    expect(log.level).toBe("ERROR");

    await prisma.user.update({ where: { id: w.admin.id }, data: { status: "ACTIVE" } });
    const again = await loginAs(w.admin.email);
    const retried = await again.post(`/api/reports/${report.id}/retry`);
    expect(retried.status).toBe(200);
    expect(retried.body.report).toMatchObject({ status: "QUEUED", attempts: 0 });
  });

  it("transient failures are re-queued with backoff until the attempt limit", async () => {
    const admin = await loginAs(w.admin.email);
    const { report } = (await admin.post("/api/reports").send({ type: "FUNDING", periodStart: "2026-01-01", periodEnd: today })).body;
    const crash = () => Promise.reject(new Error("Chromium crashed"));
    await processNextReport(crash);
    let row = await prisma.generatedReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(row).toMatchObject({ status: "QUEUED", attempts: 1, error: "Chromium crashed" });
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await processNextReport(crash)).toBe(false); // backoff not elapsed
    for (let attempt = 2; attempt <= 3; attempt++) {
      await prisma.generatedReport.update({ where: { id: report.id }, data: { nextAttemptAt: new Date(Date.now() - 1) } });
      await processNextReport(crash);
    }
    row = await prisma.generatedReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(row).toMatchObject({ status: "FAILED", attempts: 3 });
    const logs = await prisma.integrationLog.findMany({ where: { integration: "REPORTS" }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.level)).toEqual(["WARN", "WARN", "ERROR"]);
  });

  it("a missing scope is a permanent failure (no pointless retries)", async () => {
    const admin = await loginAs(w.admin.email);
    const cohort = await prisma.cohort.create({ data: { name: "Gone", term: "T" } });
    const { report } = (await admin.post("/api/reports").send({ type: "FUNDING", cohortId: cohort.id, periodStart: "2026-01-01", periodEnd: today })).body;
    await prisma.cohort.delete({ where: { id: cohort.id } });
    await processNextReport(() => Promise.reject(new Error("should not render")));
    expect(await prisma.generatedReport.findUniqueOrThrow({ where: { id: report.id } })).toMatchObject({ status: "FAILED", attempts: 1, error: "Cohort no longer exists" });
  });
});

describe.skipIf(!hasChrome)("browser pool", () => {
  it("never runs more browsers or renders than its size, and reuses browsers", async () => {
    const pool = new BrowserPool(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        pool.use(async (browser) => {
          active += 1;
          peak = Math.max(peak, active);
          const page = await browser.newPage();
          await page.close();
          await new Promise((r) => setTimeout(r, 50));
          active -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(pool.launches).toBe(2);
    expect(pool.activeBrowsers).toBe(2);
    await pool.close();
    expect(pool.activeBrowsers).toBe(0);
  });
});
