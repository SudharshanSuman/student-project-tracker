/**
 * DEVELOPMENT DEMO DATA ONLY.
 * Every seeded record is labelled "[Demo]" (or uses the demo email domain) so it is never
 * mistaken for real institutional data. Refuses to run in production.
 * Discord / GitHub activity is intentionally NOT seeded: integration data must only
 * come from the real integrations.
 *
 *   npm run db:seed            # seeds an empty database
 *   npm run db:reset           # drops, re-migrates and re-seeds
 */
import { PrismaClient, type ProjectStage, type TaskStatus } from "@prisma/client";
import { DEFAULT_STAGE_GATES, PROJECT_STAGES } from "@iic/shared";
import { hashPassword } from "../src/lib/crypto.js";

const prisma = new PrismaClient();
const DEMO_DOMAIN = "iic.local";
export const DEMO_PASSWORD = "DemoPass2026";

const day = 86400_000;
const now = Date.now();
const d = (offsetDays: number) => new Date(now + offsetDays * day);

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
  if ((await prisma.user.count()) > 0) {
    console.log("Database already has users — skipping seed. Use `npm run db:reset` to start over.");
    return;
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const mk = (email: string, name: string, role: "ADMIN" | "MENTOR" | "PROJECT_LEAD" | "PROJECT_MEMBER", department: string) =>
    prisma.user.create({
      data: { email: `${email}@${DEMO_DOMAIN}`, name: `${name} [Demo]`, role, passwordHash, department, onboardedAt: new Date(), status: "ACTIVE" },
    });

  const admin = await mk("admin", "Asha Admin", "ADMIN", "IIC Office");
  const mentorA = await mk("mentor.rao", "Dr. Kiran Rao", "MENTOR", "Computer Science");
  const mentorB = await mk("mentor.thomas", "Prof. Mary Thomas", "MENTOR", "Management Studies");
  const leadA = await mk("lead.arjun", "Arjun Nair", "PROJECT_LEAD", "CSE");
  const leadB = await mk("lead.divya", "Divya Menon", "PROJECT_LEAD", "ECE");
  const leadC = await mk("lead.samuel", "Samuel Joseph", "PROJECT_LEAD", "Biotech");
  const members = await Promise.all([
    mk("member.priya", "Priya Raj", "PROJECT_MEMBER", "CSE"),
    mk("member.rahul", "Rahul Das", "PROJECT_MEMBER", "CSE"),
    mk("member.neha", "Neha Paul", "PROJECT_MEMBER", "ECE"),
    mk("member.vikram", "Vikram S", "PROJECT_MEMBER", "Mech"),
    mk("member.anu", "Anu George", "PROJECT_MEMBER", "Biotech"),
  ]);
  const [priya, rahul, neha, vikram, anu] = members as [typeof admin, typeof admin, typeof admin, typeof admin, typeof admin];

  const cohort = await prisma.cohort.create({
    data: { name: "[Demo] Cohort 2026", term: "2026-27 Odd", startDate: d(-60), endDate: d(120) },
  });

  // Stage-gate checklist (admin-editable).
  for (const stage of PROJECT_STAGES) {
    await prisma.stageGateRequirement.createMany({
      data: DEFAULT_STAGE_GATES[stage].map((title, i) => ({ stage, title, sortOrder: i, updatedById: admin.id })),
    });
  }

  const projectDefs: {
    name: string; category: string; stage: ProjectStage; mentor: typeof admin; lead: typeof admin; team: (typeof admin)[]; description: string;
  }[] = [
    { name: "[Demo] AgriSense", category: "AgriTech", stage: "MVP", mentor: mentorA, lead: leadA, team: [priya, rahul], description: "Low-cost soil moisture sensing with SMS alerts for smallholder farmers. (Demo data)" },
    { name: "[Demo] MediQueue", category: "HealthTech", stage: "POC", mentor: mentorB, lead: leadB, team: [neha, vikram], description: "Outpatient queue management for district hospitals. (Demo data)" },
    { name: "[Demo] BioPack", category: "CleanTech", stage: "IDEATION", mentor: mentorA, lead: leadC, team: [anu], description: "Compostable packaging from agricultural waste. (Demo data)" },
  ];

  const projects = [];
  for (const def of projectDefs) {
    const p = await prisma.project.create({
      data: {
        name: def.name,
        slug: def.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        description: def.description,
        category: def.category,
        stage: def.stage,
        cohortId: cohort.id,
        mentorId: def.mentor.id,
        createdById: admin.id,
        lastActivityAt: d(-1),
        memberships: {
          create: [{ userId: def.lead.id, role: "LEAD" }, ...def.team.map((u) => ({ userId: u.id, role: "MEMBER" as const }))],
        },
        stageHistory: { create: [{ toStage: def.stage, changedById: admin.id, reason: "Initial stage (demo seed)" }] },
      },
    });
    projects.push({ ...p, def });
    await prisma.auditLog.create({ data: { actorId: admin.id, action: "project.created", entityType: "Project", entityId: p.id, projectId: p.id, metadata: { seed: true } } });
  }
  const [agri, medi] = projects as [(typeof projects)[number], (typeof projects)[number]];

  // Milestones: a stage gate per project for its current stage.
  const agriGate = await prisma.milestone.create({
    data: { projectId: agri.id, title: "MVP stage gate", stage: "MVP", isStageGate: true, status: "SUBMITTED", dueDate: d(10), description: "Evidence for the MVP checklist." },
  });
  await prisma.milestoneSubmission.create({
    data: { milestoneId: agriGate.id, submittedById: leadA.id, notes: "Pilot with 12 farmers complete; feedback summary attached. (Demo data)", evidenceUrl: "https://example.org/demo/agrisense-pilot" },
  });
  const mediGate = await prisma.milestone.create({
    data: { projectId: medi.id, title: "PoC stage gate", stage: "POC", isStageGate: true, status: "OPEN", dueDate: d(21) },
  });

  // Tasks with dependencies and status history.
  type TaskSeed = { title: string; status: TaskStatus; assignee?: typeof admin; due: number; dependsOn?: number; milestoneId?: string };
  const taskPlan: Record<string, TaskSeed[]> = {
    [agri.id]: [
      { title: "Calibrate moisture sensors", status: "DONE", assignee: priya, due: -20 },
      { title: "SMS alert gateway integration", status: "DONE", assignee: rahul, due: -10, dependsOn: 0 },
      { title: "Pilot feedback survey", status: "REVIEW", assignee: priya, due: -2, milestoneId: agriGate.id },
      { title: "Battery life benchmark", status: "IN_PROGRESS", assignee: rahul, due: 5 },
      { title: "Prepare demo-day pitch", status: "TODO", assignee: leadA, due: 20, dependsOn: 2 },
    ],
    [medi.id]: [
      { title: "Interview OPD staff", status: "DONE", assignee: neha, due: -15 },
      { title: "Queue token prototype", status: "IN_PROGRESS", assignee: vikram, due: -3, dependsOn: 0, milestoneId: mediGate.id },
      { title: "Load test with 500 tokens", status: "TODO", assignee: vikram, due: 12, dependsOn: 1 },
    ],
    [projects[2]!.id]: [
      { title: "Literature review on bio-polymers", status: "IN_PROGRESS", assignee: anu, due: 7 },
      { title: "Supplier list for husk feedstock", status: "TODO", assignee: leadC, due: 14 },
    ],
  };
  for (const [projectId, plans] of Object.entries(taskPlan)) {
    const created: string[] = [];
    for (const [i, t] of plans.entries()) {
      const task = await prisma.task.create({
        data: {
          projectId,
          title: `${t.title}`,
          description: "Demo task.",
          status: t.status,
          priority: i % 3 === 0 ? "HIGH" : "MEDIUM",
          position: (i + 1) * 1000,
          assigneeId: t.assignee?.id ?? null,
          createdById: admin.id,
          milestoneId: t.milestoneId ?? null,
          dueDate: d(t.due),
          startDate: t.status !== "TODO" ? d(t.due - 7) : null,
          completedAt: t.status === "DONE" ? d(t.due - 1) : null,
          statusHistory: { create: [{ toStatus: t.status, changedById: admin.id }] },
          dependencies: t.dependsOn !== undefined ? { create: [{ dependsOnId: created[t.dependsOn]! }] } : undefined,
        },
      });
      created.push(task.id);
    }
  }

  // Events & attendance.
  const event = await prisma.event.create({
    data: { title: "[Demo] Design Thinking Workshop", type: "WORKSHOP", location: "IIC Lab, Block 3", startsAt: d(-7), endsAt: new Date(d(-7).getTime() + 3 * 3600_000), cohortId: cohort.id, createdById: admin.id },
  });
  const past = await prisma.attendanceSession.create({
    data: { eventId: event.id, name: "[Demo] Workshop check-in", startsAt: event.startsAt, endsAt: event.endsAt, location: event.location, status: "CLOSED", createdById: admin.id },
  });
  for (const u of [leadA, priya, rahul, neha]) {
    await prisma.attendanceRecord.create({ data: { sessionId: past.id, userId: u.id, method: "QR", checkedInAt: new Date(event.startsAt.getTime() + 5 * 60_000) } });
  }
  const upcoming = await prisma.event.create({
    data: { title: "[Demo] Mentor Office Hours", type: "MENTORING", location: "Seminar Hall B", startsAt: d(3), endsAt: new Date(d(3).getTime() + 2 * 3600_000), createdById: mentorA.id },
  });
  await prisma.attendanceSession.create({
    data: { eventId: upcoming.id, name: "[Demo] Office hours check-in", startsAt: upcoming.startsAt, endsAt: upcoming.endsAt, location: upcoming.location, createdById: mentorA.id },
  });

  // Competition, registration and funding (one verified, one estimated).
  const comp = await prisma.competition.create({
    data: { name: "[Demo] Smart India Hackathon (sample)", organizer: "Demo Organiser", description: "Sample competition record for demo purposes.", startDate: d(-40), endDate: d(-30), submissionDeadline: d(-45), createdById: admin.id },
  });
  const reg = await prisma.competitionRegistration.create({ data: { competitionId: comp.id, projectId: agri.id, status: "SUBMITTED", outcome: "FINALIST" } });
  await prisma.competition.create({
    data: { name: "[Demo] State Startup Challenge (sample)", organizer: "Demo Organiser", submissionDeadline: d(25), createdById: admin.id },
  });
  await prisma.fundingAward.create({
    data: { projectId: agri.id, registrationId: reg.id, source: "COMPETITION", title: "[Demo] Finalist grant", amount: "50000.00", currency: "INR", verification: "VERIFIED", verifiedById: admin.id, verifiedAt: d(-25), awardedAt: d(-28), createdById: admin.id },
  });
  await prisma.fundingAward.create({
    data: { projectId: medi.id, source: "GRANT", title: "[Demo] Seed grant application", amount: "1500.00", currency: "USD", verification: "ESTIMATED", createdById: leadB.id, notes: "Awaiting confirmation letter." },
  });

  await prisma.notification.create({
    data: { userId: mentorA.id, type: "milestone.submitted", title: "Review requested: MVP stage gate", body: "[Demo] AgriSense", link: `/milestones?open=${agriGate.id}`, dedupeKey: `seed-milestone-${agriGate.id}` },
  });
  await prisma.platformSetting.create({ data: { key: "engagement.weights", value: { voice: 0.5, messages: 0.2, tasks: 0.3 } } });

  console.log("Seeded demo data. Sign in with any demo account, password:", DEMO_PASSWORD);
  console.log(`  admin@${DEMO_DOMAIN}, mentor.rao@${DEMO_DOMAIN}, lead.arjun@${DEMO_DOMAIN}, member.priya@${DEMO_DOMAIN}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
