import type { Metadata } from "next";
import Link from "next/link";
import { Flag } from "lucide-react";
import { MILESTONE_STATUSES, STAGE_LABELS, type ProjectStage } from "@iic/shared";
import { StatusBadge } from "@/components/status";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { getMe, serverApi } from "@/lib/api-server";
import { cn, formatDate, humanize, relativeTime } from "@/lib/utils";
import { MilestoneDialog, StageGateEditor } from "./milestone-client";

export const metadata: Metadata = { title: "Milestones" };

interface Row {
  id: string; title: string; stage: ProjectStage; status: string; isStageGate: boolean; dueDate: string | null; updatedAt: string;
  project: { id: string; name: string; mentor: { name: string } | null };
  submissions: { id: string; status: string; submittedAt: string; submittedBy: { name: string } }[];
}

export default async function MilestonesPage({ searchParams }: { searchParams: Promise<{ status?: string; open?: string }> }) {
  const sp = await searchParams;
  const me = await getMe();
  const status = MILESTONE_STATUSES.includes(sp.status as never) ? sp.status : undefined;
  const [data, gates] = await Promise.all([
    serverApi<{ milestones: Row[]; counts: Record<string, number>; canReview: boolean }>(`/milestones${status ? `?status=${status}` : ""}`),
    me.role === "ADMIN" ? serverApi<{ requirements: { id: string; stage: ProjectStage; title: string; isActive: boolean; sortOrder: number }[] }>("/stage-gates") : Promise.resolve(null),
  ]);
  const tabs = [{ key: undefined, label: "All" }, ...MILESTONE_STATUSES.map((s) => ({ key: s, label: humanize(s) }))];
  return (
    <>
      <PageHeader title="Milestone review" description={data.canReview ? "Stage-gate evidence awaiting your decision. Every decision records reviewer, time and reason." : "Track your project milestones and submit evidence for review."} />
      <nav className="mb-4 flex flex-wrap gap-1" aria-label="Filter by status">
        {tabs.map((t) => (
          <Link key={t.label} href={t.key ? `/milestones?status=${t.key}` : "/milestones"} aria-current={status === t.key ? "page" : undefined}
            className={cn("rounded-md border px-3 py-1 text-xs", status === t.key ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>
            {t.label}{t.key ? <span className="ml-1 tabular-nums text-muted-foreground">{data.counts[t.key] ?? 0}</span> : null}
          </Link>
        ))}
      </nav>
      <Card>
        <CardContent className="p-0">
          {data.milestones.length === 0 ? (
            <EmptyState className="m-4" icon={<Flag className="h-6 w-6" />} title="No milestones here" description="Milestones are created from a project's detail page." />
          ) : (
            <Table>
              <THead><TR><TH>Milestone</TH><TH>Project</TH><TH>Stage</TH><TH>Status</TH><TH>Latest submission</TH><TH>Due</TH></TR></THead>
              <TBody>
                {data.milestones.map((m) => (
                  <TR key={m.id}>
                    <TD><Link className="font-medium hover:text-link" href={`/milestones?${status ? `status=${status}&` : ""}open=${m.id}`}>{m.title}</Link>{m.isStageGate ? <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-link">GATE</span> : null}</TD>
                    <TD><Link className="hover:text-link" href={`/projects/${m.project.id}`}>{m.project.name}</Link></TD>
                    <TD className="text-xs text-muted-foreground">{STAGE_LABELS[m.stage]}</TD>
                    <TD><StatusBadge status={m.status} /></TD>
                    <TD className="text-xs text-muted-foreground">{m.submissions[0] ? `${m.submissions[0].submittedBy.name} · ${relativeTime(m.submissions[0].submittedAt)}` : "—"}</TD>
                    <TD className="tabular-nums text-xs">{formatDate(m.dueDate)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {gates ? <StageGateEditor requirements={gates.requirements} /> : null}
      {sp.open ? <MilestoneDialog id={sp.open} /> : null}
    </>
  );
}
