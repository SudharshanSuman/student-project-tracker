import { Router } from "express";
import type { Prisma } from "@prisma/client";
import {
  addMemberSchema,
  changeStageSchema,
  createProjectSchema,
  paginationSchema,
  projectListQuerySchema,
  stageIndex,
  updateProjectSchema,
} from "@iic/shared";
import { prisma } from "../db.js";
import { requireProjectAccess, visibleProjectsWhere } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { healthFor, slugify, touchProject } from "../lib/projects.js";
import { pageArgs, parse, uuidParam } from "../lib/validate.js";
import { currentUser, requireAuth, requireRole } from "../middleware/auth.js";

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const listSelect = {
  id: true, name: true, slug: true, description: true, logoUrl: true, category: true, stage: true,
  status: true, repoUrl: true, lastActivityAt: true, createdAt: true,
  cohort: { select: { id: true, name: true } },
  mentor: { select: { id: true, name: true } },
  memberships: { where: { role: "LEAD" }, select: { user: { select: { id: true, name: true } } }, take: 1 },
  _count: { select: { memberships: true, tasks: true, milestones: true } },
} satisfies Prisma.ProjectSelect;

projectsRouter.get("/", async (req, res) => {
  const user = currentUser(req);
  const q = projectListQuerySchema.parse(req.query);
  const where: Prisma.ProjectWhereInput = {
    AND: [
      visibleProjectsWhere(user),
      q.stage ? { stage: q.stage } : {},
      q.status ? { status: q.status } : { status: { not: "ARCHIVED" } },
      q.cohortId ? { cohortId: q.cohortId } : {},
      q.mentorId ? { mentorId: q.mentorId } : {},
      q.q
        ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { description: { contains: q.q, mode: "insensitive" } }, { category: { contains: q.q, mode: "insensitive" } }] }
        : {},
    ],
  };
  const [total, projects] = await prisma.$transaction([
    prisma.project.count({ where }),
    prisma.project.findMany({ where, select: listSelect, orderBy: { [q.sort]: q.order }, ...pageArgs(q.page, q.pageSize) }),
  ]);
  const health = await healthFor(projects);
  res.json({
    projects: projects.map(({ memberships, ...p }) => ({ ...p, lead: memberships[0]?.user ?? null, ...health.get(p.id) })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  });
});

/** Minimal list for selectors (board picker, forms). */
projectsRouter.get("/options", async (req, res) => {
  const user = currentUser(req);
  const projects = await prisma.project.findMany({
    where: { AND: [visibleProjectsWhere(user), { status: { not: "ARCHIVED" } }] },
    select: { id: true, name: true, stage: true },
    orderBy: { name: "asc" },
  });
  res.json({ projects });
});

projectsRouter.post("/", requireRole("ADMIN", "PROJECT_LEAD"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(createProjectSchema, req.body);
  // Only admins assign mentors or choose a different lead.
  const isAdmin = user.role === "ADMIN";
  const leadId = isAdmin ? input.leadId ?? null : user.id;
  if (!isAdmin && input.mentorId) throw forbidden("Only admins assign mentors");
  if (input.mentorId) {
    const mentor = await prisma.user.findUnique({ where: { id: input.mentorId } });
    if (!mentor || mentor.role !== "MENTOR" || mentor.status !== "ACTIVE") throw badRequest("Mentor must be an active user with the MENTOR role");
  }
  if (leadId) {
    const lead = await prisma.user.findUnique({ where: { id: leadId } });
    if (!lead || lead.status !== "ACTIVE") throw badRequest("Lead must be an active user");
  }
  const project = await prisma.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        name: input.name,
        slug: slugify(input.name),
        description: input.description,
        category: input.category,
        stage: input.stage,
        repoUrl: input.repoUrl ?? null,
        logoUrl: input.logoUrl ?? null,
        cohortId: input.cohortId ?? null,
        mentorId: isAdmin ? input.mentorId ?? null : null,
        createdById: user.id,
      },
    });
    if (leadId) await tx.projectMembership.create({ data: { projectId: p.id, userId: leadId, role: "LEAD" } });
    await tx.projectStageHistory.create({ data: { projectId: p.id, toStage: p.stage, changedById: user.id, reason: "Project created" } });
    await audit(req, { action: "project.created", entityType: "Project", entityId: p.id, projectId: p.id, metadata: { name: p.name, leadId, mentorId: p.mentorId } }, tx);
    if (leadId && leadId !== user.id) {
      await notify({ userId: leadId, type: "project.assigned", title: `You lead ${p.name}`, link: `/projects/${p.id}`, dedupeKey: `project-lead:${p.id}:${leadId}` }, tx);
    }
    if (p.mentorId) {
      await notify({ userId: p.mentorId, type: "project.assigned", title: `You mentor ${p.name}`, link: `/projects/${p.id}`, dedupeKey: `project-mentor:${p.id}:${p.mentorId}` }, tx);
    }
    return p;
  });
  res.status(201).json({ project });
});

