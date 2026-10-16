"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/states";
import { api, errorMessage } from "@/lib/api-client";

export interface CompetitionValues {
  id?: string;
  name: string; organizer: string; description: string | null; registrationUrl: string | null; eligibility: string | null;
  startDate: string | null; endDate: string | null; submissionDeadline: string | null;
}

const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : "");

/** Create (no `initial`) or edit a competition. Staff only; the API enforces it. */
export function CompetitionForm({ initial }: { initial?: CompetitionValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({
    name: initial?.name ?? "", organizer: initial?.organizer ?? "", description: initial?.description ?? "", registrationUrl: initial?.registrationUrl ?? "",
    eligibility: initial?.eligibility ?? "", startDate: day(initial?.startDate), endDate: day(initial?.endDate), submissionDeadline: day(initial?.submissionDeadline),
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...v, startDate: v.startDate || null, endDate: v.endDate || null, submissionDeadline: v.submissionDeadline || null };
      const res = await api<{ competition: { id: string } }>(initial?.id ? `/competitions/${initial.id}` : "/competitions", { method: initial?.id ? "PATCH" : "POST", body });
      toast.success(initial?.id ? "Competition updated" : "Competition added");
      setOpen(false);
      if (initial?.id) router.refresh();
      else router.push(`/competitions/${res.competition.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {initial ? <Button variant="outline" size="sm"><Pencil /> Edit</Button> : <Button><Plus /> Add competition</Button>}
      </DialogTrigger>
      <DialogContent title={initial ? "Edit competition" : "Add competition"} description="Record only details published by the organizer.">
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="c-name"><Input id="c-name" required maxLength={200} value={v.name} onChange={set("name")} /></Field>
            <Field label="Organizer" htmlFor="c-org"><Input id="c-org" required maxLength={200} value={v.organizer} onChange={set("organizer")} /></Field>
          </div>
          <Field label="Description" htmlFor="c-desc"><Textarea id="c-desc" rows={3} value={v.description} onChange={set("description")} /></Field>
          <Field label="Registration URL" htmlFor="c-url"><Input id="c-url" type="url" placeholder="https://" value={v.registrationUrl} onChange={set("registrationUrl")} /></Field>
          <Field label="Eligibility" htmlFor="c-elig"><Textarea id="c-elig" rows={2} value={v.eligibility} onChange={set("eligibility")} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Starts" htmlFor="c-start"><Input id="c-start" type="date" value={v.startDate} onChange={set("startDate")} /></Field>
            <Field label="Ends" htmlFor="c-end"><Input id="c-end" type="date" value={v.endDate} onChange={set("endDate")} /></Field>
            <Field label="Submission deadline" htmlFor="c-dl"><Input id="c-dl" type="date" value={v.submissionDeadline} onChange={set("submissionDeadline")} /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
