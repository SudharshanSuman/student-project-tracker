import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { paginationSchema } from "@iic/shared";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { visibleProjectsWhere } from "../lib/access.js";
import { notFound } from "../lib/errors.js";
import { pageArgs, parse, uuidParam } from "../lib/validate.js";
import { currentUser, requireAuth, requireRole } from "../middleware/auth.js";

/**
 * Read-side routes for notifications, audit logs, integrations, Discord, GitHub,
 * competitions, funding and reports. Integration write paths (bot, sync workers)
 * and competition/funding/report mutations land in later phases (SPT-3 / SPT-4).
 */
export const insightsRouter = Router();
insightsRouter.use(requireAuth);

// ── Notifications ──
insightsRouter.get("/notifications", async (req, res) => {
  const user = currentUser(req);
  const q = paginationSchema.extend({ unread: z.enum(["true", "false"]).optional() }).parse(req.query);
  const where: Prisma.NotificationWhereInput = { userId: user.id, ...(q.unread === "true" ? { readAt: null } : {}) };
  const [total, unread, notifications] = await prisma.$transaction([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, ...pageArgs(q.page, q.pageSize) }),
  ]);
  res.json({ notifications, total, unread, page: q.page, pageSize: q.pageSize });
});

insightsRouter.get("/notifications/unread-count", async (req, res) => {
  const unread = await prisma.notification.count({ where: { userId: currentUser(req).id, readAt: null } });
  res.json({ unread });
});

insightsRouter.post("/notifications/:id/read", async (req, res) => {
  const id = uuidParam(req.params.id);
  const r = await prisma.notification.updateMany({ where: { id, userId: currentUser(req).id, readAt: null }, data: { readAt: new Date() } });
  res.json({ updated: r.count });
});

insightsRouter.post("/notifications/read-all", async (req, res) => {
  const r = await prisma.notification.updateMany({ where: { userId: currentUser(req).id, readAt: null }, data: { readAt: new Date() } });
  res.json({ updated: r.count });
});

const NOTIFICATION_TYPES = [
  "task.assigned", "task.review", "task.done", "task.comment",
  "milestone.submitted", "milestone.approved", "milestone.rejected",
  "project.assigned", "project.member_added", "project.stage_changed",
  "attendance.open", "competition.deadline", "integration.failure", "report.completed",
] as const;

insightsRouter.get("/notifications/preferences", async (req, res) => {
  const prefs = await prisma.notificationPreference.findMany({ where: { userId: currentUser(req).id } });
  res.json({
    preferences: NOTIFICATION_TYPES.map((type) => ({ type, inApp: prefs.find((p) => p.type === type)?.inApp ?? true })),
  });
});

insightsRouter.put("/notifications/preferences", async (req, res) => {
  const user = currentUser(req);
  const input = parse(z.object({ preferences: z.array(z.object({ type: z.enum(NOTIFICATION_TYPES), inApp: z.boolean() })).max(50) }), req.body);
  await prisma.$transaction(
    input.preferences.map((p) =>
      prisma.notificationPreference.upsert({
        where: { userId_type: { userId: user.id, type: p.type } },
        create: { userId: user.id, type: p.type, inApp: p.inApp },
        update: { inApp: p.inApp },
      }),
    ),
  );
  res.json({ ok: true });
});

// ── Audit logs (admin) ──
insightsRouter.get("/audit-logs", requireRole("ADMIN"), async (req, res) => {
  const q = paginationSchema
    .extend({
      action: z.string().trim().max(80).optional(),
      entityType: z.string().trim().max(80).optional(),
      actorId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
    })
    .parse(req.query);
  const where: Prisma.AuditLogWhereInput = {
    action: q.action ? { contains: q.action, mode: "insensitive" } : undefined,
    entityType: q.entityType || undefined,
    actorId: q.actorId,
    projectId: q.projectId,
  };
  const [total, entries, entityTypes] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true, email: true } }, project: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      ...pageArgs(q.page, q.pageSize),
    }),
    prisma.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
  ]);
  res.json({ entries, total, page: q.page, pageSize: q.pageSize, entityTypes: entityTypes.map((e) => e.entityType) });
});

// ── Integration settings (admin) ──
insightsRouter.get("/integrations", requireRole("ADMIN"), async (_req, res) => {
  const [discord, githubCount, logs, engagement] = await Promise.all([
    prisma.discordIntegration.findFirst({ include: { channels: { include: { project: { select: { id: true, name: true } } } } } }),
    prisma.gitHubIntegration.count(),
    prisma.integrationLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.platformSetting.findUnique({ where: { key: "engagement.weights" } }),
  ]);
  // Only booleans about secrets ever leave the server — never the values.
  res.json({
    discord: { credentialsPresent: config.integrations.discordConfigured, integration: discord },
    github: { credentialsPresent: config.integrations.githubConfigured, linkedRepositories: githubCount },
    email: { smtpConfigured: config.integrations.smtpConfigured },
    queue: { redisConfigured: config.integrations.redisConfigured },
    engagementWeights: engagement?.value ?? null,
    logs,
  });
});

