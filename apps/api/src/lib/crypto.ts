import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

// scrypt parameters (N=2^15, r=8, p=1) — memory-hard, no native dependency.
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** URL-safe random token; only its SHA-256 hash is stored server-side. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A precomputed hash so failed logins for unknown emails take similar time. */
export const DUMMY_PASSWORD_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

// ── AES-256-GCM Authenticated Encryption for sensitive credentials at rest ──

function getEncryptionKey(overrideKey?: string): Buffer {
  const seed = overrideKey || process.env.ENCRYPTION_KEY || process.env.QR_TOKEN_SECRET || "default-iic-platform-secret-key-at-least-32-chars";
  return createHash("sha256").update(seed).digest();
}

/**
 * Encrypt sensitive tokens (e.g. GitHub personal access tokens or webhook secrets)
 * at rest using AES-256-GCM authenticated encryption.
 * Output format: enc$v1$<iv_base64url>$<authTag_base64url>$<ciphertext_base64url>
 */
export function encryptCredential(plaintext: string, secretKey?: string): string {
  if (!plaintext) return "";
  const key = getEncryptionKey(secretKey);
  const iv = randomBytes(12); // 96-bit IV recommended for AES-GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc$v1$${iv.toString("base64url")}$${tag.toString("base64url")}$${encrypted.toString("base64url")}`;
}

/**
 * Decrypt credentials encrypted with AES-256-GCM.
 * Validates integrity via GCM auth tag; throws if tampered, corrupted or wrong key.
 */
export function decryptCredential(ciphertext: string, secretKey?: string): string {
  if (!ciphertext) return "";
  const parts = ciphertext.split("$");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("Invalid encrypted credential format");
  }
  const ivB64 = parts[2];
  const tagB64 = parts[3];
  const encryptedB64 = parts[4];
  if (!ivB64 || !tagB64 || !encryptedB64) {
    throw new Error("Invalid encrypted credential format");
  }
  const key = getEncryptionKey(secretKey);
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const encrypted = Buffer.from(encryptedB64, "base64url");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Verify GitHub webhook HMAC-SHA256 signature (X-Hub-Signature-256: sha256=...).
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifyGitHubWebhookSignature(
  payload: string | Buffer,
  secret: string,
  signatureHeader?: string | null,
): boolean {
  if (!signatureHeader || !secret) return false;
  const match = signatureHeader.match(/^sha256=([a-f0-9]{64})$/i);
  if (!match) return false;
  const rawHash = match[1];
  if (!rawHash) return false;
  const expectedHash = rawHash.toLowerCase();

  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  const computedHash = hmac.digest("hex").toLowerCase();

  const expectedBuf = Buffer.from(expectedHash, "hex");
  const computedBuf = Buffer.from(computedHash, "hex");

  if (expectedBuf.length !== computedBuf.length) return false;
  return timingSafeEqual(expectedBuf, computedBuf);
}
