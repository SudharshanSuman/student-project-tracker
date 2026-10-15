import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { loginAs, resetDb, world } from "./helpers.js";

type World = Awaited<ReturnType<typeof world>>;
let w: World;

beforeEach(async () => {
  await resetDb();
  w = await world();
});

async function createCompetition(name = "Smart India Hackathon") {
  const admin = await loginAs(w.admin.email);
  const res = await admin.post("/api/competitions").send({ name, organizer: "AICTE", submissionDeadline: "2026-12-01", endDate: "2026-12-10" });
  expect(res.status).toBe(201);
  return res.body.competition.id as string;
}

describe("competition CRUD + authorization", () => {
  it("staff create competitions; students cannot; everyone can search the directory", async () => {
    const mentor = await loginAs(w.mentor.email);
    expect((await mentor.post("/api/competitions").send({ name: "HackMIT", organizer: "MIT" })).status).toBe(201);
    const lead = await loginAs(w.lead.email);
    expect((await lead.post("/api/competitions").send({ name: "X", organizer: "Y" })).status).toBe(403);
    const member = await loginAs(w.member.email);
    const list = await member.get("/api/competitions?q=hackm");
    expect(list.status).toBe(200);
    expect(list.body.competitions.map((c: { name: string }) => c.name)).toEqual(["HackMIT"]);
  });

  it("validates dates and URLs", async () => {
    const admin = await loginAs(w.admin.email);
    const bad = await admin.post("/api/competitions").send({ name: "A", organizer: "B", startDate: "2026-05-02", endDate: "2026-05-01" });
    expect(bad.status).toBe(400);
    const badUrl = await admin.post("/api/competitions").send({ name: "A", organizer: "B", registrationUrl: "javascript:alert(1)" });
    expect(badUrl.status).toBe(400);
  });

  it("only the creator or an admin edits; only admins delete, and never with registrations", async () => {
    const id = await createCompetition();
    const mentor = await loginAs(w.mentor.email);
    expect((await mentor.patch(`/api/competitions/${id}`).send({ eligibility: "UG students" })).status).toBe(403);
    const admin = await loginAs(w.admin.email);
    expect((await admin.patch(`/api/competitions/${id}`).send({ eligibility: "UG students" })).status).toBe(200);
    const lead = await loginAs(w.lead.email);
    expect((await lead.post(`/api/competitions/${id}/registrations`).send({ projectId: w.project.id })).status).toBe(201);
    expect((await mentor.delete(`/api/competitions/${id}`)).status).toBe(403);
    expect((await admin.delete(`/api/competitions/${id}`)).status).toBe(409);
  });
});

