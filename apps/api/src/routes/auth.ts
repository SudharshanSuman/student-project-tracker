import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  acceptInvitationSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from "@iic/shared";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { DUMMY_PASSWORD_HASH, hashPassword, randomToken, sha256, verifyPassword } from "../lib/crypto.js";
import { isInstitutionalEmail } from "../lib/email-domain.js";
import { badRequest, HttpError, unauthorized } from "../lib/errors.js";
import { sendMail } from "../lib/mailer.js";
import { parse } from "../lib/validate.js";
import { clearSessionCookie, createSession, currentUser, requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." } },
});

const meSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  avatarUrl: true,
  bio: true,
  phone: true,
  department: true,
  discordUsername: true,
  githubUsername: true,
  onboardedAt: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

authRouter.post("/login", authLimiter, async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const invalid = () => unauthorized("Invalid email or password");

  if (!user) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH); // equalise timing
    throw invalid();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new HttpError(423, "Account temporarily locked after repeated failed attempts. Try again later.", "LOCKED");
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed >= MAX_FAILED ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });
    if (failed >= MAX_FAILED) await audit(req, { action: "auth.lockout", entityType: "User", entityId: user.id });
    throw invalid();
  }
  if (user.status !== "ACTIVE") throw unauthorized("This account is not active");

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await createSession(res, req, user.id);
  req.user = user;
  await audit(req, { action: "auth.login", entityType: "User", entityId: user.id });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: meSelect });
  res.json({ user: me });
});

authRouter.post("/logout", async (req, res) => {
  if (req.sessionId) {
    await prisma.session.update({ where: { id: req.sessionId }, data: { revokedAt: new Date() } });
    await audit(req, { action: "auth.logout", entityType: "User", entityId: req.user?.id });
  }
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: currentUser(req).id }, select: meSelect });
  res.json({ user: me });
});

authRouter.post("/password/forgot", authLimiter, async (req, res) => {
  const { email } = parse(forgotPasswordSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  // Same response whether or not the account exists (no user enumeration).
  if (user && user.status === "ACTIVE") {
    const token = randomToken(32);
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    await sendMail({
      to: user.email,
      subject: "Reset your IIC Platform password",
      text: `Use this link within 1 hour to reset your password:\n${config.APP_URL}/reset-password?token=${token}\n\nIf you did not request this, ignore this email.`,
    });
    await audit(req, { action: "auth.password_reset_requested", entityType: "User", entityId: user.id });
  }
  res.json({ ok: true });
});

authRouter.post("/password/reset", authLimiter, async (req, res) => {
  const { token, password } = parse(resetPasswordSchema, req.body);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.usedAt || record.expiresAt <= new Date()) {
    throw badRequest("This reset link is invalid or has expired");
  }
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    });
    // Invalidate every existing session after a reset.
    await tx.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(req, { action: "auth.password_reset", entityType: "User", entityId: record.userId }, tx);
  });
  res.json({ ok: true });
});

authRouter.post("/password/change", requireAuth, async (req, res) => {
  const me = currentUser(req);
  const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw badRequest("Current password is incorrect");
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: me.id }, data: { passwordHash } });
    await tx.session.updateMany({
      where: { userId: me.id, revokedAt: null, NOT: { id: req.sessionId } },
      data: { revokedAt: new Date() },
    });
    await audit(req, { action: "auth.password_changed", entityType: "User", entityId: me.id }, tx);
  });
  res.json({ ok: true });
});

async function findUsableInvitation(token: string) {
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: sha256(token) },
    include: { project: { select: { id: true, name: true } }, cohort: { select: { id: true, name: true } } },
  });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date()) return null;
  return inv;
}

authRouter.get("/invitations/:token", authLimiter, async (req, res) => {
  const inv = await findUsableInvitation(String(req.params.token));
  if (!inv) throw badRequest("This invitation is invalid, already used, or expired");
  res.json({
    invitation: { email: inv.email, role: inv.role, project: inv.project, cohort: inv.cohort, expiresAt: inv.expiresAt },
  });
});

/** Onboarding: accept an admin-issued invitation, set name/password, start a session. */
authRouter.post("/invitations/accept", authLimiter, async (req, res) => {
  const input = parse(acceptInvitationSchema, req.body);
  const inv = await findUsableInvitation(input.token);
  if (!inv) throw badRequest("This invitation is invalid, already used, or expired");
  if (!isInstitutionalEmail(inv.email)) throw badRequest("Invitation email is not an institutional address");

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: inv.email } });
    if (existing && existing.status === "ACTIVE") throw badRequest("An active account already exists for this email");
    // Role comes from the invitation the admin issued — never from the request body.
    const u = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: { name: input.name, passwordHash, role: inv.role, status: "ACTIVE", department: input.department, onboardedAt: new Date() },
        })
      : await tx.user.create({
          data: { email: inv.email, name: input.name, passwordHash, role: inv.role, status: "ACTIVE", department: input.department, onboardedAt: new Date() },
        });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    if (inv.projectId) {
      await tx.projectMembership.upsert({
        where: { projectId_userId: { projectId: inv.projectId, userId: u.id } },
        create: { projectId: inv.projectId, userId: u.id, role: inv.role === "PROJECT_LEAD" ? "LEAD" : "MEMBER" },
        update: {},
      });
    }
    await audit(req, { action: "auth.invitation_accepted", entityType: "User", entityId: u.id, projectId: inv.projectId, metadata: { role: inv.role } }, tx);
    return u;
  });
  await createSession(res, req, user.id);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: meSelect });
  res.status(201).json({ user: me });
});
