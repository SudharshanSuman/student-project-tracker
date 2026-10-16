import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity, AlertTriangle, CalendarDays, CheckCircle2, Clock, FileText, FolderKanban, Headphones, Landmark, QrCode, Trophy,
} from "lucide-react";
import { PROJECT_STAGES, STAGE_LABELS, type ProjectStage, type Role, type TaskStatus } from "@iic/shared";
import { QueryFilters } from "@/components/filters/query-filters";
import { HealthBadge, StatusBadge } from "@/components/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/states";
import { getMe, serverApi } from "@/lib/api-server";
import { formatDate, formatDateTime, formatMoney, humanize, relativeTime } from "@/lib/utils";
import { CompletedChart, StageChart, TaskStatusChart } from "./charts";

export const metadata: Metadata = { title: "Dashboard" };

interface Dashboard {
  generatedAt: string;
  period: { from: string; to: string };
  scope: { projectCount: number; role: Role };
  metrics: {
    activeProjects: number; registeredStudents: number; activeMentors: number; taskCompletionRate: number | null;
    totalTasks: number; doneTasks: number; overdueTasks: number; pendingApprovals: number; verifiedAttendanceHours: number;
    attendanceRecords: number; discordVoiceHours: number; discordMessages: number; hackathonsEntered: number; competitionWins: number;
  };
  funding: { currency: string; verification: string; source: string; amount: string }[] | null;
  projectsByStage: { stage: ProjectStage; count: number }[];
  taskStatus: { status: TaskStatus; count: number }[];
  completedPerWeek: { week: string; completed: number }[];
  projectHealth: { id: string; name: string; stage: ProjectStage; health?: string; openTasks?: number; overdueTasks?: number }[];
  recentActivity: { id: string; action: string; entityType: string; createdAt: string; actor: { name: string } | null; project: { id: string; name: string } | null }[];
  deadlines: {
    tasks: { id: string; title: string; dueDate: string; project: { id: string; name: string } }[];
    milestones: { id: string; title: string; dueDate: string; project: { id: string; name: string } }[];
    competitions: { id: string; name: string; submissionDeadline: string }[];
  };
  upcomingEvents: { id: string; title: string; startsAt: string; location: string | null; type: string }[];
  openSessions: { id: string; name: string; startsAt: string; status: string; _count: { records: number } }[];
  notifications: { id: string; title: string; link: string | null; readAt: string | null; createdAt: string }[];
  discord: { configured: boolean; integration: { status: string; guildName: string | null; lastHeartbeatAt: string | null; lastError: string | null } | null };
  leaderboard: { projectId: string; name: string; wins: number; finals: number }[];
  reports: { id: string; title: string; type: string; status: string; createdAt: string }[];
}

type SP = Promise<Record<string, string | undefined>>;

function sumFunding(rows: NonNullable<Dashboard["funding"]>, verification: string) {
  const byCurrency = new Map<string, number>();
  for (const r of rows.filter((r) => r.verification === verification)) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + Number(r.amount));
  return [...byCurrency.entries()];
}

