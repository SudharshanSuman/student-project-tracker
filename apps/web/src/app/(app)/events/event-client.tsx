"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import { EVENT_TYPES } from "@iic/shared";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { humanize } from "@/lib/utils";
import { useAction } from "@/lib/use-action";

const schema = z.object({
  title: z.string().trim().min(1, "Required").max(200),
  description: z.string().max(5000),
  type: z.enum(EVENT_TYPES),
  location: z.string().max(200),
  startsAt: z.string().min(1, "Required"),
  endsAt: z.string().min(1, "Required"),
  cohortId: z.string(),
}).refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, { message: "End must be after start", path: ["endsAt"] });

export function NewEventDialog({ cohorts }: { cohorts: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const { register, handleSubmit, formState, reset } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", description: "", type: "WORKSHOP", location: "", startsAt: "", endsAt: "", cohortId: "" },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> New event</Button></DialogTrigger>
      <DialogContent title="New event">
        <form noValidate className="grid gap-3" onSubmit={handleSubmit(async (v) => {
          const r = await run(() => api("/events", { body: { ...v, description: v.description || null, location: v.location || null, cohortId: v.cohortId || null, startsAt: new Date(v.startsAt).toISOString(), endsAt: new Date(v.endsAt).toISOString() } }), "Event created");
          if (r !== undefined) { setOpen(false); reset(); }
        })}>
          <Field label="Title" htmlFor="ev-title" error={formState.errors.title?.message}><Input id="ev-title" {...register("title")} /></Field>
          <Field label="Description" htmlFor="ev-desc"><Textarea id="ev-desc" rows={2} {...register("description")} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type" htmlFor="ev-type"><Select id="ev-type" {...register("type")}>{EVENT_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></Field>
            <Field label="Location" htmlFor="ev-loc"><Input id="ev-loc" {...register("location")} /></Field>
            <Field label="Starts" htmlFor="ev-start" error={formState.errors.startsAt?.message}><Input id="ev-start" type="datetime-local" {...register("startsAt")} /></Field>
            <Field label="Ends" htmlFor="ev-end" error={formState.errors.endsAt?.message}><Input id="ev-end" type="datetime-local" {...register("endsAt")} /></Field>
          </div>
          <Field label="Cohort (optional)" htmlFor="ev-cohort"><Select id="ev-cohort" {...register("cohortId")}><option value="">All</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pending}>Create</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteEventButton({ id, title }: { id: string; title: string }) {
  const { run } = useAction();
  return (
    <ConfirmButton variant="ghost" size="icon" destructive title={`Delete ${title}?`} description="Events with attendance records cannot be deleted." confirmLabel="Delete" onConfirm={() => run(() => api(`/events/${id}`, { method: "DELETE" }), "Event deleted")}>
      <Trash2 aria-label="Delete event" />
    </ConfirmButton>
  );
}
