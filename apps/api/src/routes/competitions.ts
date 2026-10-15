import { Router } from "express";
import type { CompetitionOutcome, Prisma } from "@prisma/client";
import {
  competitionListQuerySchema,
  competitionSchema,
  leaderboardQuerySchema,
  OUTCOME_POINTS,
  registrationSchema,
  updateCompetitionSchema,
  updateRegistrationSchema,
  verifyOutcomeSchema,
} from "@iic/shared";
import { prisma } from "../db.js";
import { requireProjectAccess, visibleProjectsWhere } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { conflict, forbidden, notFound } from "../lib/errors.js";
import { notifyMany } from "../lib/notify.js";
import { touchProject } from "../lib/projects.js";
import { parse, uuidParam } from "../lib/validate.js";
import { currentUser, requireAuth, requireRole, type AuthUser } from "../middleware/auth.js";

/**
 * Hackathon / competition lifecycle.
 *  - Competitions (the directory) are created by staff; anyone signed in can browse them.
 *  - Registrations belong to a project: its lead (or an admin / the assigned mentor) manages them.
 *  - Outcomes are *claims* until the assigned mentor or an admin verifies them. Any outcome change
 *    clears the verification, and the leaderboard counts verified outcomes only (unless staff opt in).
 *  - Prize money lives in FundingAward (see routes/funding.ts), never on the registration.
 */
export const competitionsRouter = Router();
competitionsRouter.use(requireAuth);

const registrationSelect = {
  id: true, status: true, outcome: true, outcomeVerifiedAt: true, outcomeEvidenceUrl: true,
  submissionRepoUrl: true, demoUrl: true, pitchDeckUrl: true, mentorNotes: true, createdAt: true, updatedAt: true,
  outcomeVerifiedBy: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, mentorId: true, cohort: { select: { id: true, name: true } } } },
} satisfies Prisma.CompetitionRegistrationSelect;

/** Mentor notes are visible to staff and the project lead only. */
function redactRegistration<T extends { mentorNotes: string | null }>(r: T, canSeeNotes: boolean): T {
  return canSeeNotes ? r : { ...r, mentorNotes: null };
}

// ── Directory ──
competitionsRouter.get("/competitions", async (req, res) => {
  const user = currentUser(req);
  const q = competitionListQuerySchema.parse(req.query);
  const now = new Date();
  const and: Prisma.CompetitionWhereInput[] = [];
  if (q.q) {
    and.push({
      OR: [
        { name: { contains: q.q, mode: "insensitive" } },
        { organizer: { contains: q.q, mode: "insensitive" } },
        { description: { contains: q.q, mode: "insensitive" } },
      ],
    });
  }
  // "upcoming": not finished yet (or undated); "past": finished.
  if (q.when === "upcoming") and.push({ OR: [{ endDate: { gte: now } }, { endDate: null, submissionDeadline: { gte: now } }, { endDate: null, submissionDeadline: null }] });
  if (q.when === "past") and.push({ OR: [{ endDate: { lt: now } }, { endDate: null, submissionDeadline: { lt: now } }] });
  const visibleReg: Prisma.CompetitionRegistrationWhereInput = {
    project: visibleProjectsWhere(user),
    ...(q.outcome ? { outcome: q.outcome } : {}),
    ...(q.projectId ? { projectId: q.projectId } : {}),
  };
  if (q.outcome || q.projectId) and.push({ registrations: { some: visibleReg } });

  const competitions = await prisma.competition.findMany({
    where: { AND: and },
    include: {
      registrations: {
        where: { project: visibleProjectsWhere(user) },
        select: { id: true, status: true, outcome: true, outcomeVerifiedAt: true, project: { select: { id: true, name: true } } },
      },
      _count: { select: { registrations: true } },
    },
    orderBy: [{ submissionDeadline: { sort: "asc", nulls: "last" } }, { name: "asc" }],
    take: 200,
  });
  res.json({ competitions, canCreate: user.role === "ADMIN" || user.role === "MENTOR" });
});

