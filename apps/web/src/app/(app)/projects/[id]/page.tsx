import type { Metadata } from "next";
import Link from "next/link";
import { Columns3, ExternalLink, Github } from "lucide-react";
import { STAGE_LABELS, type ProjectStage, type Role } from "@iic/shared";
import { HealthBadge, StageBadge, StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { getMe, serverApi } from "@/lib/api-server";
import { formatDate, formatDateTime, formatMoney, humanize, relativeTime } from "@/lib/utils";
import { DocumentsPanel } from "./documents-panel";
import { MembersPanel, MilestoneCreate, ProjectAdminActions } from "./panels";

export const metadata: Metadata = { title: "Project" };

interface Detail {
  project: {
    id: string; name: string; description: string; category: string; stage: ProjectStage; status: string; repoUrl: string | null;
    createdAt: string; lastActivityAt: string; cohortId: string | null; mentorId: string | null;
    cohort: { id: string; name: string; term: string } | null;
    mentor: { id: string; name: string; email: string } | null;
    createdBy: { name: string };
    memberships: { id: string; role: "LEAD" | "MEMBER"; joinedAt: string; user: { id: string; name: string; email: string; role: Role } }[];
    milestones: { id: string; title: string; stage: ProjectStage; status: string; isStageGate: boolean; dueDate: string | null }[];
    stageHistory: { id: string; fromStage: ProjectStage | null; toStage: ProjectStage; reason: string | null; createdAt: string; changedBy: { name: string } }[];
    registrations: { id: string; status: string; outcome: string; outcomeVerifiedAt: string | null; competition: { id: string; name: string; organizer: string } }[];
    github: { owner: string; repo: string; status: string; lastSyncedAt: string | null; latestCommitAt: string | null } | null;
    documents: { id: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string; uploadedBy: { id: string; name: string } }[];
    funding: { id: string; title: string; source: string; amount: string; currency: string; verification: string }[] | null;
    health?: string; openTasks?: number; overdueTasks?: number; doneTasks?: number; totalTasks?: number;
  };
  access: { canManage: boolean; canReview: boolean; isAdmin: boolean; isLead: boolean; isMember: boolean };
}

interface Activity {
  entries: { id: string; action: string; entityType: string; createdAt: string; actor: { name: string } | null }[];
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  const [{ project: p, access }, activity, cohorts, mentors] = await Promise.all([
    serverApi<Detail>(`/projects/${id}`),
    serverApi<Activity>(`/projects/${id}/activity?pageSize=15`),
    serverApi<{ cohorts: { id: string; name: string }[] }>("/cohorts"),
    me.role === "ADMIN" ? serverApi<{ users: { id: string; name: string }[] }>("/users/lookup?role=MENTOR") : Promise.resolve({ users: [] }),
  ]);
  const completion = p.totalTasks ? Math.round(((p.doneTasks ?? 0) / p.totalTasks) * 100) : null;
  const currentGate = p.milestones.find((m) => m.isStageGate && m.stage === p.stage);

  return (
    <>
      <PageHeader
        title={p.name}
        description={`${p.category}${p.cohort ? ` · ${p.cohort.name} (${p.cohort.term})` : ""} · created ${formatDate(p.createdAt)} by ${p.createdBy.name}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm"><Link href={`/board?project=${p.id}`}><Columns3 /> Kanban board</Link></Button>
            <ProjectAdminActions project={{ id: p.id, name: p.name, description: p.description, category: p.category, repoUrl: p.repoUrl, status: p.status, stage: p.stage, mentorId: p.mentorId, cohortId: p.cohortId }} access={access} cohorts={cohorts.cohorts} mentors={mentors.users} gateApproved={currentGate?.status === "APPROVED"} />
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StageBadge stage={p.stage} />
        <StatusBadge status={p.status} />
        <HealthBadge health={p.health} />
        <span className="text-xs text-muted-foreground">Last activity {relativeTime(p.lastActivityAt)}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>About</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="whitespace-pre-wrap text-muted-foreground">{p.description}</p>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><dt className="text-xs text-muted-foreground">Tasks</dt><dd className="tabular-nums">{p.doneTasks ?? 0}/{p.totalTasks ?? 0}{completion !== null ? ` (${completion}%)` : ""}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Overdue</dt><dd className="tabular-nums">{p.overdueTasks ?? 0}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Mentor</dt><dd>{p.mentor?.name ?? "Unassigned"}</dd></div>
                <div>
                  <dt className="text-xs text-muted-foreground">Repository</dt>
                  <dd>{p.repoUrl ? <a href={p.repoUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-link">Open <ExternalLink className="h-3 w-3" /></a> : "—"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Milestones & stage gates
                {access.canManage ? <MilestoneCreate projectId={p.id} stage={p.stage} /> : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {p.milestones.length === 0 ? (
                <EmptyState title="No milestones yet" description={`Add the ${STAGE_LABELS[p.stage]} stage-gate milestone to request advancement.`} />
              ) : (
                <Table>
                  <THead><TR><TH>Milestone</TH><TH>Stage</TH><TH>Status</TH><TH>Due</TH></TR></THead>
                  <TBody>
                    {p.milestones.map((m) => (
                      <TR key={m.id}>
                        <TD><Link href={`/milestones?open=${m.id}`} className="hover:text-link">{m.title}</Link>{m.isStageGate ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-link">GATE</span> : null}</TD>
                        <TD className="text-xs text-muted-foreground">{STAGE_LABELS[m.stage]}</TD>
                        <TD><StatusBadge status={m.status} /></TD>
                        <TD className="tabular-nums text-xs">{formatDate(m.dueDate)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Stage history</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-2 border-l pl-4">
                {p.stageHistory.map((h) => (
                  <li key={h.id} className="text-sm">
                    <span className="font-medium">{h.fromStage ? `${STAGE_LABELS[h.fromStage]} → ` : ""}{STAGE_LABELS[h.toStage]}</span>
                    <span className="block text-xs text-muted-foreground">{h.changedBy.name} · {formatDateTime(h.createdAt)}{h.reason ? ` · ${h.reason}` : ""}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Activity (audit trail)</CardTitle></CardHeader>
            <CardContent>
              {activity.entries.length === 0 ? <p className="text-xs text-muted-foreground">No activity yet.</p> : (
                <ul className="space-y-1.5 text-sm">
                  {activity.entries.map((a) => (
                    <li key={a.id} className="flex justify-between gap-2">
                      <span className="truncate"><span className="text-muted-foreground">{a.actor?.name ?? "System"}</span> · <span className="font-mono text-xs">{a.action}</span></span>
                      <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{formatDateTime(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <MembersPanel projectId={p.id} memberships={p.memberships} canManage={access.canManage} isAdmin={access.isAdmin} />

          <Card>
            <CardHeader><CardTitle>Competitions</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {p.registrations.length === 0 ? <p className="text-xs text-muted-foreground">No competition registrations.</p> : p.registrations.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2">
                  <Link href={`/competitions/${r.competition.id}`} className="truncate hover:text-link">{r.competition.name}</Link>
                  <span className="flex items-center gap-1">
                    <StatusBadge status={r.outcome === "PENDING" ? r.status : r.outcome} />
                    {r.outcome !== "PENDING" && !r.outcomeVerifiedAt ? <span className="text-[10px] text-muted-foreground">unverified</span> : null}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          {p.funding ? (
            <Card>
              <CardHeader><CardTitle>Funding</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {p.funding.length === 0 ? <p className="text-xs text-muted-foreground">No funding recorded.</p> : p.funding.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{f.title} <span className="text-xs text-muted-foreground">· {humanize(f.source)}</span></span>
                    <span className="flex items-center gap-1.5"><span className="tabular-nums text-xs">{formatMoney(f.amount, f.currency)}</span><StatusBadge status={f.verification} /></span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Github className="h-4 w-4" /> GitHub</CardTitle></CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {p.github ? (
                <div className="space-y-1">
                  <p className="font-mono text-foreground">{p.github.owner}/{p.github.repo}</p>
                  <StatusBadge status={p.github.status} />
                  <p>Last sync {p.github.lastSyncedAt ? formatDateTime(p.github.lastSyncedAt) : "never"}</p>
                </div>
              ) : (
                <p>No repository linked for sync. <Link href="/github" className="text-link">GitHub integration →</Link></p>
              )}
            </CardContent>
          </Card>

          <DocumentsPanel projectId={p.id} documents={p.documents} canUpload={(access.isMember || access.isAdmin) && p.status !== "ARCHIVED"} canManage={access.canManage} userId={me.id} />
        </div>
      </div>
    </>
  );
}
