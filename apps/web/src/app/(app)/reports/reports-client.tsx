"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Download, FilePlus2, RotateCw, Trash2 } from "lucide-react";
import { REPORT_TYPE_LABELS, REPORT_TYPES, type ReportType } from "@iic/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { useAction } from "@/lib/use-action";

const DESCRIPTIONS: Record<ReportType, string> = {
  PROJECT: "One project: team, stages, tasks, milestones, attendance, competitions, funding, risks.",
  COHORT: "All projects in a cohort with comparative progress and compliance.",
  TERM: "Everything that happened across projects in a period.",
  ATTENDANCE_COMPLIANCE: "Sessions, verified check-ins and participants below the threshold.",
  MILESTONE_PROGRESSION: "Milestone status by stage, reviews and stage changes.",
  COMPETITION_OUTCOMES: "Registrations and verified results.",
  FUNDING: "Verified vs estimated funding per currency and source.",
  DISCORD_ENGAGEMENT: "Pending the Discord integration; renders an explicit placeholder.",
  EXECUTIVE_SUMMARY: "Headline metrics for IIC leadership (admins only).",
};

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function GenerateReport({ projects, cohorts, isAdmin }: { projects: { id: string; name: string }[]; cohorts: { id: string; name: string; term: string }[]; isAdmin: boolean }) {
  const now = new Date();
  const [type, setType] = useState<ReportType>("PROJECT");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [cohortId, setCohortId] = useState("");
  const [periodStart, setStart] = useState(iso(new Date(now.getFullYear(), now.getMonth() - 5, 1)));
  const [periodEnd, setEnd] = useState(iso(now));
  const { run, pending } = useAction();
  const types = REPORT_TYPES.filter((t) => isAdmin || t !== "EXECUTIVE_SUMMARY");
  const needsPeriod = type !== "PROJECT" && type !== "COHORT";
  return (
    <Card className="mb-4">
      <CardHeader><CardTitle className="flex items-center gap-2"><FilePlus2 className="h-4 w-4 text-primary" /> Generate a report</CardTitle></CardHeader>
      <CardContent>
        <form className="grid gap-3 md:grid-cols-[220px_1fr_1fr_auto] md:items-end" onSubmit={async (e) => {
          e.preventDefault();
          await run(() => api("/reports", { body: {
            type,
            projectId: type === "PROJECT" ? projectId : null,
            cohortId: type === "COHORT" ? cohortId : type === "PROJECT" ? null : cohortId || null,
            periodStart: needsPeriod ? periodStart : null,
            periodEnd: needsPeriod ? periodEnd : null,
          } }), "Report queued; it will appear below when ready");
        }}>
          <Field label="Report" htmlFor="rp-type"><Select id="rp-type" value={type} onChange={(e) => setType(e.target.value as ReportType)}>{types.map((t) => <option key={t} value={t}>{REPORT_TYPE_LABELS[t]}</option>)}</Select></Field>
          {type === "PROJECT" ? (
            <Field label="Project" htmlFor="rp-project"><Select id="rp-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          ) : (
            <Field label={type === "COHORT" ? "Cohort" : "Cohort (optional)"} htmlFor="rp-cohort">
              <Select id="rp-cohort" value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
                <option value="">{type === "COHORT" ? "Choose…" : "All cohorts in scope"}</option>
                {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.term})</option>)}
              </Select>
            </Field>
          )}
          {needsPeriod ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="From" htmlFor="rp-from"><Input id="rp-from" type="date" value={periodStart} max={periodEnd} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field label="To" htmlFor="rp-to"><Input id="rp-to" type="date" value={periodEnd} min={periodStart} onChange={(e) => setEnd(e.target.value)} /></Field>
            </div>
          ) : <p className="pb-2 text-xs text-muted-foreground">Covers all records to date.</p>}
          <Button disabled={pending || (type === "PROJECT" && !projectId) || (type === "COHORT" && !cohortId)}>Generate PDF</Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">{DESCRIPTIONS[type]} Figures come only from platform records; empty periods say so.</p>
      </CardContent>
    </Card>
  );
}

/** Re-renders the list while any report is still queued or running. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

export function ReportActions({ id, status, downloadable }: { id: string; status: string; downloadable: boolean }) {
  const { run, pending } = useAction();
  return (
    <div className="flex justify-end gap-1">
      {downloadable ? <Button asChild size="sm" variant="outline"><a href={`/api/reports/${id}/download`}><Download /> PDF</a></Button> : null}
      {status === "FAILED" ? <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => api(`/reports/${id}/retry`, { method: "POST" }), "Report re-queued")}><RotateCw /> Retry</Button> : null}
      {status !== "RUNNING" ? (
        <ConfirmButton title="Delete report?" description="The PDF file is removed from storage." confirmLabel="Delete" destructive variant="ghost"
          onConfirm={async () => { await run(() => api(`/reports/${id}`, { method: "DELETE" }), "Report deleted"); }}><Trash2 /></ConfirmButton>
      ) : null}
    </div>
  );
}
