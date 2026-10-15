import { Router } from "express";
import type { Prisma, TaskStatus } from "@prisma/client";
import {
  createTaskSchema,
  isTransitionAllowed,
  moveTaskSchema,
  requiresDependenciesDone,
  taskCommentSchema,
  taskDependencySchema,
  transitionNeedsLead,
  updateTaskSchema,
} from "@iic/shared";
import { prisma, type Tx } from "../db.js";
import { requireProjectAccess, type ProjectAccess } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { touchProject } from "../lib/projects.js";
import { parse, uuidParam } from "../lib/validate.js";
import { publishToUser } from "../realtime.js";
import { currentUser, requireAuth, type AuthUser } from "../middleware/auth.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const taskSelect = {
  id: true, projectId: true, title: true, description: true, status: true, priority: true, position: true,
  startDate: true, dueDate: true, completedAt: true, createdAt: true, updatedAt: true,
  assignee: { select: { id: true, name: true } },
  milestone: { select: { id: true, title: true } },
  dependencies: { select: { dependsOn: { select: { id: true, title: true, status: true } } } },
  _count: { select: { comments: true, attachments: true } },
} satisfies Prisma.TaskSelect;

async function loadTask(user: AuthUser, taskId: string, need: "view" | "manage" = "view") {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw notFound("Task not found");
  // A task's visibility is its project's visibility — 404 if the project is hidden.
  const access = await requireProjectAccess(user, task.projectId, need);
  return { task, access };
}

async function assertMember(projectId: string, userId: string | null | undefined, tx: Tx = prisma) {
  if (!userId) return;
  const m = await tx.projectMembership.findUnique({ where: { projectId_userId: { projectId, userId } } });
  if (!m) throw badRequest("Assignee must be a member of the project");
}

async function assertMilestone(projectId: string, milestoneId: string | null | undefined) {
  if (!milestoneId) return;
  const m = await prisma.milestone.findUnique({ where: { id: milestoneId } });
  if (!m || m.projectId !== projectId) throw badRequest("Milestone must belong to the same project");
}

/** True if adding edge task → dependsOn would create a cycle. */
async function createsCycle(taskId: string, dependsOnId: string): Promise<boolean> {
  if (taskId === dependsOnId) return true;
  const seen = new Set<string>();
  let frontier = [dependsOnId];
  while (frontier.length) {
    const edges = await prisma.taskDependency.findMany({ where: { taskId: { in: frontier } }, select: { dependsOnId: true } });
    const next: string[] = [];
    for (const e of edges) {
      if (e.dependsOnId === taskId) return true;
      if (!seen.has(e.dependsOnId)) {
        seen.add(e.dependsOnId);
        next.push(e.dependsOnId);
      }
    }
    frontier = next;
  }
  return false;
}

function broadcastBoard(access: ProjectAccess, projectId: string, members: string[]) {
  for (const id of new Set([...members, access.project.mentorId ?? ""])) {
    if (id) publishToUser(id, { type: "board", projectId });
  }
}

async function memberIds(projectId: string) {
  const ms = await prisma.projectMembership.findMany({ where: { projectId }, select: { userId: true } });
  return ms.map((m) => m.userId);
}

tasksRouter.get("/tasks/mine", async (req, res) => {
  const user = currentUser(req);
  const tasks = await prisma.task.findMany({
    where: { assigneeId: user.id, status: { not: "DONE" }, project: { status: { not: "ARCHIVED" } } },
    select: { ...taskSelect, project: { select: { id: true, name: true } } },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 50,
  });
  res.json({ tasks });
});

tasksRouter.get("/projects/:projectId/tasks", async (req, res) => {
  const user = currentUser(req);
  const projectId = uuidParam(req.params.projectId, "projectId");
  const access = await requireProjectAccess(user, projectId);
  const [tasks, members, milestones] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, select: taskSelect, orderBy: [{ status: "asc" }, { position: "asc" }, { createdAt: "asc" }] }),
    prisma.projectMembership.findMany({ where: { projectId }, select: { role: true, user: { select: { id: true, name: true } } } }),
    prisma.milestone.findMany({ where: { projectId }, select: { id: true, title: true, status: true }, orderBy: { createdAt: "asc" } }),
  ]);
  res.json({
    project: { id: access.project.id, name: access.project.name, stage: access.project.stage, status: access.project.status },
    tasks,
    members: members.map((m) => ({ ...m.user, membershipRole: m.role })),
    milestones,
    access: { canManage: access.canManage, userId: user.id },
  });
});

