"use client";
import { useState } from "react";
import { BadgeCheck, FilePen, Plus, Trash2 } from "lucide-react";
import { FUNDING_SOURCES } from "@iic/shared";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { useAction } from "@/lib/use-action";
import { formatMoney, humanize } from "@/lib/utils";

export interface ProjectOption { id: string; name: string; registrations: { id: string; competition: { name: string } }[] }
export interface Award { id: string; title: string; amount: string; currency: string; source: string; verification: string; canVerify: boolean; changeRequests: { id: string }[] }

const AMOUNT_HINT = "Exact amount as written on the award letter, up to 2 decimals. No currency conversion is applied.";

export function RecordAwardDialog({ projects }: { projects: ProjectOption[] }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ projectId: projects[0]?.id ?? "", registrationId: "", source: "COMPETITION", title: "", amount: "", currency: "INR", awardedAt: "", notes: "" });
  const { run, pending } = useAction();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value, ...(k === "projectId" ? { registrationId: "" } : {}) });
  const regs = projects.find((p) => p.id === v.projectId)?.registrations ?? [];
  if (projects.length === 0) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> Record funding</Button></DialogTrigger>
      <DialogContent title="Record funding" description="New entries are estimates until the project's mentor or an admin verifies them.">
        <form className="grid gap-3" onSubmit={async (e) => {
          e.preventDefault();
          const body = { ...v, registrationId: v.registrationId || null, awardedAt: v.awardedAt || null, notes: v.notes || null };
          const ok = await run(() => api("/funding", { body }), "Funding recorded as an estimate");
          if (ok !== undefined) setOpen(false);
        }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Project" htmlFor="f-project"><Select id="f-project" value={v.projectId} onChange={set("projectId")}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Source" htmlFor="f-source"><Select id="f-source" value={v.source} onChange={set("source")}>{FUNDING_SOURCES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
          </div>
          {regs.length ? (
            <Field label="Competition (optional)" htmlFor="f-reg"><Select id="f-reg" value={v.registrationId} onChange={set("registrationId")}><option value="">None</option>{regs.map((r) => <option key={r.id} value={r.id}>{r.competition.name}</option>)}</Select></Field>
          ) : null}
          <Field label="Title" htmlFor="f-title"><Input id="f-title" required maxLength={200} value={v.title} onChange={set("title")} placeholder="e.g. Smart India Hackathon 1st prize" /></Field>
          <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
            <Field label="Amount" htmlFor="f-amount" hint={AMOUNT_HINT}><Input id="f-amount" required inputMode="decimal" pattern="^\d{1,12}(\.\d{1,2})?$" value={v.amount} onChange={set("amount")} placeholder="100000.00" /></Field>
            <Field label="Currency" htmlFor="f-cur"><Input id="f-cur" required maxLength={3} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} /></Field>
          </div>
          <Field label="Awarded on" htmlFor="f-date"><Input id="f-date" type="date" value={v.awardedAt} onChange={set("awardedAt")} /></Field>
          <Field label="Notes" htmlFor="f-notes"><Textarea id="f-notes" rows={2} value={v.notes} onChange={set("notes")} /></Field>
          <div className="flex justify-end"><Button disabled={pending}>Record</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VerifyDialog({ a }: { a: Award }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { run, pending } = useAction();
  const decide = async (decision: "VERIFIED" | "REJECTED") => {
    const ok = await run(() => api(`/funding/${a.id}/verify`, { body: { decision, note } }), decision === "VERIFIED" ? "Funding verified" : "Funding rejected");
    if (ok !== undefined) setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><BadgeCheck /> Review</Button></DialogTrigger>
      <DialogContent title={`Review ${a.title}`} description={`${formatMoney(a.amount, a.currency)} · ${humanize(a.source)}. Verify only against a sanction letter, transfer record or official announcement.`}>
        <Field label="Evidence note (required)" htmlFor="fv-note"><Textarea id="fv-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sanction letter ref. IIC/2026/014" /></Field>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" disabled={pending || !note.trim()} onClick={() => decide("REJECTED")}>Reject</Button>
          <Button disabled={pending || !note.trim()} onClick={() => decide("VERIFIED")}>Verify</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChangeRequestDialog({ a }: { a: Award }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ amount: a.amount, currency: a.currency, reason: "" });
  const { run, pending } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost"><FilePen /> Request change</Button></DialogTrigger>
      <DialogContent title="Request a change to a verified award" description="An admin other than you reviews the change. The verified figures stay in place until then.">
        <form className="grid gap-3" onSubmit={async (e) => {
          e.preventDefault();
          const body = { reason: v.reason, ...(v.amount !== a.amount ? { amount: v.amount } : {}), ...(v.currency !== a.currency ? { currency: v.currency } : {}) };
          const ok = await run(() => api(`/funding/${a.id}/change-requests`, { body }), "Change requested");
          if (ok !== undefined) setOpen(false);
        }}>
          <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
            <Field label="Amount" htmlFor="cr-amount"><Input id="cr-amount" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
            <Field label="Currency" htmlFor="cr-cur"><Input id="cr-cur" maxLength={3} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} /></Field>
          </div>
          <Field label="Reason (required)" htmlFor="cr-reason"><Textarea id="cr-reason" rows={3} required value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
          <div className="flex justify-end"><Button disabled={pending || !v.reason.trim()}>Submit request</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AwardActions({ a }: { a: Award }) {
  const { run } = useAction();
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {a.canVerify ? <VerifyDialog a={a} /> : null}
      {a.verification === "VERIFIED" ? (a.changeRequests.length ? <span className="text-[11px] text-warning">change pending</span> : <ChangeRequestDialog a={a} />) : (
        <ConfirmButton title="Delete this entry?" description="Only unverified entries can be deleted. This is recorded in the audit log." confirmLabel="Delete" destructive variant="ghost"
          onConfirm={async () => { await run(() => api(`/funding/${a.id}`, { method: "DELETE" }), "Entry deleted"); }}><Trash2 /></ConfirmButton>
      )}
    </div>
  );
}

export function ReviewChange({ id, canReview }: { id: string; canReview: boolean }) {
  const [note, setNote] = useState("");
  const { run, pending } = useAction();
  if (!canReview) return <span className="text-xs text-muted-foreground">Your request: another admin reviews it</span>;
  const decide = (decision: "APPROVED" | "REJECTED") => run(() => api(`/funding/change-requests/${id}/review`, { body: { decision, note } }), `Change ${decision.toLowerCase()}`);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input className="h-8 w-56 text-xs" placeholder="Review note (required)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Review note" />
      <Button size="sm" variant="outline" disabled={pending || !note.trim()} onClick={() => decide("REJECTED")}>Reject</Button>
      <Button size="sm" disabled={pending || !note.trim()} onClick={() => decide("APPROVED")}>Approve</Button>
    </div>
  );
}
