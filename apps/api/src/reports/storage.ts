import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

/**
 * Generated PDFs live under STORAGE_DIR/reports (outside any web root) with server-generated
 * names only. Writes go to a private temp file in the same directory, then an atomic rename,
 * so a download never sees a half-written PDF.
 */
export function reportsDir() {
  return path.resolve(config.STORAGE_DIR, "reports");
}

const KEY_RE = /^reports\/[0-9a-f-]{36}\.pdf$/;

export function reportPath(storageKey: string): string {
  if (!KEY_RE.test(storageKey)) throw new Error("Invalid report storage key");
  return path.join(reportsDir(), path.basename(storageKey));
}

export async function saveReportPdf(pdf: Uint8Array): Promise<{ storageKey: string; sizeBytes: number }> {
  const dir = reportsDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const name = `${randomUUID()}.pdf`;
  const tmp = path.join(dir, `.${name}.${process.pid}.tmp`);
  try {
    await writeFile(tmp, pdf, { mode: 0o600, flag: "wx" });
    await rename(tmp, path.join(dir, name));
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return { storageKey: `reports/${name}`, sizeBytes: (await stat(path.join(dir, name))).size };
}

export async function deleteReportFile(storageKey: string | null) {
  if (!storageKey) return;
  await rm(reportPath(storageKey), { force: true });
}