projectsRouter.get("/:id", async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const access = await requireProjectAccess(user, id);
  const project = await prisma.project.findUniqueOrThrow({
    where: { id },
    include: {
      cohort: { select: { id: true, name: true, term: true } },
      mentor: { select: { id: true, name: true, email: true } },
      createdBy: { select: { id: true, name: true } },
      memberships: {
        select: { id: true, role: true, joinedAt: true, user: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
      },
      milestones: { orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }], select: { id: true, title: true, stage: true, status: true, isStageGate: true, dueDate: true } },
      stageHistory: { orderBy: { createdAt: "desc" }, include: { changedBy: { select: { name: true } } } },
      // Explicit select: mentor notes are not for plain members (see routes/competitions.ts).
      registrations: { select: { id: true, status: true, outcome: true, outcomeVerifiedAt: true, competition: { select: { id: true, name: true, organizer: true, submissionDeadline: true } } }, orderBy: { createdAt: "desc" } },
      github: { select: { owner: true, repo: true, status: true, lastSyncedAt: true, latestCommitAt: true } },
      documents: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true, uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
  // Funding detail is visible to staff and the project lead only.
  const canSeeFunding = access.isAdmin || access.isMentor || access.isLead;
  const funding = canSeeFunding
    ? await prisma.fundingAward.findMany({
        where: { projectId: id },
        select: { id: true, title: true, source: true, amount: true, currency: true, verification: true, awardedAt: true },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const health = (await healthFor([project])).get(id);
  res.json({
    project: { ...project, funding, ...health },
    access: {
      canManage: access.canManage,
      canReview: access.canReview,
      isAdmin: access.isAdmin,
      isLead: access.isLead,
      isMember: access.isMember,
    },
  });
});

projectsRouter.patch("/:id", async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const access = await requireProjectAccess(user, id, "manage");
  const input = parse(updateProjectSchema, req.body);
  if (!access.isAdmin && (input.mentorId !== undefined || input.cohortId !== undefined || input.status !== undefined)) {
    throw forbidden("Only admins change mentor, cohort or status");
  }
  if (input.status === "ARCHIVED") throw badRequest("Use the archive action to archive a project");
  if (input.mentorId) {
    const mentor = await prisma.user.findUnique({ where: { id: input.mentorId } });
    if (!mentor || mentor.role !== "MENTOR" || mentor.status !== "ACTIVE") throw badRequest("Mentor must be an active user with the MENTOR role");
  }
  const before = access.project;
  const project = await prisma.$transaction(async (tx) => {
    const p = await tx.project.update({ where: { id }, data: { ...input, lastActivityAt: new Date() } });
    const changed = Object.keys(input).filter((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((p as Record<string, unknown>)[k]));
    await audit(req, { action: "project.updated", entityType: "Project", entityId: id, projectId: id, metadata: { changed } }, tx);
    if (input.mentorId && input.mentorId !== before.mentorId) {
      await notify({ userId: input.mentorId, type: "project.assigned", title: `You mentor ${p.name}`, link: `/projects/${p.id}`, dedupeKey: `project-mentor:${p.id}:${input.mentorId}` }, tx);
    }
    return p;
  });
  res.json({ project });
});

projectsRouter.post("/:id/archive", requireRole("ADMIN"), async (req, res) => {
  const id = uuidParam(req.params.id);
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) throw notFound("Project not found");
  if (project.status === "ARCHIVED") throw conflict("Project is already archived");
  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    await audit(req, { action: "project.archived", entityType: "Project", entityId: id, projectId: id }, tx);
  });
  res.json({ ok: true });
});

projectsRouter.post("/:id/restore", requireRole("ADMIN"), async (req, res) => {
  const id = uuidParam(req.params.id);
  const result = await prisma.project.updateMany({ where: { id, status: "ARCHIVED" }, data: { status: "ACTIVE", archivedAt: null } });
  if (result.count === 0) throw notFound("No archived project with that id");
  await audit(req, { action: "project.restored", entityType: "Project", entityId: id, projectId: id });
  res.json({ ok: true });
});

