import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { loginAs, resetDb, world } from "./helpers.js";

let w: Awaited<ReturnType<typeof world>>;
beforeEach(async () => {
  await resetDb();
  w = await world();
});

async function newTask(body: Record<string, unknown>) {
  const lead = await loginAs(w.lead.email);
  const res = await lead.post(`/api/projects/${w.project.id}/tasks`).send(body);
  expect(res.status).toBe(201);
  return res.body.task as { id: string };
}

describe("tasks & kanban workflow", () => {
  it("lead creates tasks; members cannot; assignee must be a project member", async () => {
    const member = await loginAs(w.member.email);
    expect((await member.post(`/api/projects/${w.project.id}/tasks`).send({ title: "x" })).status).toBe(403);
    const lead = await loginAs(w.lead.email);
    expect((await lead.post(`/api/projects/${w.project.id}/tasks`).send({ title: "x", assigneeId: w.outsider.id })).status).toBe(400);
    await newTask({ title: "ok", assigneeId: w.member.id });
    expect(await prisma.notification.count({ where: { userId: w.member.id, type: "task.assigned" } })).toBe(1);
  });

  it("enforces the transition graph", async () => {
    const t = await newTask({ title: "a", assigneeId: w.member.id });
    const member = await loginAs(w.member.email);
    const skip = await member.post(`/api/tasks/${t.id}/move`).send({ status: "DONE" });
    expect(skip.status).toBe(400);
    expect(skip.body.error.code).toBe("INVALID_TRANSITION");
    await member.post(`/api/tasks/${t.id}/move`).send({ status: "IN_PROGRESS" }).expect(200);
    await member.post(`/api/tasks/${t.id}/move`).send({ status: "REVIEW" }).expect(200);
  });

  it("only the lead accepts work into DONE; the assignee cannot", async () => {
    const t = await newTask({ title: "a", assigneeId: w.member.id });
    const member = await loginAs(w.member.email);
    await member.post(`/api/tasks/${t.id}/move`).send({ status: "IN_PROGRESS" }).expect(200);
    await member.post(`/api/tasks/${t.id}/move`).send({ status: "REVIEW" }).expect(200);
    expect((await member.post(`/api/tasks/${t.id}/move`).send({ status: "DONE" })).status).toBe(403);
    const lead = await loginAs(w.lead.email);
    const done = await lead.post(`/api/tasks/${t.id}/move`).send({ status: "DONE" });
    expect(done.status).toBe(200);
    expect(done.body.task.completedAt).toBeTruthy();
    const history = await prisma.taskStatusHistory.findMany({ where: { taskId: t.id } });
    expect(history.map((h) => h.toStatus)).toEqual(["TODO", "IN_PROGRESS", "REVIEW", "DONE"]);
  });

  it("non-assignee members cannot move someone else's task", async () => {
    const t = await newTask({ title: "a", assigneeId: w.lead.id });
    const member = await loginAs(w.member.email);
    expect((await member.post(`/api/tasks/${t.id}/move`).send({ status: "IN_PROGRESS" })).status).toBe(403);
  });

  it("blocks starting a task until its dependencies are done", async () => {
    const a = await newTask({ title: "a" });
    const b = await newTask({ title: "b", dependsOn: [a.id] });
    const lead = await loginAs(w.lead.email);
    const blocked = await lead.post(`/api/tasks/${b.id}/move`).send({ status: "IN_PROGRESS" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("BLOCKED_BY_DEPENDENCIES");
    for (const s of ["IN_PROGRESS", "REVIEW", "DONE"]) await lead.post(`/api/tasks/${a.id}/move`).send({ status: s }).expect(200);
    await lead.post(`/api/tasks/${b.id}/move`).send({ status: "IN_PROGRESS" }).expect(200);
  });

  it("prevents dependency cycles and cross-project dependencies", async () => {
    const a = await newTask({ title: "a" });
    const b = await newTask({ title: "b", dependsOn: [a.id] });
    const lead = await loginAs(w.lead.email);
    const cycle = await lead.post(`/api/tasks/${a.id}/dependencies`).send({ dependsOnId: b.id });
    expect(cycle.status).toBe(409);
    const foreign = await prisma.task.create({ data: { projectId: w.otherProject.id, title: "f", createdById: w.admin.id } });
    expect((await lead.post(`/api/tasks/${a.id}/dependencies`).send({ dependsOnId: foreign.id })).status).toBe(400);
  });

  it("completing tasks never approves milestones or changes the stage", async () => {
    const ms = await prisma.milestone.create({ data: { projectId: w.project.id, title: "Gate", stage: "IDEATION", isStageGate: true } });
    const t = await newTask({ title: "a", milestoneId: ms.id });
    const lead = await loginAs(w.lead.email);
    for (const s of ["IN_PROGRESS", "REVIEW", "DONE"]) await lead.post(`/api/tasks/${t.id}/move`).send({ status: s }).expect(200);
    expect((await prisma.milestone.findUniqueOrThrow({ where: { id: ms.id } })).status).toBe("OPEN");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: w.project.id } })).stage).toBe("IDEATION");
  });

  it("outsiders cannot read or comment on another project's task", async () => {
    const t = await newTask({ title: "secret" });
    const outsider = await loginAs(w.outsider.email);
    expect((await outsider.get(`/api/tasks/${t.id}`)).status).toBe(404);
    expect((await outsider.post(`/api/tasks/${t.id}/comments`).send({ body: "hi" })).status).toBe(404);
    const mentor = await loginAs(w.mentor.email);
    expect((await mentor.post(`/api/tasks/${t.id}/comments`).send({ body: "looks good" })).status).toBe(201);
  });
});
