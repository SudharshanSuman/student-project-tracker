import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { PROJECT_STAGES } from "@iic/shared";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { visibleProjectsWhere } from "../lib/access.js";
import { healthFor } from "../lib/projects.js";
import { currentUser, requireAuth } from "../middleware/auth.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

const filterSchema = z.object({
  cohortId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  mentorId: z.string().uuid().optional(),
  stage: z.enum(PROJECT_STAGES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/**
 * Executive dashboard. Every number is computed from database rows at request time,
 * scoped to the projects the caller may see; nothing is hard-coded.
 */
dashboardRouter.get("/", async (req, res) => {
  const user = currentUser(req);
  const f = filterSchema.parse(req.query);
  const now = new Date();
  const from = f.from ?? new Date(now.getTime() - 90 * 86400_000);
  const to = f.to ?? now;

  const projectWhere: Prisma.ProjectWhereInput = {
    AND: [
      visibleProjectsWhere(user),
      { status: { not: "ARCHIVED" } },
      f.cohortId ? { cohortId: f.cohortId } : {},
      f.projectId ? { id: f.projectId } : {},
      f.mentorId ? { mentorId: f.mentorId } : {},
      f.stage ? { stage: f.stage } : {},
    ],
  };
  const scoped = await prisma.project.findMany({ where: projectWhere, select: { id: true, name: true, stage: true, status: true, lastActivityAt: true } });
  const ids = scoped.map((p) => p.id);
  const inIds = { in: ids };
  const idList = ids.length ? Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`)) : null;

  const [
    students, mentors, taskByStatus, overdueTasks, pendingApprovals, attendanceRows, discordAgg,
    registrations, wins, fundingRows, recentActivity, upcomingTasks, upcomingMilestones, upcomingCompetitions,
    upcomingEvents, openSessions, notifications, discordIntegration, completedPerWeek, reports,
  ] = await Promise.all([
    prisma.user.count({ where: { status: "ACTIVE", role: { in: ["PROJECT_LEAD", "PROJECT_MEMBER"] } } }),
    prisma.user.count({ where: { status: "ACTIVE", role: "MENTOR" } }),
    prisma.task.groupBy({ by: ["status"], where: { projectId: inIds }, _count: { _all: true } }),
    prisma.task.count({ where: { projectId: inIds, status: { not: "DONE" }, dueDate: { lt: now } } }),
    prisma.milestone.count({ where: { projectId: inIds, status: "SUBMITTED" } }),
    // Verified attendance hours = sum of session lengths for non-revoked records in range.
    prisma.$queryRaw<{ hours: number | null; records: bigint }[]>`
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (s."endsAt" - s."startsAt"))) / 3600, 0)::float AS hours,
             COUNT(r.id) AS records
      FROM "AttendanceRecord" r JOIN "AttendanceSession" s ON s.id = r."sessionId"
      WHERE r.status <> 'REVOKED' AND s."startsAt" BETWEEN ${from} AND ${to}
      ${user.role === "ADMIN" && !f.projectId && !f.cohortId && !f.mentorId && !f.stage
        ? Prisma.empty
        : idList
          ? Prisma.sql`AND r."userId" IN (SELECT "userId" FROM "ProjectMembership" WHERE "projectId" IN (${idList}))`
          : Prisma.sql`AND FALSE`}`,
    prisma.discordActivityDaily.aggregate({
      where: { projectId: inIds, date: { gte: from, lte: to } },
      _sum: { voiceSeconds: true, messageCount: true },
    }),
    prisma.competitionRegistration.count({ where: { projectId: inIds, status: { not: "WITHDRAWN" } } }),
    prisma.competitionRegistration.count({ where: { projectId: inIds, outcome: "WINNER", outcomeVerifiedAt: { not: null } } }),
    prisma.fundingAward.groupBy({ by: ["currency", "verification", "source"], where: { projectId: inIds, verification: { not: "REJECTED" } }, _sum: { amount: true } }),
    prisma.auditLog.findMany({
      where: user.role === "ADMIN" && !f.projectId ? {} : { projectId: inIds },
      select: { id: true, action: true, entityType: true, createdAt: true, actor: { select: { name: true } }, project: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.task.findMany({
      where: { projectId: inIds, status: { not: "DONE" }, dueDate: { gte: now, lte: new Date(now.getTime() + 14 * 86400_000) } },
      select: { id: true, title: true, dueDate: true, project: { select: { id: true, name: true } } },
      orderBy: { dueDate: "asc" },
      take: 8,
    }),
    prisma.milestone.findMany({
      where: { projectId: inIds, status: { in: ["OPEN", "CHANGES_REQUESTED"] }, dueDate: { gte: now } },
      select: { id: true, title: true, dueDate: true, project: { select: { id: true, name: true } } },
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
    prisma.competition.findMany({
      where: { submissionDeadline: { gte: now } },
      select: { id: true, name: true, submissionDeadline: true },
      orderBy: { submissionDeadline: "asc" },
      take: 5,
    }),
    prisma.event.findMany({ where: { endsAt: { gte: now } }, select: { id: true, title: true, startsAt: true, location: true, type: true }, orderBy: { startsAt: "asc" }, take: 5 }),
    prisma.attendanceSession.findMany({
      where: { status: { in: ["SCHEDULED", "OPEN"] }, endsAt: { gte: now } },
      select: { id: true, name: true, startsAt: true, status: true, _count: { select: { records: true } } },
      orderBy: { startsAt: "asc" },
      take: 5,
    }),
    prisma.notification.findMany({ where: { userId: user.id }, select: { id: true, title: true, link: true, readAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.discordIntegration.findFirst({ select: { status: true, guildName: true, lastHeartbeatAt: true, lastError: true } }),
    idList
      ? prisma.$queryRaw<{ week: Date; completed: bigint }[]>`
          SELECT date_trunc('week', "completedAt") AS week, COUNT(*) AS completed
          FROM "Task" WHERE "completedAt" IS NOT NULL AND "completedAt" >= ${new Date(now.getTime() - 56 * 86400_000)}
            AND "projectId" IN (${idList})
          GROUP BY 1 ORDER BY 1`
      : Promise.resolve([]),
    user.role === "ADMIN" || user.role === "MENTOR"
      ? prisma.generatedReport.findMany({ where: user.role === "ADMIN" ? {} : { requestedById: user.id }, select: { id: true, title: true, type: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 })
      : Promise.resolve([]),
  ]);

  const totalTasks = taskByStatus.reduce((s, r) => s + r._count._all, 0);
  const doneTasks = taskByStatus.find((r) => r.status === "DONE")?._count._all ?? 0;
  const health = await healthFor(scoped.slice(0, 100));
  const canSeeFunding = user.role !== "PROJECT_MEMBER";

  const leaderboardRaw = await prisma.competitionRegistration.groupBy({
    by: ["projectId", "outcome"],
    // Verified outcomes only — matches the authoritative /competitions/leaderboard rule.
    where: { projectId: inIds, outcome: { in: ["WINNER", "FINALIST"] }, outcomeVerifiedAt: { not: null } },
    _count: { _all: true },
  });
  const board = new Map<string, { wins: number; finals: number }>();
  for (const r of leaderboardRaw) {
    const e = board.get(r.projectId) ?? { wins: 0, finals: 0 };
    if (r.outcome === "WINNER") e.wins += r._count._all;
    else e.finals += r._count._all;
    board.set(r.projectId, e);
  }
  const leaderboard = [...board.entries()]
    .map(([projectId, v]) => ({ projectId, name: scoped.find((p) => p.id === projectId)?.name ?? "—", ...v }))
    .sort((a, b) => b.wins - a.wins || b.finals - a.finals)
    .slice(0, 8);

  res.json({
    generatedAt: now,
    period: { from, to },
    scope: { projectCount: ids.length, role: user.role },
    metrics: {
      activeProjects: scoped.filter((p) => p.status === "ACTIVE").length,
      registeredStudents: students,
      activeMentors: mentors,
      taskCompletionRate: totalTasks ? Math.round((doneTasks / totalTasks) * 1000) / 10 : null,
      totalTasks,
      doneTasks,
      overdueTasks,
      pendingApprovals,
      verifiedAttendanceHours: Math.round((attendanceRows[0]?.hours ?? 0) * 10) / 10,
      attendanceRecords: Number(attendanceRows[0]?.records ?? 0),
      discordVoiceHours: Math.round(((discordAgg._sum.voiceSeconds ?? 0) / 3600) * 10) / 10,
      discordMessages: discordAgg._sum.messageCount ?? 0,
      hackathonsEntered: registrations,
      competitionWins: wins,
    },
    funding: canSeeFunding
      ? fundingRows.map((r) => ({ currency: r.currency, verification: r.verification, source: r.source, amount: r._sum.amount?.toString() ?? "0" }))
      : null,
    projectsByStage: PROJECT_STAGES.map((stage) => ({ stage, count: scoped.filter((p) => p.stage === stage).length })),
    taskStatus: taskByStatus.map((r) => ({ status: r.status, count: r._count._all })),
    completedPerWeek: completedPerWeek.map((r) => ({ week: r.week, completed: Number(r.completed) })),
    projectHealth: scoped
      .map((p) => ({ id: p.id, name: p.name, stage: p.stage, ...health.get(p.id) }))
      .filter((p) => p.health)
      .sort((a, b) => (a.health === b.health ? 0 : a.health === "OFF_TRACK" ? -1 : b.health === "OFF_TRACK" ? 1 : a.health === "AT_RISK" ? -1 : 1))
      .slice(0, 8),
    recentActivity,
    deadlines: {
      tasks: upcomingTasks,
      milestones: upcomingMilestones,
      competitions: upcomingCompetitions,
    },
    upcomingEvents,
    openSessions,
    notifications,
    discord: { configured: config.integrations.discordConfigured, integration: discordIntegration },
    leaderboard,
    reports,
  });
});
