import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import {
  createMilestoneSchema,
  MILESTONE_STATUSES,
  reviewMilestoneSchema,
  stageGateRequirementSchema,
  submitMilestoneSchema,
} from "@iic/shared";
import { prisma } from "../db.js";
import { requireProjectAccess, visibleProjectsWhere } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { notify, notifyMany } from "../lib/notify.js";
import { touchProject } from "../lib/projects.js";
import { parse, uuidParam } from "../lib/validate.js";
import { currentUser, requireAuth, requireRole } from "../middleware/auth.js";

export const milestonesRouter = Router();
milestonesRouter.use(requireAuth);

const listQuery = z.object({
  status: z.enum(MILESTONE_STATUSES).optional(),
  projectId: z.string().uuid().optional(),
});

/** Review queue / milestone list scoped to the projects the user can see. */
milestonesRouter.get("/milestones", async (req, res) => {
  const user = currentUser(req);
  const q = listQuery.parse(req.query);
  const where: Prisma.MilestoneWhereInput = {
    project: { AND: [visibleProjectsWhere(user), { status: { not: "ARCHIVED" } }] },
    status: q.status,
    projectId: q.projectId,
  };
  const milestones = await prisma.milestone.findMany({
    where,
    select: {
      id: true, title: true, stage: true, status: true, isStageGate: true, dueDate: true, approvedAt: true, updatedAt: true,
      project: { select: { id: true, name: true, stage: true, mentor: { select: { id: true, name: true } } } },
      submissions: {
        orderBy: { submittedAt: "desc" },
        take: 1,
        select: { id: true, status: true, submittedAt: true, notes: true, evidenceUrl: true, submittedBy: { select: { name: true } } },
      },
      _count: { select: { tasks: true } },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
  });
  const counts = await prisma.milestone.groupBy({
    by: ["status"],
    where: { project: { AND: [visibleProjectsWhere(user), { status: { not: "ARCHIVED" } }] } },
    _count: { _all: true },
  });
  res.json({
    milestones,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    canReview: user.role === "ADMIN" || user.role === "MENTOR",
  });
});

milestonesRouter.post("/projects/:projectId/milestones", async (req, res) => {
  const user = currentUser(req);
  const projectId = uuidParam(req.params.projectId, "projectId");
  await requireProjectAccess(user, projectId, "manage");
  const input = parse(createMilestoneSchema, req.body);
  if (input.isStageGate) {
    const existing = await prisma.milestone.findFirst({ where: { projectId, stage: input.stage, isStageGate: true } });
    if (existing) throw conflict("This project already has a stage-gate milestone for that stage");
  }
  const milestone = await prisma.$transaction(async (tx) => {
    const m = await tx.milestone.create({ data: { ...input, projectId } });
    await touchProject(projectId, tx);
    await audit(req, { action: "milestone.created", entityType: "Milestone", entityId: m.id, projectId, metadata: { title: m.title, stage: m.stage, isStageGate: m.isStageGate } }, tx);
    return m;
  });
  res.status(201).json({ milestone });
});

milestonesRouter.get("/milestones/:id", async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const m = await prisma.milestone.findUnique({ where: { id } });
  if (!m) throw notFound("Milestone not found");
  const access = await requireProjectAccess(user, m.projectId);
  const milestone = await prisma.milestone.findUniqueOrThrow({
    where: { id },
    include: {
      project: { select: { id: true, name: true, stage: true } },
      tasks: { select: { id: true, title: true, status: true } },
      submissions: {
        orderBy: { submittedAt: "desc" },
        include: {
          submittedBy: { select: { id: true, name: true } },
          review: { include: { reviewer: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  const requirements = milestone.isStageGate
    ? await prisma.stageGateRequirement.findMany({ where: { stage: milestone.stage, isActive: true }, orderBy: { sortOrder: "asc" } })
    : [];
  res.json({
    milestone,
    requirements,
    access: { canReview: access.canReview, canSubmit: access.isMember || access.isAdmin },
  });
});

milestonesRouter.post("/milestones/:id/submit", async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const m = await prisma.milestone.findUnique({ where: { id } });
  if (!m) throw notFound("Milestone not found");
  const access = await requireProjectAccess(user, m.projectId);
  if (!access.isMember && !access.isAdmin) throw forbidden("Only project members can submit evidence");
  if (access.project.status === "ARCHIVED") throw forbidden("Archived projects are read-only");
  if (m.status !== "OPEN" && m.status !== "CHANGES_REQUESTED") throw conflict(`Milestone is ${m.status.toLowerCase()} and cannot take a new submission`);
  const input = parse(submitMilestoneSchema, req.body);
  const submission = await prisma.$transaction(async (tx) => {
    await tx.milestoneSubmission.updateMany({ where: { milestoneId: id, status: "PENDING" }, data: { status: "SUPERSEDED" } });
    const s = await tx.milestoneSubmission.create({ data: { milestoneId: id, submittedById: user.id, notes: input.notes, evidenceUrl: input.evidenceUrl ?? null } });
    await tx.milestone.update({ where: { id }, data: { status: "SUBMITTED" } });
    await touchProject(m.projectId, tx);
    await audit(req, { action: "milestone.submitted", entityType: "Milestone", entityId: id, projectId: m.projectId, metadata: { submissionId: s.id } }, tx);
    const reviewers = new Set<string>();
    if (access.project.mentorId) reviewers.add(access.project.mentorId);
    if (reviewers.size === 0) {
      const admins = await tx.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
      admins.forEach((a) => reviewers.add(a.id));
    }
    await notifyMany(reviewers, { type: "milestone.submitted", title: `Review requested: ${m.title}`, body: access.project.name, link: `/milestones?open=${id}`, dedupeKey: `milestone-submitted:${s.id}` }, tx);
    return s;
  });
  res.status(201).json({ submission });
});

/** Mentor/admin decision on the latest pending submission. Records reviewer, time and reason. */
milestonesRouter.post("/milestones/:id/review", async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const m = await prisma.milestone.findUnique({ where: { id } });
  if (!m) throw notFound("Milestone not found");
  await requireProjectAccess(user, m.projectId, "review");
  const input = parse(reviewMilestoneSchema, req.body);
  const submission = await prisma.milestoneSubmission.findFirst({ where: { milestoneId: id, status: "PENDING" }, orderBy: { submittedAt: "desc" } });
  if (!submission || m.status !== "SUBMITTED") throw conflict("There is no pending submission to review");
  if (submission.submittedById === user.id) throw forbidden("You cannot review your own submission");
  const approved = input.decision === "APPROVED";
  const review = await prisma.$transaction(async (tx) => {
    const r = await tx.milestoneReview.create({ data: { submissionId: submission.id, reviewerId: user.id, decision: input.decision, comment: input.comment } });
    await tx.milestoneSubmission.update({ where: { id: submission.id }, data: { status: approved ? "APPROVED" : "REJECTED" } });
    await tx.milestone.update({ where: { id }, data: { status: approved ? "APPROVED" : "CHANGES_REQUESTED", approvedAt: approved ? new Date() : null } });
    await touchProject(m.projectId, tx);
    await audit(req, { action: approved ? "milestone.approved" : "milestone.rejected", entityType: "Milestone", entityId: id, projectId: m.projectId, metadata: { submissionId: submission.id, comment: input.comment } }, tx);
    const leads = await tx.projectMembership.findMany({ where: { projectId: m.projectId, role: "LEAD" }, select: { userId: true } });
    await notifyMany([submission.submittedById, ...leads.map((l) => l.userId)], {
      type: approved ? "milestone.approved" : "milestone.rejected",
      title: `${approved ? "Approved" : "Changes requested"}: ${m.title}`,
      body: input.comment.slice(0, 140),
      link: `/milestones?open=${id}`,
      dedupeKey: `milestone-review:${r.id}`,
    }, tx);
    return r;
  });
  res.status(201).json({ review });
});

// ── Admin-configurable stage-gate requirements ──
milestonesRouter.get("/stage-gates", async (_req, res) => {
  const requirements = await prisma.stageGateRequirement.findMany({ orderBy: [{ stage: "asc" }, { sortOrder: "asc" }] });
  res.json({ requirements });
});

milestonesRouter.post("/stage-gates", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(stageGateRequirementSchema, req.body);
  const requirement = await prisma.stageGateRequirement.create({ data: { ...input, updatedById: user.id } });
  await audit(req, { action: "stage_gate.created", entityType: "StageGateRequirement", entityId: requirement.id, metadata: { stage: input.stage, title: input.title } });
  res.status(201).json({ requirement });
});

milestonesRouter.patch("/stage-gates/:id", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const input = parse(stageGateRequirementSchema.partial(), req.body);
  if (Object.keys(input).length === 0) throw badRequest("Nothing to update");
  const requirement = await prisma.stageGateRequirement.update({ where: { id }, data: { ...input, updatedById: user.id } });
  await audit(req, { action: "stage_gate.updated", entityType: "StageGateRequirement", entityId: id, metadata: { fields: Object.keys(input) } });
  res.json({ requirement });
});
