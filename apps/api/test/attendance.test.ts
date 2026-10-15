import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { issueQrToken, verifyQrToken } from "../src/lib/qr.js";
import { loginAs, resetDb, world } from "./helpers.js";

let w: Awaited<ReturnType<typeof world>>;
beforeEach(async () => {
  await resetDb();
  w = await world();
});

async function openSession(extra: Record<string, unknown> = {}) {
  const admin = await loginAs(w.admin.email);
  const now = Date.now();
  const res = await admin.post("/api/attendance/sessions").send({
    name: "Workshop", startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString(), ...extra,
  });
  expect(res.status).toBe(201);
  await admin.post(`/api/attendance/sessions/${res.body.session.id}/status`).send({ status: "OPEN" }).expect(200);
  return { admin, id: res.body.session.id as string };
}

describe("QR tokens", () => {
  it("verifies valid tokens and rejects expired or tampered ones", () => {
    const { token } = issueQrToken("s1", 60, 1_000_000);
    expect(verifyQrToken(token, 1_000_000 + 30_000).ok).toBe(true);
    expect(verifyQrToken(token, 1_000_000 + 61_000)).toEqual({ ok: false, reason: "EXPIRED" });
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), exp: 9e9 })).toString("base64url");
    expect(verifyQrToken(`${forged}.${sig}`, 1_000_000).ok).toBe(false);
    expect(verifyQrToken("garbage", 1_000_000).ok).toBe(false);
  });
});

describe("attendance check-in", () => {
  it("checks in with a valid QR and prevents duplicates", async () => {
    const { admin, id } = await openSession();
    const { token } = (await admin.get(`/api/attendance/sessions/${id}/qr`)).body;
    const member = await loginAs(w.member.email);
    expect((await member.post("/api/attendance/check-in").send({ token })).status).toBe(201);
    const dup = await member.post("/api/attendance/check-in").send({ token });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ALREADY_CHECKED_IN");
    expect(await prisma.attendanceRecord.count({ where: { sessionId: id } })).toBe(1);
  });

  it("rejects an expired QR token", async () => {
    const { id } = await openSession();
    const { token } = issueQrToken(id, 30, Date.now() - 120_000);
    const res = await (await loginAs(w.member.email)).post("/api/attendance/check-in").send({ token });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("QR_EXPIRED");
  });

  it("single-use tokens cannot be reused by a second person", async () => {
    const { admin, id } = await openSession({ qrPolicy: "SINGLE_USE" });
    const { token } = (await admin.get(`/api/attendance/sessions/${id}/qr`)).body;
    await (await loginAs(w.member.email)).post("/api/attendance/check-in").send({ token }).expect(201);
    const second = await (await loginAs(w.lead.email)).post("/api/attendance/check-in").send({ token });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("QR_ALREADY_USED");
  });

  it("enforces eligibility and session state", async () => {
    const { admin, id } = await openSession({ eligibility: "PROJECT", projectId: w.project.id });
    const { token } = (await admin.get(`/api/attendance/sessions/${id}/qr`)).body;
    expect((await (await loginAs(w.outsider.email)).post("/api/attendance/check-in").send({ token })).status).toBe(403);
    await admin.post(`/api/attendance/sessions/${id}/status`).send({ status: "CLOSED" }).expect(200);
    expect((await (await loginAs(w.member.email)).post("/api/attendance/check-in").send({ token })).status).toBe(409);
  });

  it("students cannot mint QR codes or view the roster", async () => {
    const { id } = await openSession();
    const member = await loginAs(w.member.email);
    expect((await member.get(`/api/attendance/sessions/${id}/qr`)).status).toBe(403);
    expect((await member.get(`/api/attendance/sessions/${id}`)).status).toBe(403);
  });

  it("records location only as a supporting signal and never blocks check-in", async () => {
    const { admin, id } = await openSession({ locationCheck: true, latitude: 10.93, longitude: 76.74, radiusMeters: 100 });
    const { token } = (await admin.get(`/api/attendance/sessions/${id}/qr`)).body;
    const res = await (await loginAs(w.member.email)).post("/api/attendance/check-in").send({ token, location: { latitude: 12.0, longitude: 77.0 } });
    expect(res.status).toBe(201);
    expect(res.body.record.locationVerified).toBe(false);
  });

  it("manual corrections are audited with a reason", async () => {
    const { admin, id } = await openSession();
    const add = await admin.post(`/api/attendance/sessions/${id}/manual`).send({ userId: w.member.id, reason: "Phone battery dead" });
    expect(add.status).toBe(201);
    await admin.patch(`/api/attendance/records/${add.body.record.id}`).send({ status: "REVOKED", reason: "Left early" }).expect(200);
    const logs = await prisma.auditLog.findMany({ where: { entityType: "AttendanceRecord" }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["attendance.manual_added", "attendance.corrected"]);
  });
});
