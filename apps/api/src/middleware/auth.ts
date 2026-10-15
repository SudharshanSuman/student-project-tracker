import type { Request, RequestHandler, Response } from "express";
import type { Role, User } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { forbidden, unauthorized } from "../lib/errors.js";

export type AuthUser = Pick<User, "id" | "email" | "name" | "role" | "status" | "onboardedAt">;

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
    sessionId?: string;
  }
}

const SESSION_REFRESH_MS = 5 * 60 * 1000;

export async function createSession(res: Response, req: Request, userId: string) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600 * 1000);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
  res.cookie(config.sessionCookie, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(config.sessionCookie, { httpOnly: true, secure: config.isProd, sameSite: "lax", path: "/" });
}

/** Loads the session (if any) from the httpOnly cookie. Never trusts client-supplied user data. */
export const loadSession: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[config.sessionCookie];
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return next();
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: { select: { id: true, email: true, name: true, role: true, status: true, onboardedAt: true } },
    },
  });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt <= now || session.user.status !== "ACTIVE") return next();
  req.user = session.user;
  req.sessionId = session.id;
  if (now.getTime() - session.lastSeenAt.getTime() > SESSION_REFRESH_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

/** Narrowing helper for handlers mounted behind requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