// ── Leaderboard (declared before /:id) ──
// Verified outcomes are institutional achievements, so the board covers every project.
// It never includes money. Staff may opt in to unverified claims (clearly flagged).
competitionsRouter.get("/competitions/leaderboard", async (req, res) => {
  const user = currentUser(req);
  const q = leaderboardQuerySchema.parse(req.query);
  const isStaff = user.role === "ADMIN" || user.role === "MENTOR";
  const includeUnverified = isStaff && q.includeUnverified === "true";
  const dateFilter: Prisma.CompetitionWhereInput | undefined =
    q.from || q.to
      ? {
          OR: [
            { endDate: { gte: q.from ?? undefined, lte: q.to ?? undefined } },
            { endDate: null, submissionDeadline: { gte: q.from ?? undefined, lte: q.to ?? undefined } },
          ],
        }
      : undefined;
  const regs = await prisma.competitionRegistration.findMany({
    where: {
      outcome: { not: "PENDING" },
      status: { not: "WITHDRAWN" },
      ...(includeUnverified ? {} : { outcomeVerifiedAt: { not: null } }),
      project: { status: { not: "ARCHIVED" }, ...(q.cohortId ? { cohortId: q.cohortId } : {}) },
      ...(dateFilter ? { competition: dateFilter } : {}),
    },
    select: { outcome: true, outcomeVerifiedAt: true, project: { select: { id: true, name: true, cohort: { select: { name: true } } } } },
  });
  const rows = new Map<string, { projectId: string; projectName: string; cohort: string | null; points: number; winners: number; finalists: number; participations: number; unverified: number }>();
  for (const r of regs) {
    const row = rows.get(r.project.id) ?? { projectId: r.project.id, projectName: r.project.name, cohort: r.project.cohort?.name ?? null, points: 0, winners: 0, finalists: 0, participations: 0, unverified: 0 };
    row.points += OUTCOME_POINTS[r.outcome as CompetitionOutcome];
    if (r.outcome === "WINNER") row.winners += 1;
    if (r.outcome === "FINALIST") row.finalists += 1;
    if (r.outcome === "PARTICIPANT") row.participations += 1;
    if (!r.outcomeVerifiedAt) row.unverified += 1;
    rows.set(r.project.id, row);
  }
  const leaderboard = [...rows.values()]
    .sort((a, b) => b.points - a.points || b.winners - a.winners || b.finalists - a.finalists || a.projectName.localeCompare(b.projectName))
    .map((r, i) => ({ rank: i + 1, ...r }));
  res.json({ leaderboard, includeUnverified, points: OUTCOME_POINTS });
});

