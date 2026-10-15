import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/**
 * Short-lived signed attendance tokens: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 * The secret never leaves the server; the QR code only carries the opaque token.
 */
export interface QrPayload {
  v: 1;
  sid: string; // attendance session id
  jti: string; // unique token id (single-use policy)
  iat: number; // seconds
  exp: number; // seconds
}

export type QrVerifyResult =
  | { ok: true; payload: QrPayload }
  | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" };

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function issueQrToken(sessionId: string, ttlSeconds: number, now = Date.now(), secret = config.QR_TOKEN_SECRET) {
  const iat = Math.floor(now / 1000);
  const payload: QrPayload = { v: 1, sid: sessionId, jti: randomUUID(), iat, exp: iat + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${body}.${sign(body, secret)}`, payload };
}

export function verifyQrToken(token: string, now = Date.now(), secret = config.QR_TOKEN_SECRET): QrVerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "MALFORMED" };
  const [body, sig] = parts as [string, string];
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "BAD_SIGNATURE" };
  let payload: QrPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as QrPayload;
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  if (payload.v !== 1 || typeof payload.sid !== "string" || typeof payload.jti !== "string" || typeof payload.exp !== "number") {
    return { ok: false, reason: "MALFORMED" };
  }
  if (Math.floor(now / 1000) >= payload.exp) return { ok: false, reason: "EXPIRED" };
  return { ok: true, payload };
}

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
