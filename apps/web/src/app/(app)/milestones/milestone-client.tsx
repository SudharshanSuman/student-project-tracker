"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { CheckCircle2, ExternalLink, Plus, XCircle } from "lucide-react";
import { PROJECT_STAGES, STAGE_LABELS, type ProjectStage } from "@iic/shared";
import { StatusBadge, TaskStatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field, Skeleton } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils";
import { useAction } from "@/lib/use-action";

interface Detail {
  milestone: {
    id: string; title: string; description: string | null; stage: ProjectStage; status: string; isStageGate: boolean; dueDate: string | null;
    project: { id: string; name: string };
    tasks: { id: string; title: string; status: "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE" }[];
    submissions: {
      id: string; notes: string; evidenceUrl: string | null; status: string; submittedAt: string; submittedBy: { id: string; name: string };
      review: { decision: string; comment: string; reviewedAt: string; reviewer: { name: string } } | null;
    }[];
  };
  requirements: { id: string; title: string; description: string | null }[];
  access: { canReview: boolean; canSubmit: boolean };
}

export function MilestoneDialog({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const { run, pending } = useAction();
  const load = useCallback(() => { api<Detail>(`/milestones/${id}`).then(setData).catch(() => setFailed(true)); }, [id]);
  useEffect(load, [load]);
  const close = () => {
    const n = new URLSearchParams(params.toString());
    n.delete("open");
    router.replace(`${pathname}${n.size ? `?${n}` : ""}`);
  };
  const submitForm = useForm({ defaultValues: { notes: "", evidenceUrl: "" } });
  const reviewForm = useForm({ defaultValues: { comment: "" } });

  const m = data?.milestone;
  const canSubmit = data?.access.canSubmit && (m?.status === "OPEN" || m?.status === "CHANGES_REQUESTED");
  const canReview = data?.access.canReview && m?.status === "SUBMITTED";

  async function review(decision: "APPROVED" | "REJECTED") {
    const ok = await reviewForm.trigger("comment");
    if (!ok) return;
    const r = await run(() => api(`/milestones/${id}/review`, { body: { decision, comment: reviewForm.getValues("comment") } }), decision === "APPROVED" ? "Milestone approved" : "Changes requested");
    if (r !== undefined) { reviewForm.reset(); load(); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent title={m?.title ?? "Milestone"} description={m ? `${m.project.name} · ${STAGE_LABELS[m.stage]}${m.isStageGate ? " stage gate" : ""}` : undefined} className="max-w-2xl">
        {failed ? <p className="text-sm text-muted-foreground">Milestone not found or not accessible.</p> : !m ? <Skeleton className="h-40" /> : (
          <div className="grid gap-4">
            <div className="flex items-center gap-2"><StatusBadge status={m.status} />{m.description ? <span className="text-sm text-muted-foreground">{m.description}</span> : null}</div>
            {data.requirements.length ? (
              <section>
                <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Stage-gate checklist ({STAGE_LABELS[m.stage]})</h3>
                <ul className="list-disc space-y-0.5 pl-5 text-sm">{data.requirements.map((r) => <li key={r.id}>{r.title}</li>)}</ul>
              </section>
            ) : null}
            {m.tasks.length ? (
              <section>
                <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Linked tasks (context only — completion does not approve the gate)</h3>
                <ul className="space-y-1 text-sm">{m.tasks.map((t) => <li key={t.id} className="flex justify-between"><span>{t.title}</span><TaskStatusBadge status={t.status} /></li>)}</ul>
              </section>
            ) : null}
            <section>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Submissions & decisions</h3>
              {m.submissions.length === 0 ? <p className="text-xs text-muted-foreground">No evidence submitted yet.</p> : (
                <ol className="space-y-2">
                  {m.submissions.map((s) => (
                    <li key={s.id} className="rounded-md border p-3 text-sm">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{s.submittedBy.name} · {formatDateTime(s.submittedAt)}</span><StatusBadge status={s.status} /></div>
                      <p className="mt-1 whitespace-pre-wrap">{s.notes}</p>
                      {s.evidenceUrl ? <a href={s.evidenceUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-xs text-link">Evidence <ExternalLink className="h-3 w-3" /></a> : null}
                      {s.review ? (
                        <div className="mt-2 border-t pt-2 text-xs">
                          <span className={s.review.decision === "APPROVED" ? "text-success" : "text-destructive"}>{s.review.decision === "APPROVED" ? "Approved" : "Rejected"}</span> by {s.review.reviewer.name} · {formatDateTime(s.review.reviewedAt)}
                          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{s.review.comment}</p>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>
            {canSubmit ? (
              <form className="grid gap-2 border-t pt-3" onSubmit={submitForm.handleSubmit(async (v) => {
                const r = await run(() => api(`/milestones/${id}/submit`, { body: { notes: v.notes, evidenceUrl: v.evidenceUrl || null } }), "Evidence submitted for review");
                if (r !== undefined) { submitForm.reset(); load(); }
              })}>
                <h3 className="text-xs font-semibold text-muted-foreground">Submit evidence</h3>
                <Field label="What was achieved, against the checklist" htmlFor="sub-notes" error={submitForm.formState.errors.notes ? "Required" : undefined}>
                  <Textarea id="sub-notes" rows={4} {...submitForm.register("notes", { required: true, maxLength: 5000 })} />
                </Field>
                <Field label="Evidence link (optional)" htmlFor="sub-url"><Input id="sub-url" type="url" placeholder="https://…" {...submitForm.register("evidenceUrl")} /></Field>
                <div className="flex justify-end"><Button disabled={pending}>Submit for review</Button></div>
              </form>
            ) : null}
            {canReview ? (
              <div className="grid gap-2 border-t pt-3">
                <h3 className="text-xs font-semibold text-muted-foreground">Your decision</h3>
                <Field label="Comment / reason (recorded)" htmlFor="rev-comment" error={reviewForm.formState.errors.comment ? "A reason is required" : undefined}>
                  <Textarea id="rev-comment" rows={3} {...reviewForm.register("comment", { required: true, maxLength: 5000 })} />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" disabled={pending} onClick={() => review("REJECTED")}><XCircle /> Request changes</Button>
                  <Button disabled={pending} onClick={() => review("APPROVED")}><CheckCircle2 /> Approve</Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function StageGateEditor({ requirements }: { requirements: { id: string; stage: ProjectStage; title: string; isActive: boolean; sortOrder: number }[] }) {
  const { run, pending } = useAction();
  const { register, handleSubmit, reset } = useForm({ defaultValues: { stage: "IDEATION" as ProjectStage, title: "" } });
  return (
    <Card className="mt-6">
      <CardHeader><CardTitle>Stage-gate requirements (admin)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PROJECT_STAGES.map((stage) => (
            <div key={stage}>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">{STAGE_LABELS[stage]}</h3>
              <ul className="space-y-1">
                {requirements.filter((r) => r.stage === stage).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className={r.isActive ? "" : "text-muted-foreground line-through"}>{r.title}</span>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => api(`/stage-gates/${r.id}`, { method: "PATCH", body: { isActive: !r.isActive } }), r.isActive ? "Requirement disabled" : "Requirement enabled")}>
                      {r.isActive ? "Disable" : "Enable"}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <form className="flex flex-wrap items-end gap-2 border-t pt-3" onSubmit={handleSubmit(async (v) => {
          const r = await run(() => api("/stage-gates", { body: { stage: v.stage, title: v.title, sortOrder: requirements.filter((x) => x.stage === v.stage).length } }), "Requirement added");
          if (r !== undefined) reset({ stage: v.stage, title: "" });
        })}>
          <Field label="Stage" htmlFor="sg-stage"><Select id="sg-stage" {...register("stage")}>{PROJECT_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</Select></Field>
          <div className="min-w-[240px] flex-1"><Field label="Requirement" htmlFor="sg-title"><Input id="sg-title" {...register("title", { required: true })} /></Field></div>
          <Button disabled={pending}><Plus /> Add</Button>
        </form>
      </CardContent>
    </Card>
  );
}