competitionsRouter.get("/competitions/:id", async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const competition = await prisma.competition.findUnique({
    where: { id },
    include: { createdBy: { select: { id: true, name: true } }, _count: { select: { registrations: true } } },
  });
  if (!competition) throw notFound("Competition not found");
  const registrations = await prisma.competitionRegistration.findMany({
    where: { competitionId: id, project: visibleProjectsWhere(user) },
    select: registrationSelect,
    orderBy: { createdAt: "asc" },
  });
  const isStaff = user.role === "ADMIN" || user.role === "MENTOR";
  const leadOf = isStaff
    ? []
    : (await prisma.projectMembership.findMany({ where: { userId: user.id, role: "LEAD" }, select: { projectId: true } })).map((m) => m.projectId);
  // Projects the caller may register (lead → own projects; staff → visible projects).
  const registrable = await prisma.project.findMany({
    where: {
      AND: [
        user.role === "ADMIN" ? {} : user.role === "MENTOR" ? { mentorId: user.id } : { id: { in: leadOf } },
        { status: { not: "ARCHIVED" } },
        { registrations: { none: { competitionId: id } } },
      ],
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  res.json({
    competition,
    registrations: registrations.map((r) => ({
      ...redactRegistration(r, isStaff || leadOf.includes(r.project.id)),
      canManage: user.role === "ADMIN" || leadOf.includes(r.project.id) || (user.role === "MENTOR" && r.project.mentorId === user.id),
      canVerify: user.role === "ADMIN" || (user.role === "MENTOR" && r.project.mentorId === user.id),
    })),
    registrable,
    canEdit: user.role === "ADMIN" || competition.createdById === user.id,
    canDelete: user.role === "ADMIN",
  });
});

competitionsRouter.post("/competitions", requireRole("ADMIN", "MENTOR"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(competitionSchema, req.body);
  const competition = await prisma.$transaction(async (tx) => {
    const c = await tx.competition.create({ data: { ...input, createdById: user.id } });
    await audit(req, { action: "competition.created", entityType: "Competition", entityId: c.id, metadata: { name: c.name, organizer: c.organizer } }, tx);
    return c;
  });
  res.status(201).json({ competition });
});

competitionsRouter.patch("/competitions/:id", requireRole("ADMIN", "MENTOR"), async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const existing = await prisma.competition.findUnique({ where: { id } });
  if (!existing) throw notFound("Competition not found");
  if (user.role !== "ADMIN" && existing.createdById !== user.id) throw forbidden("Only the creator or an admin can edit this competition");
  const input = parse(updateCompetitionSchema, req.body);
  const start = input.startDate !== undefined ? input.startDate : existing.startDate;
  const end = input.endDate !== undefined ? input.endDate : existing.endDate;
  if (start && end && end < start) throw conflict("End must be on or after start", "INVALID_DATES");
  const competition = await prisma.$transaction(async (tx) => {
    const c = await tx.competition.update({ where: { id }, data: input });
    await audit(req, { action: "competition.updated", entityType: "Competition", entityId: id, metadata: { changed: Object.keys(input) } }, tx);
    return c;
  });
  res.json({ competition });
});

/** Admin only; refused while registrations exist so outcome history is never lost. */
competitionsRouter.delete("/competitions/:id", requireRole("ADMIN"), async (req, res) => {
  const id = uuidParam(req.params.id);
  const existing = await prisma.competition.findUnique({ where: { id }, include: { _count: { select: { registrations: true } } } });
  if (!existing) throw notFound("Competition not found");
  if (existing._count.registrations > 0) throw conflict("Remove its registrations first; outcome history is kept otherwise", "HAS_REGISTRATIONS");
  await prisma.$transaction(async (tx) => {
    await tx.competition.delete({ where: { id } });
    await audit(req, { action: "competition.deleted", entityType: "Competition", entityId: id, metadata: { name: existing.name } }, tx);
  });
  res.status(204).end();
});

// ── Registrations ──
competitionsRouter.post("/competitions/:id/registrations", async (req, res) => {
  const user = currentUser(req);
  const competitionId = uuidParam(req.params.id);
  const input = parse(registrationSchema, req.body);
  const access = await requireProjectAccess(user, input.projectId);
  if (!access.canManage && !access.canReview) throw forbidden("Only the project lead, its mentor or an admin can register the project");
  if (access.project.status === "ARCHIVED") throw forbidden("Archived projects are read-only");
  const competition = await prisma.competition.findUnique({ where: { id: competitionId } });
  if (!competition) throw notFound("Competition not found");
  const registration = await prisma.$transaction(async (tx) => {
    const r = await tx.competitionRegistration.create({ data: { ...input, competitionId }, select: registrationSelect });
    await touchProject(input.projectId, tx);
    await audit(req, { action: "competition.registered", entityType: "CompetitionRegistration", entityId: r.id, projectId: input.projectId, metadata: { competition: competition.name, status: r.status } }, tx);
    return r;
  });
  res.status(201).json({ registration });
});

async function loadRegistration(user: AuthUser, id: string) {
  const reg = await prisma.competitionRegistration.findUnique({ where: { id }, include: { competition: { select: { id: true, name: true } } } });
  if (!reg) throw notFound("Registration not found");
  const access = await requireProjectAccess(user, reg.projectId); // 404 when not visible
  return { reg, access };
}

/** Project-level competition history. */
competitionsRouter.get("/projects/:projectId/competitions", async (req, res) => {
  const user = currentUser(req);
  const projectId = uuidParam(req.params.projectId, "projectId");
  const access = await requireProjectAccess(user, projectId);
  const registrations = await prisma.competitionRegistration.findMany({
    where: { projectId },
    select: { ...registrationSelect, competition: { select: { id: true, name: true, organizer: true, startDate: true, endDate: true, submissionDeadline: true } } },
    orderBy: { createdAt: "desc" },
  });
  const seeNotes = access.canReview || access.isLead;
  res.json({ registrations: registrations.map((r) => redactRegistration(r, seeNotes)) });
});

competitionsRouter.patch("/competition-registrations/:id", async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const { reg, access } = await loadRegistration(user, id);
  if (!access.canManage && !access.canReview) throw forbidden("Only the project lead, its mentor or an admin can update this registration");
  if (access.project.status === "ARCHIVED" && !access.isAdmin) throw forbidden("Archived projects are read-only");
  const input = parse(updateRegistrationSchema, req.body);
  if (input.mentorNotes !== undefined && !access.canReview) throw forbidden("Only the assigned mentor or an admin can write mentor notes");
  const outcomeChanged = input.outcome !== undefined && input.outcome !== reg.outcome;
  // A verified outcome is an institutional record: only a reviewer may change it.
  if (outcomeChanged && reg.outcomeVerifiedAt && !access.canReview) {
    throw forbidden("This outcome is verified; ask the assigned mentor or an admin to change it");
  }
  if (input.outcome && input.outcome !== "PENDING" && (input.status ?? reg.status) === "WITHDRAWN") {
    throw conflict("A withdrawn registration cannot have a result", "WITHDRAWN");
  }
  const data: Prisma.CompetitionRegistrationUpdateInput = { ...input };
  if (outcomeChanged) {
    data.outcomeVerifiedBy = { disconnect: true };
    data.outcomeVerifiedAt = null;
  }
  const registration = await prisma.$transaction(async (tx) => {
    const r = await tx.competitionRegistration.update({ where: { id }, data, select: registrationSelect });
    await touchProject(reg.projectId, tx);
    await audit(req, {
      action: outcomeChanged ? "competition.outcome_claimed" : "competition.registration_updated",
      entityType: "CompetitionRegistration",
      entityId: id,
      projectId: reg.projectId,
      metadata: { competition: reg.competition.name, changed: Object.keys(input), ...(outcomeChanged ? { from: reg.outcome, to: input.outcome, wasVerified: !!reg.outcomeVerifiedAt } : {}) },
    }, tx);
    if (outcomeChanged && input.outcome !== "PENDING" && access.project.mentorId && access.project.mentorId !== user.id) {
      await notifyMany([access.project.mentorId], {
        type: "competition.outcome",
        title: `Verify ${access.project.name}'s result: ${input.outcome?.toLowerCase()} at ${reg.competition.name}`,
        link: `/competitions/${reg.competition.id}`,
        dedupeKey: `competition.outcome:${id}:${input.outcome}:${r.updatedAt.getTime()}`,
      }, tx);
    }
    return r;
  });
  res.json({ registration });
});