// ── Discord analytics (aggregates; individual-level data restricted to staff) ──
insightsRouter.get("/discord", requireRole("ADMIN", "MENTOR", "PROJECT_LEAD"), async (req, res) => {
  const user = currentUser(req);
  const projects = await prisma.project.findMany({ where: visibleProjectsWhere(user), select: { id: true, name: true } });
  const ids = projects.map((p) => p.id);
  const since = new Date(Date.now() - 30 * 86400_000);
  const [integration, daily, sessions, alerts] = await Promise.all([
    prisma.discordIntegration.findFirst({ select: { status: true, guildName: true, lastHeartbeatAt: true, lastError: true, minSessionSeconds: true, countMessages: true, retentionDays: true } }),
    prisma.discordActivityDaily.groupBy({
      by: ["projectId", "date"],
      where: { projectId: { in: ids }, date: { gte: since } },
      _sum: { voiceSeconds: true, messageCount: true },
      orderBy: { date: "asc" },
    }),
    user.role === "PROJECT_LEAD"
      ? Promise.resolve([])
      : prisma.discordVoiceSession.findMany({
          where: { projectId: { in: ids } },
          select: { id: true, channelId: true, joinedAt: true, leftAt: true, durationSeconds: true, status: true, user: { select: { name: true } }, project: { select: { name: true } } },
          orderBy: { joinedAt: "desc" },
          take: 50,
        }),
    prisma.inactivityAlert.findMany({ where: { projectId: { in: ids }, status: "OPEN" }, include: { project: { select: { name: true } } }, take: 20 }),
  ]);
  res.json({
    configured: config.integrations.discordConfigured,
    integration,
    projects,
    daily: daily.map((d) => ({ projectId: d.projectId, date: d.date, voiceSeconds: d._sum.voiceSeconds ?? 0, messages: d._sum.messageCount ?? 0 })),
    sessions,
    alerts,
    individualDataVisible: user.role !== "PROJECT_LEAD",
  });
});

// ── GitHub ──
insightsRouter.get("/github", async (req, res) => {
  const user = currentUser(req);
  const projects = await prisma.project.findMany({
    where: { AND: [visibleProjectsWhere(user), { status: { not: "ARCHIVED" } }] },
    select: {
      id: true, name: true, repoUrl: true,
      github: { select: { owner: true, repo: true, status: true, defaultBranch: true, latestCommitAt: true, lastSyncedAt: true, lastError: true, activity: { orderBy: { date: "desc" }, take: 30 } } },
    },
    orderBy: { name: "asc" },
  });
  res.json({ configured: config.integrations.githubConfigured, projects });
});

// ── Competitions (directory; CRUD lands in SPT-4) ──
insightsRouter.get("/competitions", async (req, res) => {
  const user = currentUser(req);
  const q = z.object({ q: z.string().trim().max(120).optional() }).parse(req.query);
  const competitions = await prisma.competition.findMany({
    where: q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { organizer: { contains: q.q, mode: "insensitive" } }] } : {},
    include: {
      registrations: {
        where: { project: visibleProjectsWhere(user) },
        select: { id: true, status: true, outcome: true, project: { select: { id: true, name: true } } },
      },
      _count: { select: { registrations: true } },
    },
    orderBy: [{ submissionDeadline: { sort: "asc", nulls: "last" } }],
    take: 100,
  });
  res.json({ competitions });
});

// ── Funding ledger (staff + project leads; members excluded) ──
insightsRouter.get("/funding", requireRole("ADMIN", "MENTOR", "PROJECT_LEAD"), async (req, res) => {
  const user = currentUser(req);
  const projectWhere: Prisma.ProjectWhereInput =
    user.role === "PROJECT_LEAD" ? { memberships: { some: { userId: user.id, role: "LEAD" } } } : visibleProjectsWhere(user);
  const [awards, totals] = await Promise.all([
    prisma.fundingAward.findMany({
      where: { project: projectWhere },
      include: { project: { select: { id: true, name: true } }, verifiedBy: { select: { name: true } }, registration: { select: { competition: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.fundingAward.groupBy({ by: ["currency", "verification"], where: { project: projectWhere }, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  res.json({
    awards: awards.map((a) => ({ ...a, amount: a.amount.toString() })),
    totals: totals.map((t) => ({ currency: t.currency, verification: t.verification, amount: t._sum.amount?.toString() ?? "0", count: t._count._all })),
  });
});

// ── Reports (generation engine lands in SPT-4) ──
insightsRouter.get("/reports", requireRole("ADMIN", "MENTOR"), async (req, res) => {
  const user = currentUser(req);
  const reports = await prisma.generatedReport.findMany({
    where: user.role === "ADMIN" ? {} : { requestedById: user.id },
    include: { requestedBy: { select: { name: true } }, project: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ reports });
});

insightsRouter.get("/reports/:id", requireRole("ADMIN", "MENTOR"), async (req, res) => {
  const user = currentUser(req);
  const report = await prisma.generatedReport.findUnique({ where: { id: uuidParam(req.params.id) } });
  if (!report || (user.role !== "ADMIN" && report.requestedById !== user.id)) throw notFound("Report not found");
  res.json({ report });
});
