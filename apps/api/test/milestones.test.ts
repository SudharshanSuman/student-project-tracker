import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { loginAs, resetDb, world } from "./helpers.js";

let w: Awaited<ReturnType<typeof world>>;
let milestoneId: string;
beforeEach(async () => {
  await resetDb();
  w = await world();
  const lead = await loginAs(w.lead.email);
  const res = await lead.post(`/api/projects/${w.project.id}/milestones`).send({ title: "Ideation gate", stage: "IDEATION", isStageGate: true });
  expect(res.status).toBe(201);
  milestoneId = res.body.milestone.id;
});

describe("milestone submission & review", () => {
  it("members submit evidence; outsiders cannot", async () => {
    expect((await (await loginAs(w.outsider.email)).post(`/api/milestones/${milestoneId}/submit`).send({ notes: "x" })).status).toBe(404);
    const res = await (await loginAs(w.member.email)).post(`/api/milestones/${milestoneId}/submit`).send({ notes: "evidence", evidenceUrl: "https://example.org/e" });
    expect(res.status).toBe(201);
    expect(await prisma.notification.count({ where: { userId: w.mentor.id, type: "milestone.submitted" } })).toBe(1);
  });

  it("only the assigned mentor or an admin can review", async () => {
    await (await loginAs(w.member.email)).post(`/api/milestones/${milestoneId}/submit`).send({ notes: "evidence" }).expect(201);
    expect((await (await loginAs(w.lead.email)).post(`/api/milestones/${milestoneId}/review`).send({ decision: "APPROVED", comment: "self" })).status).toBe(403);
    expect((await (await loginAs(w.otherMentor.email)).post(`/api/milestones/${milestoneId}/review`).send({ decision: "APPROVED", comment: "x" })).status).toBe(404);
    const ok = await (await loginAs(w.mentor.email)).post(`/api/milestones/${milestoneId}/review`).send({ decision: "APPROVED", comment: "Meets checklist" });
    expect(ok.status).toBe(201);
    const review = await prisma.milestoneReview.findFirstOrThrow({});
    expect(review).toMatchObject({ reviewerId: w.mentor.id, decision: "APPROVED", comment: "Meets checklist" });
    expect((await prisma.milestone.findUniqueOrThrow({ where: { id: milestoneId } })).status).toBe("APPROVED");
  });

  it("rejection requests changes and allows resubmission; a reason is required", async () => {
    const member = await loginAs(w.member.email);
    const mentor = await loginAs(w.mentor.email);
    await member.post(`/api/milestones/${milestoneId}/submit`).send({ notes: "v1" }).expect(201);
    expect((await mentor.post(`/api/milestones/${milestoneId}/review`).send({ decision: "REJECTED", comment: "" })).status).toBe(400);
    await mentor.post(`/api/milestones/${milestoneId}/review`).send({ decision: "REJECTED", comment: "Need user interviews" }).expect(201);
    expect((await prisma.milestone.findUniqueOrThrow({ where: { id: milestoneId } })).status).toBe("CHANGES_REQUESTED");
    await member.post(`/api/milestones/${milestoneId}/submit`).send({ notes: "v2" }).expect(201);
  });

  it("cannot review without a pending submission or submit while under review", async () => {
    const mentor = await loginAs(w.mentor.email);
    expect((await mentor.post(`/api/milestones/${milestoneId}/review`).send({ decision: "APPROVED", comment: "x" })).status).toBe(409);
    const member = await loginAs(w.member.email);
    await member.post(`/api/milestones/${milestoneId}/submit`).send({ notes: "v1" }).expect(201);
    expect((await member.post(`/api/milestones/${milestoneId}/submit`).send({ notes: "v2" })).status).toBe(409);
  });

  it("review queue is scoped per mentor", async () => {
    await (await loginAs(w.member.email)).post(`/api/milestones/${milestoneId}/submit`).send({ notes: "v1" }).expect(201);
    expect((await (await loginAs(w.mentor.email)).get("/api/milestones?status=SUBMITTED")).body.milestones).toHaveLength(1);
    expect((await (await loginAs(w.otherMentor.email)).get("/api/milestones?status=SUBMITTED")).body.milestones).toHaveLength(0);
  });

  it("stage-gate requirements are admin-configurable only", async () => {
    expect((await (await loginAs(w.mentor.email)).post("/api/stage-gates").send({ stage: "MVP", title: "x" })).status).toBe(403);
    expect((await (await loginAs(w.admin.email)).post("/api/stage-gates").send({ stage: "MVP", title: "Pilot users" })).status).toBe(201);
  });
});
