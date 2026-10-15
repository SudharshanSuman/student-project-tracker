import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db.js";
import { loginAs, resetDb, world } from "./helpers.js";

let w: Awaited<ReturnType<typeof world>>;
beforeEach(async () => {
  await resetDb();
  w = await world();
});

describe("dashboard metrics", () => {
  it("reflects real records and is scoped by role", async () => {
    await prisma.task.createMany({
      data: [
        { projectId: w.project.id, title: "a", status: "DONE", createdById: w.admin.id, completedAt: new Date() },
        { projectId: w.project.id, title: "b", status: "TODO", createdById: w.admin.id, dueDate: new Date(Date.now() - 86400_000) },
        { projectId: w.otherProject.id, title: "c", status: "DONE", createdById: w.admin.id, completedAt: new Date() },
        { projectId: w.otherProject.id, title: "d", status: "DONE", createdById: w.admin.id, completedAt: new Date() },
      ],
    });
    await prisma.fundingAward.create({ data: { projectId: w.project.id, source: "GRANT", title: "g", amount: new Prisma.Decimal("1234.56"), currency: "INR", verification: "VERIFIED", createdById: w.admin.id } });

    const admin = (await (await loginAs(w.admin.email)).get("/api/dashboard")).body;
    expect(admin.metrics.totalTasks).toBe(4);
    expect(admin.metrics.taskCompletionRate).toBe(75);
    expect(admin.metrics.overdueTasks).toBe(1);
    expect(admin.funding).toEqual([{ currency: "INR", verification: "VERIFIED", source: "GRANT", amount: "1234.56" }]);

    const member = (await (await loginAs(w.member.email)).get("/api/dashboard")).body;
    expect(member.metrics.totalTasks).toBe(2);
    expect(member.metrics.taskCompletionRate).toBe(50);
    expect(member.funding).toBeNull();
  });

  it("returns empty-state values with no data", async () => {
    await resetDb();
    const { createUser } = await import("./helpers.js");
    const admin = await createUser("ADMIN");
    const d = (await (await loginAs(admin.email)).get("/api/dashboard")).body;
    expect(d.metrics.activeProjects).toBe(0);
    expect(d.metrics.taskCompletionRate).toBeNull();
  });
});
