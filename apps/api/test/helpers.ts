import request from "supertest";
import type { Role } from "@prisma/client";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { hashPassword } from "../src/lib/crypto.js";

export const app = createApp();
export const PASSWORD = "TestPass2026";
let passwordHash: string | null = null;

/** Truncates every application table (fast, keeps the schema). */
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  if (list) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let seq = 0;
export async function createUser(role: Role, overrides: { email?: string; status?: "ACTIVE" | "DISABLED" | "INVITED" } = {}) {
  passwordHash ??= await hashPassword(PASSWORD);
  seq += 1;
  return prisma.user.create({
    data: {
      email: overrides.email ?? `${role.toLowerCase()}${seq}@uni.test`,
      name: `${role} ${seq}`,
      role,
      status: overrides.status ?? "ACTIVE",
      passwordHash,
    },
  });
}

/** A supertest agent holding a real session cookie. */
export async function loginAs(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export async function createProject(opts: { createdById: string; mentorId?: string | null; leadId?: string; memberIds?: string[]; name?: string; cohortId?: string }) {
  seq += 1;
  return prisma.project.create({
    data: {
      name: opts.name ?? `Project ${seq}`,
      slug: `project-${seq}-${Date.now()}`,
      description: "Test project",
      category: "Test",
      createdById: opts.createdById,
      mentorId: opts.mentorId ?? null,
      cohortId: opts.cohortId ?? null,
      memberships: {
        create: [
          ...(opts.leadId ? [{ userId: opts.leadId, role: "LEAD" as const }] : []),
          ...(opts.memberIds ?? []).map((userId) => ({ userId, role: "MEMBER" as const })),
        ],
      },
    },
  });
}

/** A typical world: admin, two mentors, two projects with separate teams. */
export async function world() {
  const admin = await createUser("ADMIN");
  const mentor = await createUser("MENTOR");
  const otherMentor = await createUser("MENTOR");
  const lead = await createUser("PROJECT_LEAD");
  const member = await createUser("PROJECT_MEMBER");
  const outsider = await createUser("PROJECT_MEMBER");
  const otherLead = await createUser("PROJECT_LEAD");
  const project = await createProject({ createdById: admin.id, mentorId: mentor.id, leadId: lead.id, memberIds: [member.id], name: "Alpha" });
  const otherProject = await createProject({ createdById: admin.id, mentorId: otherMentor.id, leadId: otherLead.id, memberIds: [outsider.id], name: "Beta" });
  return { admin, mentor, otherMentor, lead, member, outsider, otherLead, project, otherProject };
}