tasksRouter.post("/projects/:projectId/tasks", async (req, res) => {
  const user = currentUser(req);
  const projectId = uuidParam(req.params.projectId, "projectId");
  const access = await requireProjectAccess(user, projectId, "manage");
  const input = parse(createTaskSchema, req.body);
  await assertMember(projectId, input.assigneeId);
  await assertMilestone(projectId, input.milestoneId);
  if (input.dependsOn.length) {
    const deps = await prisma.task.count({ where: { id: { in: input.dependsOn }, projectId } });
    if (deps !== new Set(input.dependsOn).size) throw badRequest("Dependencies must be tasks in the same project");
  }
  if (input.startDate && input.dueDate && input.dueDate < input.startDate) throw badRequest("Due date must be after the start date");
  const last = await prisma.task.findFirst({ where: { projectId, status: "TODO" }, orderBy: { position: "desc" }, select: { position: true } });
  const task = await prisma.$transaction(async (tx) => {
    const t = await tx.task.create({
      data: {
        projectId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        assigneeId: input.assigneeId ?? null,
        milestoneId: input.milestoneId ?? null,
        startDate: input.startDate,
        dueDate: input.dueDate,
        createdById: user.id,
        position: (last?.position ?? 0) + 1000,
        dependencies: { create: [...new Set(input.dependsOn)].map((dependsOnId) => ({ dependsOnId })) },
      },
      select: taskSelect,
    });
    await tx.taskStatusHistory.create({ data: { taskId: t.id, toStatus: "TODO", changedById: user.id } });
    await touchProject(projectId, tx);
    await audit(req, { action: "task.created", entityType: "Task", entityId: t.id, projectId, metadata: { title: t.title } }, tx);
    if (t.assignee && t.assignee.id !== user.id) {
      await notify({ userId: t.assignee.id, type: "task.assigned", title: `New task: ${t.title}`, body: access.project.name, link: `/board?project=${projectId}&task=${t.id}`, dedupeKey: `task-assigned:${t.id}:${t.assignee.id}` }, tx);
    }
    return t;
  });
  broadcastBoard(access, projectId, await memberIds(projectId));
  res.status(201).json({ task });
});

tasksRouter.get("/tasks/:id", async (req, res) => {
  const user = currentUser(req);
  const { access } = await loadTask(user, uuidParam(req.params.id));
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: uuidParam(req.params.id) },
    select: {
      ...taskSelect,
      createdBy: { select: { id: true, name: true } },
      dependents: { select: { task: { select: { id: true, title: true, status: true } } } },
      comments: { select: { id: true, body: true, createdAt: true, author: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      statusHistory: { select: { id: true, fromStatus: true, toStatus: true, changedAt: true, changedBy: { select: { name: true } } }, orderBy: { changedAt: "desc" } },
      attachments: { select: { id: true, originalName: true, sizeBytes: true, createdAt: true } },
    },
  });
  res.json({ task, access: { canManage: access.canManage } });
});

tasksRouter.patch("/tasks/:id", async (req, res) => {
  const user = currentUser(req);
  const { task, access } = await loadTask(user, uuidParam(req.params.id), "manage");
  const input = parse(updateTaskSchema, req.body);
  if (input.assigneeId !== undefined) await assertMember(task.projectId, input.assigneeId);
  if (input.milestoneId !== undefined) await assertMilestone(task.projectId, input.milestoneId);
  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.task.update({ where: { id: task.id }, data: input, select: taskSelect });
    await touchProject(task.projectId, tx);
    await audit(req, { action: "task.updated", entityType: "Task", entityId: task.id, projectId: task.projectId, metadata: { fields: Object.keys(input) } }, tx);
    if (input.assigneeId && input.assigneeId !== task.assigneeId && input.assigneeId !== user.id) {
      await notify({ userId: input.assigneeId, type: "task.assigned", title: `Assigned: ${t.title}`, body: access.project.name, link: `/board?project=${task.projectId}&task=${t.id}`, dedupeKey: `task-assigned:${t.id}:${input.assigneeId}` }, tx);
    }
    return t;
  });
  broadcastBoard(access, task.projectId, await memberIds(task.projectId));
  res.json({ task: updated });
});

/**
 * Kanban move. Validates the transition graph, dependency completion and who may
 * make the move. Task completion never changes milestone, stage or funding state.
 */