/** The assigned mentor or an admin confirms a claimed outcome (with a mandatory note). */
competitionsRouter.post("/competition-registrations/:id/verify-outcome", async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const { reg, access } = await loadRegistration(user, id);
  if (!access.canReview) throw forbidden("Only the assigned mentor or an admin can verify outcomes");
  if (reg.outcome === "PENDING") throw conflict("There is no outcome to verify yet", "NO_OUTCOME");
  if (reg.outcomeVerifiedAt) throw conflict("This outcome is already verified", "ALREADY_VERIFIED");
  const { note } = parse(verifyOutcomeSchema, req.body);
  const registration = await prisma.$transaction(async (tx) => {
    // Guarded update: if the outcome changed concurrently, nothing is verified.
    const r = await tx.competitionRegistration.updateMany({
      where: { id, outcome: reg.outcome, outcomeVerifiedAt: null },
      data: { outcomeVerifiedById: user.id, outcomeVerifiedAt: new Date() },
    });
    if (r.count === 0) throw conflict("The outcome changed; reload and try again", "STALE");
    await audit(req, { action: "competition.outcome_verified", entityType: "CompetitionRegistration", entityId: id, projectId: reg.projectId, metadata: { competition: reg.competition.name, outcome: reg.outcome, note } }, tx);
    return tx.competitionRegistration.findUniqueOrThrow({ where: { id }, select: registrationSelect });
  });
  res.json({ registration });
});

competitionsRouter.delete("/competition-registrations/:id", async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const { reg, access } = await loadRegistration(user, id);
  if (!access.canManage && !access.canReview) throw forbidden();
  if (reg.outcomeVerifiedAt && !access.isAdmin) throw forbidden("Verified results can only be removed by an admin");
  const verifiedFunding = await prisma.fundingAward.count({ where: { registrationId: id, verification: "VERIFIED" } });
  if (verifiedFunding > 0) throw conflict("This registration has verified funding attached", "HAS_VERIFIED_FUNDING");
  await prisma.$transaction(async (tx) => {
    await tx.competitionRegistration.delete({ where: { id } });
    await audit(req, { action: "competition.registration_deleted", entityType: "CompetitionRegistration", entityId: id, projectId: reg.projectId, metadata: { competition: reg.competition.name, outcome: reg.outcome } }, tx);
  });
  res.status(204).end();
});
