"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BadgeCheck, Plus, Trash2 } from "lucide-react";
import { COMPETITION_OUTCOMES, COMPETITION_REGISTRATION_STATUSES } from "@iic/shared";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, Field } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { useAction } from "@/lib/use-action";
import { formatDate, humanize } from "@/lib/utils";

export interface Registration {
  id: string; status: string; outcome: string; outcomeVerifiedAt: string | null; outcomeEvidenceUrl: string | null;
  submissionRepoUrl: string | null; demoUrl: string | null; pitchDeckUrl: string | null; mentorNotes: string | null;
  outcomeVerifiedBy: { name: string } | null;
  project: { id: string; name: string; cohort: { name: string } | null };
  canManage: boolean; canVerify: boolean;
}

export function DeleteCompetition({ id, disabled }: { id: string; disabled: boolean }) {
  const router = useRouter();
  const { run } = useAction();
  if (disabled) return <Button variant="outline" size="sm" disabled title="Competitions with registrations are kept for history"><Trash2 /> Delete</Button>;
  return (
    <ConfirmButton title="Delete competition?" description="This removes the competition from the directory." confirmLabel="Delete" destructive onConfirm={async () => {
      await run(() => api(`/competitions/${id}`, { method: "DELETE" }), "Competition deleted");
      router.push("/competitions");
    }}><Trash2 /> Delete</ConfirmButton>
  );
}

