import { randomBytes } from "node:crypto";
import { projectHealth, type ProjectHealth } from "@iic/shared";
import { prisma, type Tx } from "../db.js";

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `${base || "project"}-${randomBytes(3).toString("hex")}`;
}

export async function touchProject(projectId: string, tx: Tx = prisma) {
  await tx.project.update({ where: { id: projectId }, data: { lastActivityAt: new Date() } });
}

/** Health per project from real task data (open/overdue counts + activity recency). */
export async function healthFor(projects: { id: string; lastActivityAt: Date }[]): Promise<Map<string, {
  health: ProjectHealth;
  openTasks: number;
  overdueTasks: number;
  doneTasks: number;
  totalTasks: number;
}>> {
  const ids = projects.map((p) => p.id);
  const result = new Map<string, { health: ProjectHealth; openTasks: number; overdueTasks: number; doneTasks: number; totalTasks: number }>();
  if (ids.length === 0) return result;
  const now = new Date();
  const [byStatus, overdue] = await Promise.all([
    prisma.task.groupBy({ by: ["projectId", "status"], where: { projectId: { in: ids } }, _count: { _all: true } }),
    prisma.task.groupBy({
      by: ["projectId"],
      where: { projectId: { in: ids }, status: { not: "DONE" }, dueDate: { lt: now } },
      _count: { _all: true },
    }),
  ]);
  for (const p of projects) {
    const rows = byStatus.filter((r) => r.projectId === p.id);
    const total = rows.reduce((s, r) => s + r._count._all, 0);
    const done = rows.find((r) => r.status === "DONE")?._count._all ?? 0;
    const open = total - done;
    const over = overdue.find((r) => r.projectId === p.id)?._count._all ?? 0;
    const days = (now.getTime() - p.lastActivityAt.getTime()) / 86400_000;
    result.set(p.id, {
      health: projectHealth({ openTasks: open, overdueTasks: over, daysSinceActivity: days }),
      openTasks: open,
      overdueTasks: over,
      doneTasks: done,
      totalTasks: total,
    });
  }
  return result;
}
