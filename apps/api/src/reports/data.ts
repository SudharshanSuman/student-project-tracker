import { Prisma, type GeneratedReport, type ReportType } from "@prisma/client";
import { formatAmount, REPORT_TYPE_LABELS, STAGE_LABELS } from "@iic/shared";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { visibleProjectsWhere } from "../lib/access.js";
import type { AuthUser } from "../middleware/auth.js";
import type { ReportDocument, Section } from "./template.js";

/**
 * Builds a report from live database rows only. Nothing is estimated or invented:
 * every number is a count/sum over real records in scope, a missing value prints "—",
 * and a table with no rows prints an explicit empty state.
 */

/** A failure that retrying cannot fix (bad scope, lost access). */
export class PermanentReportError extends Error {}

const DAY = 86400_000;
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");
const pct = (n: number, d: number) => (d > 0 ? `${(Math.round((n * 1000) / d) / 10).toFixed(1)}%` : "—");
const int = (n: number) => n.toLocaleString("en-US");
const human = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");
const stage = (s: keyof typeof STAGE_LABELS) => STAGE_LABELS[s];

interface Period {
  start: Date;
  end: Date;
  label: string;
}

interface Scope {
  label: string;
  projectIds: string[];
  /** null = institution-wide (admin, no filter): attendance uses every eligible user. */
  memberIds: string[] | null;
  cohortIds: string[];
  projects: ProjectRow[];
}

const projectSelect = {
  id: true, name: true, stage: true, status: true, category: true, createdAt: true, lastActivityAt: true, archivedAt: true,
  cohort: { select: { id: true, name: true } },
  mentor: { select: { name: true } },
  memberships: { select: { userId: true, role: true, user: { select: { name: true, email: true } } } },
} satisfies Prisma.ProjectSelect;
type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;

interface ReportParams {
  cohortId?: string | null;
  projectId?: string | null;
}

// ─────────────────────────── Scope & period ───────────────────────────

function resolvePeriod(report: GeneratedReport, fallbackStart: Date | null): Period {
  const end = report.periodEnd ? new Date(report.periodEnd.getTime() + DAY - 1) : new Date();
  const start = report.periodStart ?? fallbackStart ?? new Date(0);
  const label = report.periodStart ? `${ymd(start)} to ${ymd(report.periodEnd ?? end)}` : `All records to ${ymd(end)}`;
  return { start, end, label };
}

async function resolveScope(report: GeneratedReport, requester: AuthUser, period: Period | null): Promise<Scope> {
  const params = (report.parameters ?? {}) as ReportParams;
  const filters: Prisma.ProjectWhereInput[] = [visibleProjectsWhere(requester)];
  let label = requester.role === "ADMIN" ? "All projects" : "Your mentored projects";
  if (report.type === "PROJECT" || params.projectId) {
    filters.push({ id: report.projectId ?? params.projectId ?? "" });
  }
  if (params.cohortId) {
    const cohort = await prisma.cohort.findUnique({ where: { id: params.cohortId }, select: { name: true, term: true } });
    if (!cohort) throw new PermanentReportError("Cohort no longer exists");
    filters.push({ cohortId: params.cohortId });
    label = `Cohort ${cohort.name} (${cohort.term})`;
  }
  if (period && report.type !== "PROJECT" && report.type !== "COHORT") {
    // Only projects that existed during the period and were not archived before it began.
    filters.push({ createdAt: { lte: period.end } }, { OR: [{ archivedAt: null }, { archivedAt: { gte: period.start } }] });
  }
  const projects = await prisma.project.findMany({ where: { AND: filters }, select: projectSelect, orderBy: { name: "asc" } });
  if ((report.type === "PROJECT" || params.projectId) && projects.length === 0) {
    throw new PermanentReportError("The project does not exist or is no longer visible to the requester");
  }
  if (report.type === "PROJECT" && projects[0]) label = `Project ${projects[0].name}`;
  const institutionWide = requester.role === "ADMIN" && !params.cohortId && !params.projectId && report.type !== "PROJECT" && report.type !== "COHORT";
  return {
    label,
    projects,
    projectIds: projects.map((p) => p.id),
    memberIds: institutionWide ? null : [...new Set(projects.flatMap((p) => p.memberships.map((m) => m.userId)))],
    cohortIds: [...new Set(projects.map((p) => p.cohort?.id).filter((v): v is string => !!v))],
  };
}

