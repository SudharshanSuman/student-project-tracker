import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config } from "../config.js";

/**
 * Private file storage for uploads. Files live outside any web root under a generated
 * id (never the user-supplied name), are only served through authorised API routes,
 * and are never executed or interpreted by the server.
 */
const root = resolve(config.STORAGE_DIR, "documents");
const KEY_RE = /^[0-9a-f-]{36}$/;

function pathFor(key: string): string {
  if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
  return join(root, key);
}

export async function saveFile(data: Buffer): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const key = randomUUID();
  await writeFile(pathFor(key), data, { mode: 0o600, flag: "wx" });
  return key;
}

export function readStream(key: string) {
  return createReadStream(pathFor(key));
}

export async function deleteFile(key: string) {
  await rm(pathFor(key), { force: true });
}

// ── Upload policy ──
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type Sniff = (b: Buffer) => boolean;
const startsWith = (sig: number[]): Sniff => (b) => sig.every((v, i) => b[i] === v);
const isZip = startsWith([0x50, 0x4b, 0x03, 0x04]); // OOXML containers
const isText: Sniff = (b) => !b.subarray(0, 4096).includes(0);

/** Allowed types, keyed by declared MIME type, each with a content signature check. */
export const ALLOWED_TYPES: Record<string, { ext: string[]; sniff: Sniff }> = {
  "application/pdf": { ext: ["pdf"], sniff: startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]) },
  "image/png": { ext: ["png"], sniff: startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  "image/jpeg": { ext: ["jpg", "jpeg"], sniff: startsWith([0xff, 0xd8, 0xff]) },
  "image/webp": { ext: ["webp"], sniff: (b) => startsWith([0x52, 0x49, 0x46, 0x46])(b) && b.subarray(8, 12).toString("ascii") === "WEBP" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: ["docx"], sniff: isZip },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: ["xlsx"], sniff: isZip },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: ["pptx"], sniff: isZip },
  "text/plain": { ext: ["txt", "md"], sniff: isText },
  "text/csv": { ext: ["csv"], sniff: isText },
};

export type UploadCheck = { ok: true } | { ok: false; reason: string };

export function checkUpload(file: { originalname: string; mimetype: string; buffer: Buffer; size: number }): UploadCheck {
  if (file.size === 0) return { ok: false, reason: "The file is empty" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, reason: "The file is larger than 10 MB" };
  const rule = ALLOWED_TYPES[file.mimetype];
  if (!rule) return { ok: false, reason: "File type not allowed (PDF, images, Office documents, text or CSV only)" };
  const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "";
  if (!rule.ext.includes(ext)) return { ok: false, reason: "File extension does not match its type" };
  if (!rule.sniff(file.buffer)) return { ok: false, reason: "File content does not match its declared type" };
  return { ok: true };
}

/** Display name: strip paths and control characters, keep it short. */
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "_").trim();
  return (cleaned || "file").slice(0, 200);
}
