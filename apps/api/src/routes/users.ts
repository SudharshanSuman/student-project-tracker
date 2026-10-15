import { Router } from "express";
import { z } from "zod";
import { createInvitationSchema, paginationSchema, ROLES, updateProfileSchema, updateUserSchema, USER_STATUSES } from "@iic/shared";
import type { Prisma } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { isInstitutionalEmail } from "../lib/email-domain.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { sendMail } from "../lib/mailer.js";
import { pageArgs, parse, uuidParam } from "../lib/validate.js";
import { currentUser, requireAuth, requireRole } from "../middleware/auth.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);

const INVITE_TTL_DAYS = 7;

const userListQuery = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
});

// ── Profile (self) ──
usersRouter.patch("/profile", async (req, res) => {
  const me = currentUser(req);
  const data = parse(updateProfileSchema, req.body);
  const user = await prisma.user.update({
    where: { id: me.id },
    data,
    select: { id: true, name: true, bio: true, phone: true, department: true, githubUsername: true },
  });
  await audit(req, { action: "user.profile_updated", entityType: "User", entityId: me.id });
  res.json({ user });
});

usersRouter.get("/profile/sessions", async (req, res) => {
  const me = currentUser(req);
  const sessions = await prisma.session.findMany({
    where: { userId: me.id, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, createdAt: true, lastSeenAt: true, ip: true, userAgent: true, expiresAt: true },
    orderBy: { lastSeenAt: "desc" },
  });
  res.json({ sessions: sessions.map((s) => ({ ...s, current: s.id === req.sessionId })) });
});

usersRouter.delete("/profile/sessions/:id", async (req, res) => {
  const me = currentUser(req);
  const id = uuidParam(req.params.id);
  const result = await prisma.session.updateMany({ where: { id, userId: me.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (result.count === 0) throw notFound("Session not found");
  res.status(204).end();
});

// ── Lookup for pickers (minimal fields only) ──
usersRouter.get("/lookup", requireRole("ADMIN", "MENTOR", "PROJECT_LEAD"), async (req, res) => {
  const q = z.object({ q: z.string().trim().max(120).optional(), role: z.enum(ROLES).optional() }).parse(req.query);
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      role: q.role,
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { email: { contains: q.q, mode: "insensitive" } }] } : {}),
    },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
    take: 25,
  });
  res.json({ users });
});

// ── Admin: user management ──
usersRouter.get("/", requireRole("ADMIN"), async (req, res) => {
  const q = userListQuery.parse(req.query);
  const where: Prisma.UserWhereInput = {
    role: q.role,
    status: q.status,
    ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { email: { contains: q.q, mode: "insensitive" } }] } : {}),
  };
  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true, email: true, name: true, role: true, status: true, department: true,
        lastLoginAt: true, createdAt: true, _count: { select: { memberships: true } },
      },
      orderBy: { createdAt: "desc" },
      ...pageArgs(q.page, q.pageSize),
    }),
  ]);
  res.json({ users, total, page: q.page, pageSize: q.pageSize });
});

usersRouter.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  const me = currentUser(req);
  const id = uuidParam(req.params.id);
  const data = parse(updateUserSchema, req.body);
  if (id === me.id) throw forbidden("You cannot change your own role or status");
  const before = await prisma.user.findUnique({ where: { id } });
  if (!before) throw notFound("User not found");
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id }, data, select: { id: true, role: true, status: true } });
    if (data.status === "DISABLED") {
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await audit(req, {
      action: "user.updated",
      entityType: "User",
      entityId: id,
      metadata: { from: { role: before.role, status: before.status }, to: data },
    }, tx);
    return u;
  });
  res.json({ user });
});

// ── Admin: invitations ──
usersRouter.get("/invitations", requireRole("ADMIN"), async (_req, res) => {
  const invitations = await prisma.invitation.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, email: true, role: true, expiresAt: true, acceptedAt: true, revokedAt: true, createdAt: true,
      invitedBy: { select: { name: true } },
      project: { select: { id: true, name: true } },
      cohort: { select: { id: true, name: true } },
    },
  });
  res.json({ invitations });
});

usersRouter.post("/invitations", requireRole("ADMIN"), async (req, res) => {
  const me = currentUser(req);
  const input = parse(createInvitationSchema, req.body);
  if (!isInstitutionalEmail(input.email)) {
    throw badRequest(`Only institutional emails are allowed (${config.emailDomains.join(", ") || "any"})`);
  }
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing?.status === "ACTIVE") throw badRequest("This person already has an active account");
  const token = randomToken(32);
  const invitation = await prisma.$transaction(async (tx) => {
    // Revoke any older pending invitation for the same email.
    await tx.invitation.updateMany({
      where: { email: input.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const inv = await tx.invitation.create({
      data: {
        email: input.email,
        role: input.role,
        cohortId: input.cohortId ?? null,
        projectId: input.projectId ?? null,
        invitedById: me.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000),
      },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
    await audit(req, { action: "invitation.created", entityType: "Invitation", entityId: inv.id, projectId: input.projectId, metadata: { email: input.email, role: input.role } }, tx);
    return inv;
  });
  const inviteUrl = `${config.APP_URL}/onboarding?token=${token}`;
  await sendMail({
    to: input.email,
    subject: "You're invited to the IIC Platform",
    text: `You have been invited as ${input.role}. Accept within ${INVITE_TTL_DAYS} days:\n${inviteUrl}`,
  });
  // Without SMTP the admin needs the link to share it manually.
  res.status(201).json({ invitation, inviteUrl: config.integrations.smtpConfigured ? undefined : inviteUrl });
});

usersRouter.delete("/invitations/:id", requireRole("ADMIN"), async (req, res) => {
  const id = uuidParam(req.params.id);
  const result = await prisma.invitation.updateMany({
    where: { id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) throw notFound("No pending invitation with that id");
  await audit(req, { action: "invitation.revoked", entityType: "Invitation", entityId: id });
  res.status(204).end();
});