// ── Membership ──
projectsRouter.post("/:id/members", async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const access = await requireProjectAccess(user, id, "manage");
  const input = parse(addMemberSchema, req.body);
  if (input.role === "LEAD" && !access.isAdmin) throw forbidden("Only admins can appoint a project lead");
  const target = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!target || target.status !== "ACTIVE") throw badRequest("User must be active");
  if (target.role === "ADMIN" || target.role === "MENTOR") throw badRequest("Admins and mentors are not added as team members");
  const membership = await prisma.$transaction(async (tx) => {
    const m = await tx.projectMembership.create({ data: { projectId: id, userId: input.userId, role: input.role } });
    await touchProject(id, tx);
    await audit(req, { action: "project.member_added", entityType: "ProjectMembership", entityId: m.id, projectId: id, metadata: { userId: input.userId, role: input.role } }, tx);
    await notify({ userId: input.userId, type: "project.member_added", title: `You joined ${access.project.name}`, link: `/projects/${id}`, dedupeKey: `member:${id}:${input.userId}:${m.id}` }, tx);
    return m;
  });
  res.status(201).json({ membership });
});

projectsRouter.delete("/:id/members/:userId", async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const userId = uuidParam(req.params.userId, "userId");
  const access = await requireProjectAccess(user, id, "manage");
  const membership = await prisma.projectMembership.findUnique({ where: { projectId_userId: { projectId: id, userId } } });
  if (!membership) throw notFound("Membership not found");
  if (membership.role === "LEAD" && !access.isAdmin) throw forbidden("Only admins can remove a project lead");
  await prisma.$transaction(async (tx) => {
    await tx.projectMembership.delete({ where: { id: membership.id } });
    await tx.task.updateMany({ where: { projectId: id, assigneeId: userId, status: { not: "DONE" } }, data: { assigneeId: null } });
    await audit(req, { action: "project.member_removed", entityType: "ProjectMembership", entityId: membership.id, projectId: id, metadata: { userId } }, tx);
  });
  res.status(204).end();
});

/**
 * Stage advancement is an explicit, authorised decision (mentor/admin) — never a side
 * effect of task completion. Moving forward requires an APPROVED stage-gate milestone for
 * the current stage; admins may override with a recorded reason.
 */
projectsRouter.post("/:id/stage", async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const access = await requireProjectAccess(user, id, "review");
  const { toStage, reason } = parse(changeStageSchema, req.body);
  const from = access.project.stage;
  if (from === toStage) throw badRequest("Project is already in that stage");
  const forward = stageIndex(toStage) > stageIndex(from);
  if (forward && stageIndex(toStage) - stageIndex(from) > 1 && !access.isAdmin) throw forbidden("Only admins can skip stages");
  let override = false;
  if (forward) {
    const approvedGate = await prisma.milestone.findFirst({ where: { projectId: id, stage: from, isStageGate: true, status: "APPROVED" } });
    if (!approvedGate) {
      if (!access.isAdmin) throw badRequest("The current stage-gate milestone must be approved before advancing");
      override = true;
    }
  }
  const project = await prisma.$transaction(async (tx) => {
    const p = await tx.project.update({ where: { id }, data: { stage: toStage, lastActivityAt: new Date() } });
    await tx.projectStageHistory.create({ data: { projectId: id, fromStage: from, toStage, changedById: user.id, reason: override ? `[admin override] ${reason}` : reason } });
    await audit(req, { action: "project.stage_changed", entityType: "Project", entityId: id, projectId: id, metadata: { from, to: toStage, override } }, tx);
    const members = await tx.projectMembership.findMany({ where: { projectId: id }, select: { userId: true } });
    for (const m of members) {
      await notify({ userId: m.userId, type: "project.stage_changed", title: `${p.name} moved to ${toStage.replace("_", " ")}`, link: `/projects/${id}`, dedupeKey: `stage:${id}:${toStage}:${Date.now()}` }, tx);
    }
    return p;
  });
  res.json({ project });
});

projectsRouter.get("/:id/activity", async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  await requireProjectAccess(user, id);
  const q = paginationSchema.parse(req.query);
  const [total, entries] = await prisma.$transaction([
    prisma.auditLog.count({ where: { projectId: id } }),
    prisma.auditLog.findMany({
      where: { projectId: id },
      select: { id: true, action: true, entityType: true, entityId: true, metadata: true, createdAt: true, actor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      ...pageArgs(q.page, q.pageSize),
    }),
  ]);
  res.json({ entries, total, page: q.page, pageSize: q.pageSize });
});