// ───────────────────────────── Sections ─────────────────────────────

function directory(scope: Scope): Section {
  return {
    kind: "table",
    title: "Project directory",
    columns: ["Project", "Cohort", "Stage", "Status", "Mentor", "Team", "Last activity"],
    rows: scope.projects.map((p) => [p.name, p.cohort?.name ?? "—", stage(p.stage), human(p.status), p.mentor?.name ?? "Unassigned", String(p.memberships.length), ymd(p.lastActivityAt)]),
    numeric: [5],
    empty: "No projects in scope for this period.",
  };
}

function stageDistribution(scope: Scope): Section {
  const counts = new Map<string, number>();
  for (const p of scope.projects) counts.set(p.stage, (counts.get(p.stage) ?? 0) + 1);
  return {
    kind: "table",
    title: "Stage distribution",
    columns: ["Stage", "Projects", "Share"],
    rows: (Object.keys(STAGE_LABELS) as (keyof typeof STAGE_LABELS)[])
      .filter((s) => counts.has(s))
      .map((s) => [stage(s), String(counts.get(s)), pct(counts.get(s) ?? 0, scope.projects.length)]),
    numeric: [1, 2],
    empty: "No projects in scope.",
  };
}

async function stageChanges(scope: Scope, period: Period): Promise<Section> {
  const rows = await prisma.projectStageHistory.findMany({
    where: { projectId: { in: scope.projectIds }, createdAt: { gte: period.start, lte: period.end } },
    include: { project: { select: { name: true } }, changedBy: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
    take: 300,
  });
  return {
    kind: "table",
    title: "Stage changes in period",
    columns: ["Date", "Project", "From", "To", "By", "Reason"],
    rows: rows.map((r) => [ymd(r.createdAt), r.project.name, r.fromStage ? stage(r.fromStage) : "—", stage(r.toStage), r.changedBy.name, r.reason ?? ""]),
    empty: "No stage changes were recorded in this period.",
  };
}

async function taskStats(scope: Scope, period: Period) {
  const [byStatus, completedInPeriod, overdue] = await Promise.all([
    prisma.task.groupBy({ by: ["projectId", "status"], where: { projectId: { in: scope.projectIds } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["projectId"], where: { projectId: { in: scope.projectIds }, status: "DONE", completedAt: { gte: period.start, lte: period.end } }, _count: { _all: true } }),
    prisma.task.findMany({
      where: { projectId: { in: scope.projectIds }, status: { not: "DONE" }, dueDate: { lt: new Date() } },
      select: { title: true, dueDate: true, status: true, priority: true, project: { select: { name: true } }, assignee: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
      take: 50,
    }),
  ]);
  const per = new Map<string, { total: number; done: number; inPeriod: number }>();
  for (const r of byStatus) {
    const row = per.get(r.projectId) ?? { total: 0, done: 0, inPeriod: 0 };
    row.total += r._count._all;
    if (r.status === "DONE") row.done += r._count._all;
    per.set(r.projectId, row);
  }
  for (const r of completedInPeriod) {
    const row = per.get(r.projectId) ?? { total: 0, done: 0, inPeriod: 0 };
    row.inPeriod = r._count._all;
    per.set(r.projectId, row);
  }
  const total = [...per.values()].reduce((a, r) => a + r.total, 0);
  const done = [...per.values()].reduce((a, r) => a + r.done, 0);
  const inPeriod = [...per.values()].reduce((a, r) => a + r.inPeriod, 0);
  const overdueCount = await prisma.task.count({ where: { projectId: { in: scope.projectIds }, status: { not: "DONE" }, dueDate: { lt: new Date() } } });
  const table: Section = {
    kind: "table",
    title: "Task completion",
    columns: ["Project", "Tasks", "Done", "Completion", "Completed in period"],
    rows: scope.projects.map((p) => {
      const r = per.get(p.id) ?? { total: 0, done: 0, inPeriod: 0 };
      return [p.name, int(r.total), int(r.done), pct(r.done, r.total), int(r.inPeriod)];
    }),
    numeric: [1, 2, 3, 4],
    empty: "No projects in scope.",
    note: "Completion is the current board state; 'completed in period' counts tasks whose completion date falls in the period.",
  };
  const overdueTable: Section = {
    kind: "table",
    title: "Overdue tasks",
    columns: ["Project", "Task", "Due", "Status", "Priority", "Assignee"],
    rows: overdue.map((t) => [t.project.name, t.title, ymd(t.dueDate), human(t.status), human(t.priority), t.assignee?.name ?? "Unassigned"]),
    empty: "No overdue tasks.",
    note: overdueCount > overdue.length ? `Showing the ${overdue.length} oldest of ${overdueCount} overdue tasks.` : undefined,
  };
  return { total, done, inPeriod, overdueCount, table, overdueTable };
}

async function milestoneStats(scope: Scope, period: Period) {
  const [milestones, reviews] = await Promise.all([
    prisma.milestone.findMany({
      where: { projectId: { in: scope.projectIds } },
      select: { title: true, stage: true, status: true, isStageGate: true, dueDate: true, approvedAt: true, project: { select: { name: true } } },
      orderBy: [{ project: { name: "asc" } }, { dueDate: { sort: "asc", nulls: "last" } }],
    }),
    prisma.milestoneReview.findMany({
      where: { reviewedAt: { gte: period.start, lte: period.end }, submission: { milestone: { projectId: { in: scope.projectIds } } } },
      select: { decision: true, reviewedAt: true, reviewer: { select: { name: true } }, submission: { select: { milestone: { select: { title: true, project: { select: { name: true } } } } } } },
      orderBy: { reviewedAt: "asc" },
      take: 300,
    }),
  ]);
  const now = new Date();
  const count = (s: string) => milestones.filter((m) => m.status === s).length;
  const overdue = milestones.filter((m) => m.status !== "APPROVED" && m.dueDate && m.dueDate < now);
  const approvedInPeriod = milestones.filter((m) => m.approvedAt && m.approvedAt >= period.start && m.approvedAt <= period.end).length;
  const statusTable: Section = {
    kind: "table",
    title: "Milestone status",
    columns: ["Project", "Milestone", "Stage", "Gate", "Status", "Due", "Approved"],
    rows: milestones.map((m) => [m.project.name, m.title, stage(m.stage), m.isStageGate ? "Yes" : "", human(m.status), ymd(m.dueDate), ymd(m.approvedAt)]),
    empty: "No milestones have been defined for the projects in scope.",
  };
  const byStage: Section = {
    kind: "table",
    title: "Milestones by stage",
    columns: ["Stage", "Open", "Submitted", "Changes requested", "Approved", "Total"],
    rows: (Object.keys(STAGE_LABELS) as (keyof typeof STAGE_LABELS)[])
      .map((s) => {
        const ms = milestones.filter((m) => m.stage === s);
        const c = (st: string) => String(ms.filter((m) => m.status === st).length);
        return ms.length ? [stage(s), c("OPEN"), c("SUBMITTED"), c("CHANGES_REQUESTED"), c("APPROVED"), String(ms.length)] : null;
      })
      .filter((r): r is string[] => r !== null),
    numeric: [1, 2, 3, 4, 5],
    empty: "No milestones in scope.",
  };
  const reviewTable: Section = {
    kind: "table",
    title: "Milestone reviews in period",
    columns: ["Date", "Project", "Milestone", "Decision", "Reviewer"],
    rows: reviews.map((r) => [ymd(r.reviewedAt), r.submission.milestone.project.name, r.submission.milestone.title, human(r.decision), r.reviewer.name]),
    empty: "No milestone reviews were recorded in this period.",
  };
  const overdueTable: Section = {
    kind: "table",
    title: "Overdue milestones",
    columns: ["Project", "Milestone", "Due", "Status"],
    rows: overdue.map((m) => [m.project.name, m.title, ymd(m.dueDate), human(m.status)]),
    empty: "No overdue milestones.",
  };
  return { total: milestones.length, approved: count("APPROVED"), pendingReview: count("SUBMITTED"), approvedInPeriod, overdue: overdue.length, statusTable, byStage, reviewTable, overdueTable };
}

async function attendanceStats(scope: Scope, period: Period) {
  const relevance: Prisma.AttendanceSessionWhereInput =
    scope.memberIds === null
      ? {}
      : { OR: [{ eligibility: "ALL_ACTIVE_USERS" }, { eligibility: "COHORT", cohortId: { in: scope.cohortIds } }, { eligibility: "PROJECT", projectId: { in: scope.projectIds } }] };
  const sessions = await prisma.attendanceSession.findMany({
    where: { startsAt: { gte: period.start, lte: period.end }, status: { not: "CANCELLED" }, ...relevance },
    select: {
      id: true, name: true, startsAt: true, eligibility: true, cohortId: true, projectId: true,
      records: { where: { status: { in: ["PRESENT", "CORRECTED"] } }, select: { userId: true } },
    },
    orderBy: { startsAt: "asc" },
  });
  // Eligibility mirrors routes/attendance.ts (current memberships; history is not versioned).
  const students = await prisma.user.findMany({
    where: { status: "ACTIVE", role: { in: ["PROJECT_LEAD", "PROJECT_MEMBER"] } },
    select: { id: true, name: true, memberships: { select: { projectId: true, project: { select: { cohortId: true } } } } },
  });
  const inScope = scope.memberIds === null ? null : new Set(scope.memberIds);
  const perUser = new Map<string, { name: string; eligible: number; attended: number }>();
  let eligibleTotal = 0;
  let presentTotal = 0;
  const rows: string[][] = [];
  for (const s of sessions) {
    const present = new Set(s.records.map((r) => r.userId));
    const eligible = students.filter((u) => {
      if (inScope && !inScope.has(u.id)) return false;
      if (s.eligibility === "PROJECT") return u.memberships.some((m) => m.projectId === s.projectId);
      if (s.eligibility === "COHORT") return u.memberships.some((m) => m.project.cohortId === s.cohortId);
      return true;
    });
    const attended = eligible.filter((u) => present.has(u.id)).length;
    eligibleTotal += eligible.length;
    presentTotal += attended;
    for (const u of eligible) {
      const row = perUser.get(u.id) ?? { name: u.name, eligible: 0, attended: 0 };
      row.eligible += 1;
      if (present.has(u.id)) row.attended += 1;
      perUser.set(u.id, row);
    }
    rows.push([ymd(s.startsAt), s.name, human(s.eligibility), int(eligible.length), int(attended), pct(attended, eligible.length)]);
  }
  const threshold = config.ATTENDANCE_COMPLIANCE_THRESHOLD;
  const people = [...perUser.values()].sort((a, b) => a.attended / a.eligible - b.attended / b.eligible || a.name.localeCompare(b.name));
  const below = people.filter((p) => (p.attended * 100) / p.eligible < threshold);
  return {
    sessions: sessions.length,
    eligibleTotal,
    presentTotal,
    rate: pct(presentTotal, eligibleTotal),
    belowCount: below.length,
    sessionTable: {
      kind: "table",
      title: "Sessions in period",
      columns: ["Date", "Session", "Eligibility", "Eligible", "Verified present", "Rate"],
      rows,
      numeric: [3, 4, 5],
      empty: "No attendance sessions were held in this period.",
      note: "Verified present = QR or staff-recorded check-ins that were not revoked. Eligibility uses current project/cohort membership.",
    } satisfies Section,
    peopleTable: {
      kind: "table",
      title: "Attendance by participant",
      columns: ["Participant", "Eligible sessions", "Attended", "Rate"],
      rows: people.map((p) => [p.name, int(p.eligible), int(p.attended), pct(p.attended, p.eligible)]),
      numeric: [1, 2, 3],
      empty: "No eligible participants in this period.",
    } satisfies Section,
    belowTable: {
      kind: "table",
      title: `Below ${threshold}% attendance`,
      columns: ["Participant", "Eligible sessions", "Attended", "Rate"],
      rows: below.map((p) => [p.name, int(p.eligible), int(p.attended), pct(p.attended, p.eligible)]),
      numeric: [1, 2, 3],
      empty: sessions.length ? `Everyone eligible attended at least ${threshold}% of sessions.` : "No attendance sessions were held in this period.",
    } satisfies Section,
  };
}

async function competitionStats(scope: Scope, period: Period) {
  const inPeriod: Prisma.DateTimeNullableFilter = { gte: period.start, lte: period.end };
  const regs = await prisma.competitionRegistration.findMany({
    where: {
      projectId: { in: scope.projectIds },
      OR: [
        { competition: { endDate: inPeriod } },
        { competition: { endDate: null, submissionDeadline: inPeriod } },
        { competition: { endDate: null, submissionDeadline: null, startDate: inPeriod } },
        { competition: { endDate: null, submissionDeadline: null, startDate: null }, createdAt: { gte: period.start, lte: period.end } },
      ],
    },
    select: {
      status: true, outcome: true, outcomeVerifiedAt: true,
      project: { select: { name: true } },
      competition: { select: { name: true, organizer: true, endDate: true, submissionDeadline: true } },
      outcomeVerifiedBy: { select: { name: true } },
    },
    orderBy: [{ competition: { endDate: { sort: "asc", nulls: "last" } } }, { project: { name: "asc" } }],
  });
  const verified = regs.filter((r) => r.outcomeVerifiedAt);
  const unverifiedClaims = regs.filter((r) => r.outcome !== "PENDING" && !r.outcomeVerifiedAt);
  return {
    registrations: regs.length,
    winners: verified.filter((r) => r.outcome === "WINNER").length,
    finalists: verified.filter((r) => r.outcome === "FINALIST").length,
    unverified: unverifiedClaims.length,
    table: {
      kind: "table",
      title: "Competition participation and outcomes",
      columns: ["Competition", "Organizer", "Project", "Date", "Status", "Outcome", "Verified by"],
      rows: regs.map((r) => [
        r.competition.name, r.competition.organizer, r.project.name, ymd(r.competition.endDate ?? r.competition.submissionDeadline),
        human(r.status), r.outcome === "PENDING" ? "Pending" : `${human(r.outcome)}${r.outcomeVerifiedAt ? "" : " (unverified claim)"}`, r.outcomeVerifiedBy?.name ?? "—",
      ]),
      empty: "No competition registrations fall in this period.",
      note: "Only outcomes verified by the assigned mentor or an admin count towards winner/finalist totals.",
    } satisfies Section,
  };
}

async function fundingStats(scope: Scope, period: Period) {
  const where: Prisma.FundingAwardWhereInput = {
    projectId: { in: scope.projectIds },
    OR: [{ awardedAt: { gte: period.start, lte: period.end } }, { awardedAt: null, createdAt: { gte: period.start, lte: period.end } }],
  };
  const [totals, bySource, awards, pendingChanges] = await Promise.all([
    prisma.fundingAward.groupBy({ by: ["verification", "currency"], where, _sum: { amount: true }, _count: { _all: true }, orderBy: { currency: "asc" } }),
    prisma.fundingAward.groupBy({ by: ["source", "currency"], where: { ...where, verification: "VERIFIED" }, _sum: { amount: true }, _count: { _all: true }, orderBy: { currency: "asc" } }),
    prisma.fundingAward.findMany({
      where,
      select: { title: true, source: true, amount: true, currency: true, verification: true, awardedAt: true, project: { select: { name: true } }, verifiedBy: { select: { name: true } } },
      orderBy: [{ verification: "asc" }, { awardedAt: { sort: "asc", nulls: "last" } }],
      take: 500,
    }),
    prisma.fundingChangeRequest.count({ where: { status: "PENDING", award: { projectId: { in: scope.projectIds } } } }),
  ]);
  const money = (d: Prisma.Decimal | null, c: string) => formatAmount((d ?? new Prisma.Decimal(0)).toFixed(2), c);
  const list = (v: string) => totals.filter((t) => t.verification === v);
  const summary = (v: string) => (list(v).length ? list(v).map((t) => money(t._sum.amount, t.currency)).join(" + ") : "None");
  return {
    verifiedLabel: summary("VERIFIED"),
    estimatedLabel: summary("ESTIMATED"),
    verifiedCount: list("VERIFIED").reduce((a, t) => a + t._count._all, 0),
    estimatedCount: list("ESTIMATED").reduce((a, t) => a + t._count._all, 0),
    rejectedCount: list("REJECTED").reduce((a, t) => a + t._count._all, 0),
    pendingChanges,
    totalsTable: {
      kind: "table",
      title: "Funding totals by currency",
      columns: ["Currency", "Verified", "Awards", "Estimated (unverified)", "Awards"],
      rows: [...new Set(totals.map((t) => t.currency))].map((c) => {
        const v = totals.find((t) => t.currency === c && t.verification === "VERIFIED");
        const e = totals.find((t) => t.currency === c && t.verification === "ESTIMATED");
        return [c, v ? money(v._sum.amount, c) : "—", String(v?._count._all ?? 0), e ? money(e._sum.amount, c) : "—", String(e?._count._all ?? 0)];
      }),
      numeric: [1, 2, 3, 4],
      empty: "No funding was recorded in this period.",
      note: "Totals are exact decimal sums per currency. Currencies are never converted or added together; rejected awards are excluded.",
    } satisfies Section,
    sourceTable: {
      kind: "table",
      title: "Verified funding by source",
      columns: ["Source", "Currency", "Awards", "Amount"],
      rows: bySource.map((s) => [human(s.source), s.currency, String(s._count._all), money(s._sum.amount, s.currency)]),
      numeric: [2, 3],
      empty: "No verified funding in this period.",
    } satisfies Section,
    awardsTable: {
      kind: "table",
      title: "Funding awards",
      columns: ["Project", "Award", "Source", "Amount", "Status", "Awarded", "Verified by"],
      rows: awards.map((a) => [a.project.name, a.title, human(a.source), money(a.amount, a.currency), human(a.verification), ymd(a.awardedAt), a.verifiedBy?.name ?? "—"]),
      numeric: [3],
      empty: "No funding was recorded in this period.",
    } satisfies Section,
  };
}

async function risks(scope: Scope, overdueTasks: number, overdueMilestones: number): Promise<Section> {
  const staleBefore = new Date(Date.now() - 14 * DAY);
  const [alerts, pendingOutcomes] = await Promise.all([
    prisma.inactivityAlert.findMany({ where: { projectId: { in: scope.projectIds }, status: "OPEN" }, select: { reason: true, createdAt: true, project: { select: { name: true } } }, take: 50 }),
    prisma.competitionRegistration.count({ where: { projectId: { in: scope.projectIds }, outcome: { not: "PENDING" }, outcomeVerifiedAt: null } }),
  ]);
  const rows: string[][] = [];
  for (const p of scope.projects) {
    if (p.status === "ACTIVE" && p.lastActivityAt < staleBefore) rows.push([p.name, "No activity in 14+ days", `Last activity ${ymd(p.lastActivityAt)}`]);
    if (p.status === "ACTIVE" && !p.mentor) rows.push([p.name, "No mentor assigned", ""]);
  }
  for (const a of alerts) rows.push([a.project.name, "Open inactivity alert", `${a.reason} (${ymd(a.createdAt)})`]);
  if (overdueTasks) rows.push(["All in scope", "Overdue tasks", `${overdueTasks} open past due date`]);
  if (overdueMilestones) rows.push(["All in scope", "Overdue milestones", `${overdueMilestones} not approved by due date`]);
  if (pendingOutcomes) rows.push(["All in scope", "Unverified competition results", `${pendingOutcomes} outcome claims awaiting mentor/admin verification`]);
  return { kind: "table", title: "Risks and overdue items", columns: ["Project", "Risk", "Detail"], rows, empty: "No open risks were found for the projects in scope." };
}

function emptyScopeNotice(scope: Scope): Section[] {
  return scope.projects.length === 0
    ? [{ kind: "notice", title: "No records", tone: "info", body: "There are no projects in scope for this report and period, so every section below is empty. No figures have been estimated." }]
    : [];
}

// ───────────────────────────── Builders ─────────────────────────────

type Builder = (ctx: { scope: Scope; period: Period; requester: AuthUser }) => Promise<Section[]>;

const builders: Record<ReportType, Builder> = {
  async PROJECT({ scope, period }) {
    const p = scope.projects[0];
    if (!p) throw new PermanentReportError("Project not found");
    const [tasks, ms, att, comp, fund, history] = await Promise.all([
      taskStats(scope, period), milestoneStats(scope, period), attendanceStats(scope, period), competitionStats(scope, period), fundingStats(scope, period), stageChanges(scope, period),
    ]);
    return [
      { kind: "metrics", title: "Summary", items: [
        { label: "Stage", value: stage(p.stage), hint: human(p.status) },
        { label: "Team", value: int(p.memberships.length), hint: p.mentor ? `Mentor: ${p.mentor.name}` : "No mentor assigned" },
        { label: "Task completion", value: pct(tasks.done, tasks.total), hint: `${tasks.done} of ${tasks.total} tasks` },
        { label: "Milestones approved", value: `${ms.approved} / ${ms.total}`, hint: `${ms.overdue} overdue` },
        { label: "Verified attendance", value: att.rate, hint: `${att.sessions} sessions` },
        { label: "Competitions", value: int(comp.registrations), hint: `${comp.winners} verified wins` },
        { label: "Verified funding", value: fund.verifiedLabel, hint: `${fund.verifiedCount} awards` },
        { label: "Estimated funding", value: fund.estimatedLabel, hint: "Unverified, not counted" },
      ] },
      { kind: "table", title: "Team", columns: ["Name", "Email", "Role"], rows: p.memberships.map((m) => [m.user.name, m.user.email, human(m.role)]), empty: "This project has no members." },
      history, tasks.table, ms.statusTable, ms.reviewTable, att.sessionTable, att.peopleTable, comp.table, fund.awardsTable,
      await risks(scope, tasks.overdueCount, ms.overdue), tasks.overdueTable,
    ];
  },

  async COHORT({ scope, period }) {
    const [tasks, ms, att, comp, fund] = await Promise.all([taskStats(scope, period), milestoneStats(scope, period), attendanceStats(scope, period), competitionStats(scope, period), fundingStats(scope, period)]);
    return [
      ...emptyScopeNotice(scope),
      { kind: "metrics", title: "Summary", items: [
        { label: "Projects", value: int(scope.projects.length), hint: `${scope.projects.filter((p) => p.status === "ACTIVE").length} active` },
        { label: "Participants", value: int(scope.memberIds?.length ?? 0) },
        { label: "Task completion", value: pct(tasks.done, tasks.total), hint: `${tasks.done} of ${tasks.total}` },
        { label: "Milestones approved", value: `${ms.approved} / ${ms.total}` },
        { label: "Verified attendance", value: att.rate, hint: `${att.sessions} sessions` },
        { label: "Verified wins", value: int(comp.winners), hint: `${comp.finalists} finalists` },
        { label: "Verified funding", value: fund.verifiedLabel },
        { label: "Open risks", value: int(tasks.overdueCount + ms.overdue), hint: "Overdue tasks + milestones" },
      ] },
      directory(scope), stageDistribution(scope), tasks.table, ms.byStage, att.sessionTable, att.belowTable, comp.table, fund.totalsTable,
      await risks(scope, tasks.overdueCount, ms.overdue),
    ];
  },

  async TERM({ scope, period }) {
    const [tasks, ms, att, comp, fund, history] = await Promise.all([taskStats(scope, period), milestoneStats(scope, period), attendanceStats(scope, period), competitionStats(scope, period), fundingStats(scope, period), stageChanges(scope, period)]);
    return [
      ...emptyScopeNotice(scope),
      { kind: "metrics", title: "Term at a glance", items: [
        { label: "Projects", value: int(scope.projects.length) },
        { label: "Tasks completed", value: int(tasks.inPeriod), hint: "In period" },
        { label: "Milestones approved", value: int(ms.approvedInPeriod), hint: "In period" },
        { label: "Attendance sessions", value: int(att.sessions), hint: `Verified rate ${att.rate}` },
        { label: "Competition entries", value: int(comp.registrations) },
        { label: "Verified wins", value: int(comp.winners), hint: `${comp.finalists} finalists` },
        { label: "Verified funding", value: fund.verifiedLabel },
        { label: "Estimated funding", value: fund.estimatedLabel, hint: "Unverified" },
      ] },
      directory(scope), history, tasks.table, ms.reviewTable, att.sessionTable, comp.table, fund.totalsTable,
      await risks(scope, tasks.overdueCount, ms.overdue),
    ];
  },

  async ATTENDANCE_COMPLIANCE({ scope, period }) {
    const att = await attendanceStats(scope, period);
    return [
      { kind: "metrics", title: "Compliance summary", items: [
        { label: "Sessions held", value: int(att.sessions) },
        { label: "Eligible check-ins", value: int(att.eligibleTotal) },
        { label: "Verified present", value: int(att.presentTotal) },
        { label: "Attendance rate", value: att.rate },
        { label: `Below ${config.ATTENDANCE_COMPLIANCE_THRESHOLD}%`, value: int(att.belowCount), hint: "Participants" },
      ] },
      att.sessionTable, att.belowTable, att.peopleTable,
    ];
  },

  async MILESTONE_PROGRESSION({ scope, period }) {
    const [ms, history] = await Promise.all([milestoneStats(scope, period), stageChanges(scope, period)]);
    return [
      ...emptyScopeNotice(scope),
      { kind: "metrics", title: "Progression summary", items: [
        { label: "Milestones", value: int(ms.total) },
        { label: "Approved", value: int(ms.approved), hint: `${ms.approvedInPeriod} in period` },
        { label: "Awaiting review", value: int(ms.pendingReview) },
        { label: "Overdue", value: int(ms.overdue) },
      ] },
      stageDistribution(scope), ms.byStage, history, ms.reviewTable, ms.overdueTable, ms.statusTable,
    ];
  },

  async COMPETITION_OUTCOMES({ scope, period }) {
    const comp = await competitionStats(scope, period);
    return [
      { kind: "metrics", title: "Outcomes summary", items: [
        { label: "Registrations", value: int(comp.registrations) },
        { label: "Verified winners", value: int(comp.winners) },
        { label: "Verified finalists", value: int(comp.finalists) },
        { label: "Unverified claims", value: int(comp.unverified), hint: "Excluded from totals" },
      ] },
      comp.table,
    ];
  },

  async FUNDING({ scope, period }) {
    const fund = await fundingStats(scope, period);
    return [
      { kind: "metrics", title: "Funding summary", items: [
        { label: "Verified", value: fund.verifiedLabel, hint: `${fund.verifiedCount} awards` },
        { label: "Estimated (unverified)", value: fund.estimatedLabel, hint: `${fund.estimatedCount} awards` },
        { label: "Rejected", value: int(fund.rejectedCount), hint: "Excluded" },
        { label: "Pending change requests", value: int(fund.pendingChanges) },
      ] },
      fund.totalsTable, fund.sourceTable, fund.awardsTable,
    ];
  },

  async DISCORD_ENGAGEMENT() {
    // Discord telemetry is delivered by the SPT-3 integration; until it lands this report
    // states that plainly instead of showing numbers.
    return [{
      kind: "notice",
      title: "Discord engagement",
      tone: "pending",
      body: "Discord engagement reporting is pending the Discord bot integration. No engagement figures are shown because none have been collected through a verified integration yet.",
    }];
  },

  async EXECUTIVE_SUMMARY({ scope, period }) {
    const [tasks, ms, att, comp, fund] = await Promise.all([taskStats(scope, period), milestoneStats(scope, period), attendanceStats(scope, period), competitionStats(scope, period), fundingStats(scope, period)]);
    const wins = comp.table.rows.filter((r) => r[5] === "Winner" || r[5] === "Finalist");
    return [
      ...emptyScopeNotice(scope),
      { kind: "metrics", title: "Headline metrics", items: [
        { label: "Projects", value: int(scope.projects.length), hint: `${scope.projects.filter((p) => p.status === "ACTIVE").length} active` },
        { label: "Participants", value: scope.memberIds ? int(scope.memberIds.length) : int(new Set(scope.projects.flatMap((p) => p.memberships.map((m) => m.userId))).size) },
        { label: "Tasks completed", value: int(tasks.inPeriod), hint: "In period" },
        { label: "Milestones approved", value: int(ms.approvedInPeriod), hint: "In period" },
        { label: "Verified attendance", value: att.rate, hint: `${att.sessions} sessions` },
        { label: "Verified wins", value: int(comp.winners), hint: `${comp.finalists} finalists` },
        { label: "Verified funding", value: fund.verifiedLabel },
        { label: "Open risks", value: int(tasks.overdueCount + ms.overdue) },
      ] },
      stageDistribution(scope),
      { kind: "table", title: "Verified competition results", columns: comp.table.columns, rows: wins, empty: "No verified wins or finalist places in this period." },
      fund.totalsTable,
      await risks(scope, tasks.overdueCount, ms.overdue),
    ];
  },
};

export async function buildReport(report: GeneratedReport): Promise<ReportDocument> {
  const requester = await prisma.user.findUnique({ where: { id: report.requestedById }, select: { id: true, email: true, name: true, role: true, status: true, onboardedAt: true } });
  if (!requester || requester.status !== "ACTIVE") throw new PermanentReportError("The requesting account is no longer active");
  let fallbackStart: Date | null = null;
  if (report.type === "PROJECT" && report.projectId) fallbackStart = (await prisma.project.findUnique({ where: { id: report.projectId }, select: { createdAt: true } }))?.createdAt ?? null;
  const period = resolvePeriod(report, fallbackStart);
  const scope = await resolveScope(report, requester, period);
  const sections = await builders[report.type]({ scope, period, requester });
  return {
    title: REPORT_TYPE_LABELS[report.type],
    subtitle: scope.label,
    institutionId: config.INSTITUTION_ID,
    periodLabel: period.label,
    scopeLabel: scope.label,
    generatedAt: new Date(),
    reportId: report.id,
    sections: [...sections, { kind: "signoff", preparedBy: `${requester.name} (${human(requester.role)})` }],
  };
}
