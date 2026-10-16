import type { RequestHandler } from "express";
import { config } from "../config.js";
import { forbidden } from "../lib/errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence in depth (cookies are already SameSite=Lax):
 * state-changing requests must come from an allowed Origin (or same-origin with no
 * Origin header, e.g. server-to-server calls from the Next.js server) and must not be
 * a simple form post — JSON or multipart only.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.path === "/integrations/github/webhook" || req.path.endsWith("/github/webhook")) return next();
  const origin = req.get("origin");
  if (origin && !config.webOrigins.includes(origin)) {
    return next(forbidden("Cross-origin request rejected"));
  }
  const ct = (req.get("content-type") ?? "").toLowerCase();
  const hasBody = Number(req.get("content-length") ?? 0) > 0 || req.get("transfer-encoding");
  if (hasBody && !ct.startsWith("application/json") && !ct.startsWith("multipart/form-data")) {
    return next(forbidden("Unsupported content type"));
  }
  next();
};