describe("registrations and outcomes", () => {
  it("lead registers own project; cannot register someone else's (404, no leak); duplicates rejected", async () => {
    const id = await createCompetition();
    const lead = await loginAs(w.lead.email);
    expect((await lead.post(`/api/competitions/${id}/registrations`).send({ projectId: w.otherProject.id })).status).toBe(404);
    expect((await lead.post(`/api/competitions/${id}/registrations`).send({ projectId: w.project.id })).status).toBe(201);
    expect((await lead.post(`/api/competitions/${id}/registrations`).send({ projectId: w.project.id })).status).toBe(409);
    const member = await loginAs(w.member.email);
    expect((await member.post(`/api/competitions/${id}/registrations`).send({ projectId: w.project.id })).status).toBe(403);
  });

  it("outcome claims stay unverified until the assigned mentor verifies; changes reset verification", async () => {
    const id = await createCompetition();
    const lead = await loginAs(w.lead.email);
    const reg = (await lead.post(`/api/competitions/${id}/registrations`).send({ projectId: w.project.id })).body.registration;
    const claim = await lead.patch(`/api/competition-registrations/${reg.id}`).send({ outcome: "WINNER" });
    expect(claim.status).toBe(200);
    expect(claim.body.registration.outcomeVerifiedAt).toBeNull();

    // Lead cannot self-verify; the other project's mentor cannot even see it.
    expect((await lead.post(`/api/competition-registrations/${reg.id}/verify-outcome`).send({ note: "trust me" })).status).toBe(403);
    const otherMentor = await loginAs(w.otherMentor.email);
    expect((await otherMentor.post(`/api/competition-registrations/${reg.id}/verify-outcome`).send({ note: "x" })).status).toBe(404);

    const mentor = await loginAs(w.mentor.email);
    expect((await mentor.post(`/api/competition-registrations/${reg.id}/verify-outcome`).send({})).status).toBe(400); // note required
    const v = await mentor.post(`/api/competition-registrations/${reg.id}/verify-outcome`).send({ note: "Certificate checked" });
    expect(v.status).toBe(200);
    expect(v.body.registration.outcomeVerifiedBy.id).toBe(w.mentor.id);

    // A verified outcome cannot be changed by the lead.
    expect((await lead.patch(`/api/competition-registrations/${reg.id}`).send({ outcome: "FINALIST" })).status).toBe(403);
    // A reviewer change clears the verification.
    const changed = await mentor.patch(`/api/competition-registrations/${reg.id}`).send({ outcome: "FINALIST" });
    expect(changed.body.registration.outcomeVerifiedAt).toBeNull();
    const logs = await prisma.auditLog.findMany({ where: { entityId: reg.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["competition.registered", "competition.outcome_claimed", "competition.outcome_verified", "competition.outcome_claimed"]);
  });

  it("mentor notes are hidden from plain members", async () => {
    const id = await createCompetition();
    const mentor = await loginAs(w.mentor.email);
    const reg = (await mentor.post(`/api/competitions/${id}/registrations`).send({ projectId: w.project.id })).body.registration;
    const lead = await loginAs(w.lead.email);
    expect((await lead.patch(`/api/competition-registrations/${reg.id}`).send({ mentorNotes: "x" })).status).toBe(403);
    await mentor.patch(`/api/competition-registrations/${reg.id}`).send({ mentorNotes: "Strong pitch" });
    const member = await loginAs(w.member.email);
    const asMember = await member.get(`/api/projects/${w.project.id}/competitions`);
    expect(asMember.body.registrations[0].mentorNotes).toBeNull();
    const projectView = await member.get(`/api/projects/${w.project.id}`);
    expect(projectView.body.project.registrations[0]).not.toHaveProperty("mentorNotes");
    const asLead = await lead.get(`/api/projects/${w.project.id}/competitions`);
    expect(asLead.body.registrations[0].mentorNotes).toBe("Strong pitch");
  });

  it("leaderboard counts verified outcomes only (staff may opt in to claims)", async () => {
    const a = await createCompetition("A");
    const b = await createCompetition("B");
    const admin = await loginAs(w.admin.email);
    const r1 = (await admin.post(`/api/competitions/${a}/registrations`).send({ projectId: w.project.id })).body.registration;
    const r2 = (await admin.post(`/api/competitions/${b}/registrations`).send({ projectId: w.otherProject.id })).body.registration;
    await admin.patch(`/api/competition-registrations/${r1.id}`).send({ outcome: "FINALIST" });
    await admin.post(`/api/competition-registrations/${r1.id}/verify-outcome`).send({ note: "ok" });
    await admin.patch(`/api/competition-registrations/${r2.id}`).send({ outcome: "WINNER" }); // unverified

    const member = await loginAs(w.member.email);
    const board = await member.get("/api/competitions/leaderboard");
    expect(board.body.leaderboard).toEqual([expect.objectContaining({ rank: 1, projectName: "Alpha", points: 3, finalists: 1, unverified: 0 })]);
    // Students cannot opt in to unverified claims.
    expect((await member.get("/api/competitions/leaderboard?includeUnverified=true")).body.leaderboard).toHaveLength(1);
    const all = await admin.get("/api/competitions/leaderboard?includeUnverified=true");
    expect(all.body.leaderboard.map((r: { projectName: string; unverified: number }) => [r.projectName, r.unverified])).toEqual([["Beta", 1], ["Alpha", 0]]);
  });
});
