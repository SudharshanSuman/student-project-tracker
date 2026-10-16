import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { createUser, loginAs, resetDb, world } from "./helpers.js";

type World = Awaited<ReturnType<typeof world>>;
let w: World;

beforeEach(async () => {
  await resetDb();
  w = await world();
});

async function record(email: string, body: Record<string, unknown> = {}) {
  const agent = await loginAs(email);
  return agent.post("/api/funding").send({ projectId: w.project.id, source: "GRANT", title: "Seed grant", amount: "150000.50", currency: "INR", ...body });
}

describe("funding precision and currencies", () => {
  it("stores exact decimals and sums per currency without float error or cross-currency mixing", async () => {
    for (const amount of ["0.10", "0.20", "1000000000.01"]) expect((await record(w.lead.email, { amount, currency: "INR" })).status).toBe(201);
    expect((await record(w.lead.email, { amount: "99.99", currency: "usd" })).status).toBe(201);
    const admin = await loginAs(w.admin.email);
    const ledger = await admin.get("/api/funding");
    const inr = ledger.body.totals.find((t: { currency: string }) => t.currency === "INR");
    expect(inr).toMatchObject({ verification: "ESTIMATED", amount: "1000000000.31", count: 3 }); // 0.1 + 0.2 is exact
    expect(ledger.body.totals.find((t: { currency: string }) => t.currency === "USD")).toMatchObject({ amount: "99.99" });
    expect(ledger.body.awards.map((a: { amount: string }) => a.amount)).toContain("0.10");
  });

  it("rejects floats, bad precision, zero, overflow and unknown currencies", async () => {
    for (const bad of [{ amount: 10.5 }, { amount: "1.001" }, { amount: "0" }, { amount: "-5" }, { amount: "10000000000000" }, { currency: "ABC" }, { currency: "RUPEES" }]) {
      expect((await record(w.lead.email, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("new awards are always ESTIMATED even if the client claims otherwise", async () => {
    const res = await record(w.lead.email, { verification: "VERIFIED" });
    expect(res.body.award.verification).toBe("ESTIMATED");
  });
});

describe("funding authorization and review", () => {
  it("members and outsiders cannot see or record funding", async () => {
    expect((await record(w.member.email)).status).toBe(403);
    expect((await (await loginAs(w.member.email)).get("/api/funding")).status).toBe(403);
    // Another project's lead gets 404 for a project they cannot see.
    expect((await record(w.otherLead.email)).status).toBe(404);
  });

  it("only the assigned mentor/admin verifies, never their own entry, with a mandatory note", async () => {
    const own = (await record(w.mentor.email)).body.award;
    const mentor = await loginAs(w.mentor.email);
    expect((await mentor.post(`/api/funding/${own.id}/verify`).send({ decision: "VERIFIED", note: "ok" })).status).toBe(403);

    const award = (await record(w.lead.email)).body.award;
    const lead = await loginAs(w.lead.email);
    expect((await lead.post(`/api/funding/${award.id}/verify`).send({ decision: "VERIFIED", note: "ok" })).status).toBe(403);
    const otherMentor = await loginAs(w.otherMentor.email);
    expect((await otherMentor.post(`/api/funding/${award.id}/verify`).send({ decision: "VERIFIED", note: "ok" })).status).toBe(404);
    expect((await mentor.post(`/api/funding/${award.id}/verify`).send({ decision: "VERIFIED" })).status).toBe(400);
    const ok = await mentor.post(`/api/funding/${award.id}/verify`).send({ decision: "VERIFIED", note: "Sanction letter checked" });
    expect(ok.status).toBe(200);
    expect(ok.body.award).toMatchObject({ verification: "VERIFIED", amount: "150000.50" });
  });

  it("material changes to verified awards require an admin review by someone other than the requester", async () => {
    const award = (await record(w.lead.email)).body.award;
    const mentor = await loginAs(w.mentor.email);
    await mentor.post(`/api/funding/${award.id}/verify`).send({ decision: "VERIFIED", note: "ok" });

    const lead = await loginAs(w.lead.email);
    const direct = await lead.patch(`/api/funding/${award.id}`).send({ amount: "999999.00" });
    expect(direct.status).toBe(409);
    expect(direct.body.error.code).toBe("MATERIAL_CHANGE_REQUIRES_REVIEW");
    expect((await lead.patch(`/api/funding/${award.id}`).send({ notes: "Paid in two tranches" })).status).toBe(200);
    expect((await lead.delete(`/api/funding/${award.id}`)).status).toBe(409);

    const cr = await lead.post(`/api/funding/${award.id}/change-requests`).send({ amount: "175000", reason: "Second tranche approved" });
    expect(cr.status).toBe(201);
    expect((await lead.post(`/api/funding/${award.id}/change-requests`).send({ amount: "1", reason: "dup" })).status).toBe(409);
    expect((await mentor.post(`/api/funding/change-requests/${cr.body.request.id}/review`).send({ decision: "APPROVED", note: "ok" })).status).toBe(403);

    // An admin cannot approve their own request.
    const admin = await loginAs(w.admin.email);
    const award2 = (await record(w.lead.email, { title: "Other" })).body.award;
    await admin.post(`/api/funding/${award2.id}/verify`).send({ decision: "VERIFIED", note: "ok" });
    const own = await admin.post(`/api/funding/${award2.id}/change-requests`).send({ currency: "USD", reason: "Wrong currency" });
    expect((await admin.post(`/api/funding/change-requests/${own.body.request.id}/review`).send({ decision: "APPROVED", note: "ok" })).status).toBe(403);

    const approved = await admin.post(`/api/funding/change-requests/${cr.body.request.id}/review`).send({ decision: "APPROVED", note: "Letter attached" });
    expect(approved.status).toBe(200);
    const after = await prisma.fundingAward.findUniqueOrThrow({ where: { id: award.id } });
    expect(after.amount.toFixed(2)).toBe("175000.00");
    expect(after.verification).toBe("VERIFIED");
    expect(after.verifiedById).toBe(w.admin.id);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: award.id, action: "funding.change_approved" } });
    expect(log.metadata).toMatchObject({ before: { amount: "150000.50" }, after: { amount: "175000.00" } });

    // A second admin can approve the first admin's request.
    const admin2 = await createUser("ADMIN");
    const a2 = await loginAs(admin2.email);
    expect((await a2.post(`/api/funding/change-requests/${own.body.request.id}/review`).send({ decision: "REJECTED", note: "Keep INR" })).status).toBe(200);
    expect((await prisma.fundingAward.findUniqueOrThrow({ where: { id: award2.id } })).currency).toBe("INR");
  });

  it("a registration from another project cannot be linked", async () => {
    const admin = await loginAs(w.admin.email);
    const comp = (await admin.post("/api/competitions").send({ name: "C", organizer: "O" })).body.competition;
    const reg = (await admin.post(`/api/competitions/${comp.id}/registrations`).send({ projectId: w.otherProject.id })).body.registration;
    expect((await record(w.admin.email, { registrationId: reg.id, source: "COMPETITION" })).status).toBe(400);
  });
});
