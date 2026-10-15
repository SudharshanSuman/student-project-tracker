import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { loginAs, resetDb, world } from "./helpers.js";

let w: Awaited<ReturnType<typeof world>>;
beforeEach(async () => {
  await resetDb();
  w = await world();
});

describe("project access & isolation", () => {
  it("members see only their own projects; other projects are 404", async () => {
    const agent = await loginAs(w.member.email);
    const list = await agent.get("/api/projects");
    expect(list.body.projects.map((p: { name: string }) => p.name)).toEqual(["Alpha"]);
    expect((await agent.get(`/api/projects/${w.otherProject.id}`)).status).toBe(404);
    expect((await agent.get(`/api/projects/${w.otherProject.id}/tasks`)).status).toBe(404);
  });

  it("mentors see only projects they mentor", async () => {
    const agent = await loginAs(w.otherMentor.email);
    const list = await agent.get("/api/projects");
    expect(list.body.projects.map((p: { name: string }) => p.name)).toEqual(["Beta"]);
    expect((await agent.get(`/api/projects/${w.project.id}`)).status).toBe(404);
  });

  it("admins see everything", async () => {
    const agent = await loginAs(w.admin.email);
    expect((await agent.get("/api/projects")).body.total).toBe(2);
  });

  it("rejects malformed ids", async () => {
    const agent = await loginAs(w.admin.email);
    expect((await agent.get("/api/projects/not-a-uuid")).status).toBe(400);
  });

  it("hides funding from plain members", async () => {
    const res = await (await loginAs(w.member.email)).get(`/api/projects/${w.project.id}`);
    expect(res.body.project.funding).toBeNull();
    const lead = await (await loginAs(w.lead.email)).get(`/api/projects/${w.project.id}`);
    expect(lead.body.project.funding).toEqual([]);
  });
});

describe("project management", () => {
  it("admin creates a project with lead and mentor, audited", async () => {
    const agent = await loginAs(w.admin.email);
    const res = await agent.post("/api/projects").send({ name: "Gamma", description: "d", category: "c", leadId: w.lead.id, mentorId: w.mentor.id });
    expect(res.status).toBe(201);
    const m = await prisma.projectMembership.findFirstOrThrow({ where: { projectId: res.body.project.id } });
    expect(m).toMatchObject({ userId: w.lead.id, role: "LEAD" });
    expect(await prisma.auditLog.count({ where: { action: "project.created", entityId: res.body.project.id } })).toBe(1);
  });

  it("members cannot create projects; leads cannot assign mentors", async () => {
    expect((await (await loginAs(w.member.email)).post("/api/projects").send({ name: "X", description: "d", category: "c" })).status).toBe(403);
    expect((await (await loginAs(w.lead.email)).post("/api/projects").send({ name: "X", description: "d", category: "c", mentorId: w.mentor.id })).status).toBe(403);
  });

  it("lead adds members but cannot appoint another lead; members cannot add", async () => {
    const lead = await loginAs(w.lead.email);
    expect((await lead.post(`/api/projects/${w.project.id}/members`).send({ userId: w.outsider.id, role: "LEAD" })).status).toBe(403);
    expect((await lead.post(`/api/projects/${w.project.id}/members`).send({ userId: w.outsider.id })).status).toBe(201);
    expect((await lead.post(`/api/projects/${w.project.id}/members`).send({ userId: w.outsider.id })).status).toBe(409);
    const member = await loginAs(w.member.email);
    expect((await member.post(`/api/projects/${w.project.id}/members`).send({ userId: w.otherLead.id })).status).toBe(403);
  });

  it("only admins change mentor; lead can edit description", async () => {
    const lead = await loginAs(w.lead.email);
    expect((await lead.patch(`/api/projects/${w.project.id}`).send({ mentorId: w.otherMentor.id })).status).toBe(403);
    expect((await lead.patch(`/api/projects/${w.project.id}`).send({ description: "new" })).status).toBe(200);
  });

  it("archived projects are read-only for leads", async () => {
    await (await loginAs(w.admin.email)).post(`/api/projects/${w.project.id}/archive`).expect(200);
    const lead = await loginAs(w.lead.email);
    expect((await lead.patch(`/api/projects/${w.project.id}`).send({ description: "x" })).status).toBe(403);
    expect((await lead.post(`/api/projects/${w.project.id}/tasks`).send({ title: "t" })).status).toBe(403);
  });
});

describe("stage gates", () => {
  it("advancing requires an approved gate (mentor) and is never automatic", async () => {
    const mentor = await loginAs(w.mentor.email);
    const blocked = await mentor.post(`/api/projects/${w.project.id}/stage`).send({ toStage: "POC", reason: "ready" });
    expect(blocked.status).toBe(400);
    await prisma.milestone.create({ data: { projectId: w.project.id, title: "Gate", stage: "IDEATION", isStageGate: true, status: "APPROVED" } });
    const ok = await mentor.post(`/api/projects/${w.project.id}/stage`).send({ toStage: "POC", reason: "ready" });
    expect(ok.status).toBe(200);
    expect(ok.body.project.stage).toBe("POC");
  });

  it("leads and unassigned mentors cannot change stage; admins can override with a recorded reason", async () => {
    expect((await (await loginAs(w.lead.email)).post(`/api/projects/${w.project.id}/stage`).send({ toStage: "POC", reason: "r" })).status).toBe(403);
    expect((await (await loginAs(w.otherMentor.email)).post(`/api/projects/${w.project.id}/stage`).send({ toStage: "POC", reason: "r" })).status).toBe(404);
    const res = await (await loginAs(w.admin.email)).post(`/api/projects/${w.project.id}/stage`).send({ toStage: "POC", reason: "committee decision" });
    expect(res.status).toBe(200);
    const h = await prisma.projectStageHistory.findFirstOrThrow({ where: { projectId: w.project.id, toStage: "POC" } });
    expect(h.reason).toContain("[admin override]");
  });
});