function RegisterDialog({ competitionId, projects }: { competitionId: string; projects: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [status, setStatus] = useState("REGISTERED");
  const { run, pending } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus /> Register a project</Button></DialogTrigger>
      <DialogContent title="Register a project">
        <form className="grid gap-3" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => api(`/competitions/${competitionId}/registrations`, { body: { projectId, status } }), "Project registered");
          if (ok !== undefined) setOpen(false);
        }}>
          <Field label="Project" htmlFor="r-project"><Select id="r-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Status" htmlFor="r-status"><Select id="r-status" value={status} onChange={(e) => setStatus(e.target.value)}>{COMPETITION_REGISTRATION_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
          <div className="flex justify-end"><Button disabled={pending || !projectId}>Register</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditRegistration({ r }: { r: Registration }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    status: r.status, outcome: r.outcome, outcomeEvidenceUrl: r.outcomeEvidenceUrl ?? "", submissionRepoUrl: r.submissionRepoUrl ?? "",
    demoUrl: r.demoUrl ?? "", pitchDeckUrl: r.pitchDeckUrl ?? "", mentorNotes: r.mentorNotes ?? "",
  });
  const { run, pending } = useAction();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const locked = !!r.outcomeVerifiedAt && !r.canVerify;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm">Update</Button></DialogTrigger>
      <DialogContent title={`Update ${r.project.name}`} description="Results stay unverified until the assigned mentor or an admin confirms them.">
        <form className="grid gap-3" onSubmit={async (e) => {
          e.preventDefault();
          const { mentorNotes, outcome, ...rest } = v;
          const body = { ...rest, ...(locked ? {} : { outcome }), ...(r.canVerify ? { mentorNotes } : {}) };
          const ok = await run(() => api(`/competition-registrations/${r.id}`, { method: "PATCH", body }), "Registration updated");
          if (ok !== undefined) setOpen(false);
        }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status" htmlFor="u-status"><Select id="u-status" value={v.status} onChange={set("status")}>{COMPETITION_REGISTRATION_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
            <Field label="Outcome" htmlFor="u-outcome" hint={locked ? "Verified: ask your mentor to change it" : undefined}>
              <Select id="u-outcome" value={v.outcome} onChange={set("outcome")} disabled={locked}>{COMPETITION_OUTCOMES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
            </Field>
          </div>
          <Field label="Result evidence URL (certificate, announcement)" htmlFor="u-evidence"><Input id="u-evidence" type="url" value={v.outcomeEvidenceUrl} onChange={set("outcomeEvidenceUrl")} /></Field>
          <Field label="Submission repository" htmlFor="u-repo"><Input id="u-repo" type="url" value={v.submissionRepoUrl} onChange={set("submissionRepoUrl")} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Demo URL" htmlFor="u-demo"><Input id="u-demo" type="url" value={v.demoUrl} onChange={set("demoUrl")} /></Field>
            <Field label="Pitch deck URL" htmlFor="u-deck"><Input id="u-deck" type="url" value={v.pitchDeckUrl} onChange={set("pitchDeckUrl")} /></Field>
          </div>
          {r.canVerify ? <Field label="Mentor notes (staff and lead only)" htmlFor="u-notes"><Textarea id="u-notes" rows={3} value={v.mentorNotes} onChange={set("mentorNotes")} /></Field> : null}
          <div className="flex justify-end"><Button disabled={pending}>Save</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VerifyOutcome({ r }: { r: Registration }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { run, pending } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><BadgeCheck /> Verify</Button></DialogTrigger>
      <DialogContent title={`Verify: ${humanize(r.outcome)}`} description="Confirm you have seen evidence of this result (certificate, official list). Your name is recorded.">
        <form className="grid gap-3" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => api(`/competition-registrations/${r.id}/verify-outcome`, { body: { note } }), "Outcome verified");
          if (ok !== undefined) setOpen(false);
        }}>
          {r.outcomeEvidenceUrl ? <a className="text-xs text-link hover:underline" href={r.outcomeEvidenceUrl} target="_blank" rel="noopener noreferrer">Open submitted evidence</a> : <p className="text-xs text-muted-foreground">No evidence link was submitted.</p>}
          <Field label="Verification note" htmlFor="v-note"><Textarea id="v-note" rows={3} required value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Checked the official results page" /></Field>
          <div className="flex justify-end"><Button disabled={pending || !note.trim()}>Verify outcome</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Registrations({ competitionId, registrations, registrable }: { competitionId: string; registrations: Registration[]; registrable: { id: string; name: string }[] }) {
  const { run } = useAction();
  return (
    <Card className="h-fit">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Your projects&apos; registrations</CardTitle>
        {registrable.length ? <RegisterDialog competitionId={competitionId} projects={registrable} /> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {registrations.length === 0 ? <EmptyState title="No registrations from your projects" description={registrable.length ? "Register a project to track its submission and result." : undefined} /> : registrations.map((r) => (
          <div key={r.id} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{r.project.name}</p>
                <p className="text-xs text-muted-foreground">{r.project.cohort?.name ?? "No cohort"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={r.status} />
                {r.outcome !== "PENDING" ? <StatusBadge status={r.outcome} /> : null}
                {r.outcome !== "PENDING" ? (r.outcomeVerifiedAt ? <span className="text-[11px] bg-success px-1 text-foreground">verified by {r.outcomeVerifiedBy?.name} · {formatDate(r.outcomeVerifiedAt)}</span> : <span className="text-[11px] bg-warning px-1 text-foreground">unverified claim</span>) : null}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {[["Repo", r.submissionRepoUrl], ["Demo", r.demoUrl], ["Pitch deck", r.pitchDeckUrl]].map(([l, u]) => u ? <a key={l} href={u} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">{l}</a> : null)}
            </div>
            {r.mentorNotes ? <p className="mt-2 rounded bg-muted px-2 py-1 text-xs"><span className="font-medium">Mentor notes:</span> {r.mentorNotes}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {r.canManage || r.canVerify ? <EditRegistration r={r} /> : null}
              {r.canVerify && r.outcome !== "PENDING" && !r.outcomeVerifiedAt ? <VerifyOutcome r={r} /> : null}
              {r.canManage && !r.outcomeVerifiedAt ? (
                <ConfirmButton title="Remove registration?" description="The registration and its unverified result are removed." confirmLabel="Remove" destructive variant="ghost"
                  onConfirm={async () => { await run(() => api(`/competition-registrations/${r.id}`, { method: "DELETE" }), "Registration removed"); }}><Trash2 /> Remove</ConfirmButton>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