tasksRouter.post("/tasks/:id/move", async (req, res) => {
  const user = currentUser(req);
  const { task, access } = await loadTask(user, uuidParam(req.params.id));
  const { status, position } = parse(moveTaskSchema, req.body);
  const from = task.status;
  if (access.project.status === "ARCHIVED") throw forbidden("Archived projects are read-only");

  const isAssignee = task.assigneeId === user.id;
  if (from !== status) {
    if (!isTransitionAllowed(from, status)) {
      throw new HttpError(400, `Cannot move a task from ${from} to ${status}`, "INVALID_TRANSITION");
    }
    if (transitionNeedsLead(from, status) && !access.canManage) {
      throw forbidden("Only the project lead or an admin can accept or reopen completed work");
    }
    if (!access.canManage && !isAssignee) throw forbidden("Only the assignee or project lead can move this task");
    if (requiresDependenciesDone(status)) {
      const blocking = await prisma.taskDependency.findMany({
        where: { taskId: task.id, dependsOn: { status: { not: "DONE" } } },
        select: { dependsOn: { select: { id: true, title: true } } },
      });
      if (blocking.length) {
        throw conflict(`Blocked by unfinished dependencies: ${blocking.map((b) => b.dependsOn.title).join(", ")}`, "BLOCKED_BY_DEPENDENCIES");
      }
    }
  } else if (!access.canManage && !isAssignee) {
    throw forbidden("Only the assignee or project lead can reorder this task");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.task.update({
      where: { id: task.id },
      data: {
        status,
        position: position ?? task.position,
        completedAt: status === "DONE" ? (from === "DONE" ? task.completedAt : new Date()) : null,
        startDate: status === "IN_PROGRESS" && !task.startDate ? new Date() : undefined,
      },
      select: taskSelect,
    });
    if (from !== status) {
      await tx.taskStatusHistory.create({ data: { taskId: task.id, fromStatus: from, toStatus: status as TaskStatus, changedById: user.id } });
      await audit(req, { action: "task.status_changed", entityType: "Task", entityId: task.id, projectId: task.projectId, metadata: { from, to: status } }, tx);
      if (status === "REVIEW") {
        const leads = await tx.projectMembership.findMany({ where: { projectId: task.projectId, role: "LEAD" }, select: { userId: true } });
        for (const l of leads) {
          if (l.userId !== user.id) await notify({ userId: l.userId, type: "task.review", title: `Ready for review: ${t.title}`, link: `/board?project=${task.projectId}&task=${t.id}`, dedupeKey: `task-review:${t.id}:${Date.now()}` }, tx);
        }
      }
      if (status === "DONE" && task.assigneeId && task.assigneeId !== user.id) {
        await notify({ userId: task.assigneeId, type: "task.done", title: `Accepted: ${t.title}`, link: `/board?project=${task.projectId}&task=${t.id}`, dedupeKey: `task-done:${t.id}:${Date.now()}` }, tx);
      }
    }
    await touchProject(task.projectId, tx);
    return t;
  });
  broadcastBoard(access, task.projectId, await memberIds(task.projectId));
  res.json({ task: updated });
});

tasksRouter.delete("/tasks/:id", async (req, res) => {
  const user = currentUser(req);
  const { task, access } = await loadTask(user, uuidParam(req.params.id), "manage");
  await prisma.$transaction(async (tx) => {
    await tx.task.delete({ where: { id: task.id } });
    await audit(req, { action: "task.deleted", entityType: "Task", entityId: task.id, projectId: task.projectId, metadata: { title: task.title } }, tx);
  });
  broadcastBoard(access, task.projectId, await memberIds(task.projectId));
  res.status(204).end();
});

tasksRouter.post("/tasks/:id/dependencies", async (req, res) => {
  const user = currentUser(req);
  const { task } = await loadTask(user, uuidParam(req.params.id), "manage");
  const { dependsOnId } = parse(taskDependencySchema, req.body);
  const dep = await prisma.task.findUnique({ where: { id: dependsOnId } });
  if (!dep || dep.projectId !== task.projectId) throw badRequest("Dependency must be a task in the same project");
  if (await createsCycle(task.id, dependsOnId)) throw conflict("That dependency would create a cycle", "DEPENDENCY_CYCLE");
  const created = await prisma.$transaction(async (tx) => {
    const d = await tx.taskDependency.create({ data: { taskId: task.id, dependsOnId } });
    await audit(req, { action: "task.dependency_added", entityType: "Task", entityId: task.id, projectId: task.projectId, metadata: { dependsOnId } }, tx);
    return d;
  });
  res.status(201).json({ dependency: created });
});

tasksRouter.delete("/tasks/:id/dependencies/:dependsOnId", async (req, res) => {
  const user = currentUser(req);
  const { task } = await loadTask(user, uuidParam(req.params.id), "manage");
  const dependsOnId = uuidParam(req.params.dependsOnId, "dependsOnId");
  const result = await prisma.taskDependency.deleteMany({ where: { taskId: task.id, dependsOnId } });
  if (result.count === 0) throw notFound("Dependency not found");
  await audit(req, { action: "task.dependency_removed", entityType: "Task", entityId: task.id, projectId: task.projectId, metadata: { dependsOnId } });
  res.status(204).end();
});

tasksRouter.post("/tasks/:id/comments", async (req, res) => {
  const user = currentUser(req);
  const { task } = await loadTask(user, uuidParam(req.params.id));
  const { body } = parse(taskCommentSchema, req.body);
  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.taskComment.create({ data: { taskId: task.id, authorId: user.id, body }, select: { id: true, body: true, createdAt: true, author: { select: { id: true, name: true } } } });
    await touchProject(task.projectId, tx);
    if (task.assigneeId && task.assigneeId !== user.id) {
      await notify({ userId: task.assigneeId, type: "task.comment", title: `New comment on ${task.title}`, body: body.slice(0, 140), link: `/board?project=${task.projectId}&task=${task.id}`, dedupeKey: `task-comment:${c.id}` }, tx);
    }
    return c;
  });
  res.status(201).json({ comment });
});
