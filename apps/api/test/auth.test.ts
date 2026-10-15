import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { sentMail } from "../src/lib/mailer.js";
import { app, createUser, loginAs, PASSWORD, resetDb } from "./helpers.js";

beforeEach(async () => {
  await resetDb();
  sentMail.length = 0;
});

describe("authentication", () => {
  it("logs in with valid credentials and exposes /me", async () => {
    const u = await createUser("PROJECT_MEMBER");
    const agent = await loginAs(u.email);
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(u.email);
    expect(me.body.user.passwordHash).toBeUndefined();
  });

  it("rejects wrong passwords and unknown emails with the same message", async () => {
    const u = await createUser("PROJECT_MEMBER");
    const a = await request(app).post("/api/auth/login").send({ email: u.email, password: "Wrong12345A" });
    const b = await request(app).post("/api/auth/login").send({ email: "nobody@uni.test", password: "Wrong12345A" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it("locks the account after 5 failed attempts", async () => {
    const u = await createUser("PROJECT_MEMBER");
    for (let i = 0; i < 5; i++) await request(app).post("/api/auth/login").send({ email: u.email, password: "Wrong12345A" });
    const res = await request(app).post("/api/auth/login").send({ email: u.email, password: PASSWORD });
    expect(res.status).toBe(423);
  });

  it("requires a session for protected routes and revokes it on logout", async () => {
    expect((await request(app).get("/api/projects")).status).toBe(401);
    const u = await createUser("PROJECT_MEMBER");
    const agent = await loginAs(u.email);
    expect((await agent.post("/api/auth/logout")).status).toBe(204);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("blocks disabled accounts", async () => {
    const u = await createUser("PROJECT_MEMBER", { status: "DISABLED" });
    const res = await request(app).post("/api/auth/login").send({ email: u.email, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it("rejects cross-origin state-changing requests (CSRF guard)", async () => {
    const res = await request(app).post("/api/auth/login").set("Origin", "https://evil.example").send({ email: "a@uni.test", password: "x" });
    expect(res.status).toBe(403);
  });

  it("validates input on the server", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "not-an-email", password: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("resets a password with a one-time emailed token and revokes sessions", async () => {
    const u = await createUser("PROJECT_MEMBER");
    const agent = await loginAs(u.email);
    await request(app).post("/api/auth/password/forgot").send({ email: u.email }).expect(200);
    const token = /token=([\w-]+)/.exec(sentMail[0]!.text)![1]!;
    await request(app).post("/api/auth/password/reset").send({ token, password: "BrandNew2026x" }).expect(200);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
    await loginAs(u.email, "BrandNew2026x");
    const reuse = await request(app).post("/api/auth/password/reset").send({ token, password: "Another2026x" });
    expect(reuse.status).toBe(400);
  });

  it("does not reveal whether an email exists on forgot-password", async () => {
    const res = await request(app).post("/api/auth/password/forgot").send({ email: "ghost@uni.test" });
    expect(res.status).toBe(200);
    expect(sentMail).toHaveLength(0);
  });
});

describe("invitations & onboarding", () => {
  it("only admins can invite, and only institutional emails", async () => {
    const admin = await createUser("ADMIN");
    const lead = await createUser("PROJECT_LEAD");
    const leadAgent = await loginAs(lead.email);
    expect((await leadAgent.post("/api/users/invitations").send({ email: "x@uni.test", role: "ADMIN" })).status).toBe(403);
    const adminAgent = await loginAs(admin.email);
    expect((await adminAgent.post("/api/users/invitations").send({ email: "x@gmail.com", role: "PROJECT_MEMBER" })).status).toBe(400);
    expect((await adminAgent.post("/api/users/invitations").send({ email: "new@uni.test", role: "PROJECT_MEMBER" })).status).toBe(201);
  });

  it("assigns the invited role and ignores a role smuggled in the body (no self-granted admin)", async () => {
    const admin = await createUser("ADMIN");
    const adminAgent = await loginAs(admin.email);
    await adminAgent.post("/api/users/invitations").send({ email: "student@uni.test", role: "PROJECT_MEMBER" }).expect(201);
    const token = /token=([\w-]+)/.exec(sentMail.at(-1)!.text)![1]!;
    const res = await request(app).post("/api/auth/invitations/accept").send({ token, name: "Stu", password: "Student2026x", role: "ADMIN" });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("PROJECT_MEMBER");
    const again = await request(app).post("/api/auth/invitations/accept").send({ token, name: "Stu", password: "Student2026x" });
    expect(again.status).toBe(400);
  });

  it("users cannot change their own role; admins cannot either", async () => {
    const admin = await createUser("ADMIN");
    const member = await createUser("PROJECT_MEMBER");
    const memberAgent = await loginAs(member.email);
    expect((await memberAgent.patch(`/api/users/${member.id}`).send({ role: "ADMIN" })).status).toBe(403);
    await memberAgent.patch("/api/users/profile").send({ name: "Me", role: "ADMIN" }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).role).toBe("PROJECT_MEMBER");
    const adminAgent = await loginAs(admin.email);
    expect((await adminAgent.patch(`/api/users/${admin.id}`).send({ role: "MENTOR" })).status).toBe(403);
  });

  it("disabling a user revokes their sessions", async () => {
    const admin = await createUser("ADMIN");
    const member = await createUser("PROJECT_MEMBER");
    const memberAgent = await loginAs(member.email);
    const adminAgent = await loginAs(admin.email);
    await adminAgent.patch(`/api/users/${member.id}`).send({ status: "DISABLED" }).expect(200);
    expect((await memberAgent.get("/api/auth/me")).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: "user.updated", entityId: member.id } })).toBe(1);
  });
});