export default async function DashboardPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const me = await getMe();
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1])).toString();
  const [d, cohorts, options] = await Promise.all([
    serverApi<Dashboard>(`/dashboard${qs ? `?${qs}` : ""}`),
    serverApi<{ cohorts: { id: string; name: string }[] }>("/cohorts"),
    serverApi<{ projects: { id: string; name: string }[] }>("/projects/options"),
  ]);
  const m = d.metrics;
  const verified = d.funding ? sumFunding(d.funding, "VERIFIED") : [];
  const estimated = d.funding ? sumFunding(d.funding, "ESTIMATED") : [];

  return (
    <>
      <PageHeader
        title="Executive dashboard"
        description={`Live figures for ${d.scope.projectCount} project${d.scope.projectCount === 1 ? "" : "s"} you can access · ${formatDate(d.period.from)} – ${formatDate(d.period.to)}`}
      />
      <QueryFilters
        filters={[
          { name: "cohortId", label: "Cohort", type: "select", options: cohorts.cohorts.map((c) => ({ value: c.id, label: c.name })) },
          { name: "projectId", label: "Project", type: "select", options: options.projects.map((p) => ({ value: p.id, label: p.name })) },
          { name: "stage", label: "Stage", type: "select", options: PROJECT_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] })) },
          { name: "from", label: "From", type: "date" },
          { name: "to", label: "To", type: "date" },
        ]}
      />

      {/* TOP */}
      <section aria-label="Key metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active projects" value={m.activeProjects} icon={<FolderKanban className="h-4 w-4" />} hint={`${m.registeredStudents} students · ${m.activeMentors} mentors`} />
        <Stat
          label="Task completion"
          value={m.taskCompletionRate === null ? "—" : `${m.taskCompletionRate}%`}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="success"
          hint={m.totalTasks ? `${m.doneTasks}/${m.totalTasks} done · ${m.overdueTasks} overdue` : "No tasks yet"}
        />
        <Stat label="Verified attendance" value={`${m.verifiedAttendanceHours} h`} icon={<QrCode className="h-4 w-4" />} hint={`${m.attendanceRecords} check-ins in period`} />
        <Stat
          label="Recorded funding (verified)"
          value={d.funding === null ? "Restricted" : verified.length ? verified.map(([c, a]) => formatMoney(a, c)).join(" + ") : "—"}
          icon={<Landmark className="h-4 w-4" />}
          tone="warning"
          hint={estimated.length ? `+ estimated ${estimated.map(([c, a]) => formatMoney(a, c)).join(", ")}` : `${m.hackathonsEntered} competitions entered · ${m.competitionWins} wins`}
        />
      </section>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-4">
        {/* MAIN */}
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Project portfolio</CardTitle>
              <CardDescription>Projects by incubation stage</CardDescription>
            </CardHeader>
            <CardContent>{d.scope.projectCount ? <StageChart data={d.projectsByStage} /> : <EmptyState title="No projects in scope" />}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Kanban activity</CardTitle>
              <CardDescription>Task status across projects · {m.overdueTasks} overdue</CardDescription>
            </CardHeader>
            <CardContent>{m.totalTasks ? <TaskStatusChart data={d.taskStatus} /> : <EmptyState title="No tasks yet" />}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Milestone approvals <Link href="/milestones?status=SUBMITTED" className="text-xs font-normal text-link">Review queue →</Link>
              </CardTitle>
              <CardDescription>{m.pendingApprovals} awaiting mentor/admin decision</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {d.deadlines.milestones.length === 0 && m.pendingApprovals === 0 ? (
                <p className="text-xs text-muted-foreground">No pending approvals or upcoming milestone deadlines.</p>
              ) : (
                d.deadlines.milestones.map((ms) => (
                  <div key={ms.id} className="flex items-center justify-between text-sm">
                    <span className="truncate">{ms.title} <span className="text-muted-foreground">· {ms.project.name}</span></span>
                    <span className="tabular-nums text-xs text-muted-foreground">{formatDate(ms.dueDate)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Project health</CardTitle>
              <CardDescription>From overdue ratio and days since last activity</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {d.projectHealth.length === 0 ? (
                <p className="text-xs text-muted-foreground">No projects in scope.</p>
              ) : (
                d.projectHealth.map((p) => (
                  <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-muted">
                    <span className="truncate">{p.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums text-xs text-muted-foreground">{p.overdueTasks ?? 0} overdue</span>
                      <HealthBadge health={p.health} />
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* SIDE */}
        <aside className="grid min-w-0 grid-cols-1 content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Headphones className="h-4 w-4 text-link" /> Discord</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {!d.discord.configured ? (
                <p>Not connected. An admin can configure the bot in <Link className="text-link" href="/admin/integrations">Integrations</Link>.</p>
              ) : d.discord.integration ? (
                <div className="space-y-1">
                  <StatusBadge status={d.discord.integration.status} />
                  <p>{m.discordVoiceHours} voice hours · {m.discordMessages} messages (aggregate)</p>
                </div>
              ) : (
                <p>Credentials present; waiting for the bot&apos;s first heartbeat.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-link" /> Upcoming events</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {d.upcomingEvents.length === 0 ? <p className="text-xs text-muted-foreground">Nothing scheduled.</p> : d.upcomingEvents.map((e) => (
                <div key={e.id} className="text-sm">
                  <p className="truncate">{e.title}</p>
                  <p className="tabular-nums text-[11px] text-muted-foreground">{formatDateTime(e.startsAt)}{e.location ? ` · ${e.location}` : ""}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><QrCode className="h-4 w-4 text-link" /> Attendance sessions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {d.openSessions.length === 0 ? <p className="text-xs text-muted-foreground">No pending sessions.</p> : d.openSessions.map((s) => (
                <Link key={s.id} href="/attendance" className="flex items-center justify-between text-sm hover:text-link">
                  <span className="truncate">{s.name}</span>
                  <StatusBadge status={s.status} />
                </Link>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">Notifications <Link href="/notifications" className="text-xs font-normal text-link">All →</Link></CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {d.notifications.length === 0 ? <p className="text-xs text-muted-foreground">You are all caught up.</p> : d.notifications.map((n) => (
                <Link key={n.id} href={n.link ?? "/notifications"} className="block text-sm hover:text-link">
                  <span className={n.readAt ? "text-muted-foreground" : ""}>{n.title}</span>
                  <span className="block tabular-nums text-[11px] text-muted-foreground">{relativeTime(n.createdAt)}</span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* BOTTOM */}
      <section className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Trophy className="h-4 w-4 bg-warning px-1 text-foreground" /> Hackathon leaderboard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {d.leaderboard.length === 0 ? <p className="text-xs text-muted-foreground">No finalist or winner outcomes recorded.</p> : d.leaderboard.map((r, i) => (
              <div key={r.projectId} className="flex items-center justify-between text-sm">
                <span className="truncate"><span className="mr-2 tabular-nums text-muted-foreground">{i + 1}</span>{r.name}</span>
                <span className="tabular-nums text-xs">{r.wins}W · {r.finals}F</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Landmark className="h-4 w-4 bg-success px-1 text-foreground" /> Funding overview</CardTitle>
            <CardDescription>Verified and estimated tracked separately</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {d.funding === null ? <p className="text-xs text-muted-foreground">Funding details are restricted to leads and staff.</p> : d.funding.length === 0 ? <p className="text-xs text-muted-foreground">No funding recorded.</p> : d.funding.map((f) => (
              <div key={`${f.currency}-${f.verification}-${f.source}`} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{humanize(f.source)}</span>
                <span className="flex items-center gap-2"><span className="tabular-nums">{formatMoney(f.amount, f.currency)}</span><StatusBadge status={f.verification} /></span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4 text-link" /> Activity timeline</CardTitle>
            <CardDescription>Tasks completed per week (8 weeks)</CardDescription>
          </CardHeader>
          <CardContent>
            {d.completedPerWeek.length ? <CompletedChart data={d.completedPerWeek} /> : <p className="text-xs text-muted-foreground">No tasks completed in the last 8 weeks.</p>}
            <ul className="mt-3 space-y-1 border-t pt-3">
              {d.recentActivity.slice(0, 5).map((a) => (
                <li key={a.id} className="truncate text-xs text-muted-foreground">
                  <span className="text-foreground">{a.actor?.name ?? "System"}</span> {humanize(a.action.split(".").pop() ?? a.action)} {a.entityType.toLowerCase()}
                  {a.project ? <> · {a.project.name}</> : null} · {relativeTime(a.createdAt)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4 text-link" /> Reports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {me.role === "ADMIN" || me.role === "MENTOR" ? (
              d.reports.length ? d.reports.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2"><span className="truncate">{r.title}</span><StatusBadge status={r.status} /></div>
              )) : <p className="text-xs text-muted-foreground">No reports generated yet. <Link href="/reports" className="text-link">Reports →</Link></p>
            ) : (
              <p className="text-xs text-muted-foreground">Institutional reports are generated by staff.</p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4 bg-warning px-1 text-foreground" /> Upcoming deadlines (14 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {d.deadlines.tasks.length + d.deadlines.competitions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No deadlines in the next two weeks.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {d.deadlines.tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                    <Link href={`/board?project=${t.project.id}&task=${t.id}`} className="truncate hover:text-link">{t.title}</Link>
                    <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{formatDate(t.dueDate)}</span>
                  </li>
                ))}
                {d.deadlines.competitions.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                    <span className="flex items-center gap-1 truncate"><Trophy className="h-3 w-3 bg-warning px-1 text-foreground" />{c.name}</span>
                    <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{formatDate(c.submissionDeadline)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
      <p className="mt-4 flex items-center gap-1 text-[11px] text-muted-foreground">
        <AlertTriangle className="h-3 w-3" /> Figures are computed from platform records at {formatDateTime(d.generatedAt)}. Engagement and attendance data show presence, not productivity.
      </p>
    </>
  );
}
