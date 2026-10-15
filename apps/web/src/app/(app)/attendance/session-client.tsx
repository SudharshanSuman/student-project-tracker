"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Plus } from "lucide-react";
import { ATTENDANCE_ELIGIBILITY, QR_POLICIES } from "@iic/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { humanize } from "@/lib/utils";
import { useAction } from "@/lib/use-action";

const toLocal = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function NewSessionDialog({ events, cohorts, projects }: {
  events: { id: string; title: string; startsAt: string; endsAt: string; location: string | null }[];
  cohorts: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const { register, handleSubmit, watch, setValue, reset } = useForm({
    defaultValues: {
      eventId: "", name: "", description: "", location: "", startsAt: "", endsAt: "", eligibility: "ALL_ACTIVE_USERS",
      cohortId: "", projectId: "", qrPolicy: "ROTATING", qrTtlSeconds: 60, locationCheck: false, latitude: "", longitude: "", radiusMeters: "200",
    },
  });
  const eligibility = watch("eligibility");
  const locationCheck = watch("locationCheck");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> New session</Button></DialogTrigger>
      <DialogContent title="New attendance session" className="max-w-xl">
        <form className="grid gap-3" onSubmit={handleSubmit(async (v) => {
          const body = {
            eventId: v.eventId || null, name: v.name, description: v.description || null, location: v.location || null,
            startsAt: v.startsAt ? new Date(v.startsAt).toISOString() : "", endsAt: v.endsAt ? new Date(v.endsAt).toISOString() : "",
            eligibility: v.eligibility, cohortId: v.cohortId || null, projectId: v.projectId || null,
            qrPolicy: v.qrPolicy, qrTtlSeconds: Number(v.qrTtlSeconds), locationCheck: v.locationCheck,
            latitude: v.locationCheck ? Number(v.latitude) : null, longitude: v.locationCheck ? Number(v.longitude) : null,
            radiusMeters: v.locationCheck ? Number(v.radiusMeters) : null,
          };
          const r = await run(() => api("/attendance/sessions", { body }), "Session created");
          if (r !== undefined) { setOpen(false); reset(); }
        })}>
          <Field label="Linked event (optional)" htmlFor="as-event">
            <Select id="as-event" {...register("eventId", {
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                const ev = events.find((x) => x.id === e.target.value);
                if (ev) {
                  setValue("name", `${ev.title} check-in`);
                  setValue("startsAt", toLocal(ev.startsAt));
                  setValue("endsAt", toLocal(ev.endsAt));
                  setValue("location", ev.location ?? "");
                }
              },
            })}>
              <option value="">None</option>{events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </Select>
          </Field>
          <Field label="Name" htmlFor="as-name"><Input id="as-name" {...register("name", { required: true })} /></Field>
          <Field label="Description" htmlFor="as-desc"><Textarea id="as-desc" rows={2} {...register("description")} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts" htmlFor="as-start"><Input id="as-start" type="datetime-local" {...register("startsAt", { required: true })} /></Field>
            <Field label="Ends" htmlFor="as-end"><Input id="as-end" type="datetime-local" {...register("endsAt", { required: true })} /></Field>
            <Field label="Location" htmlFor="as-loc"><Input id="as-loc" {...register("location")} /></Field>
            <Field label="Eligible participants" htmlFor="as-elig"><Select id="as-elig" {...register("eligibility")}>{ATTENDANCE_ELIGIBILITY.map((e) => <option key={e} value={e}>{humanize(e)}</option>)}</Select></Field>
            {eligibility === "COHORT" ? <Field label="Cohort" htmlFor="as-cohort"><Select id="as-cohort" {...register("cohortId")}><option value="">Choose…</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field> : null}
            {eligibility === "PROJECT" ? <Field label="Project" htmlFor="as-project"><Select id="as-project" {...register("projectId")}><option value="">Choose…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field> : null}
            <Field label="QR policy" htmlFor="as-policy" hint="Rotating: one code shared by the room. Single use: each code works once."><Select id="as-policy" {...register("qrPolicy")}>{QR_POLICIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</Select></Field>
            <Field label="QR lifetime (seconds)" htmlFor="as-ttl"><Input id="as-ttl" type="number" min={15} max={600} {...register("qrTtlSeconds")} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" {...register("locationCheck")} /> Ask for optional location (supporting signal only, never identity proof)</label>
          {locationCheck ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Latitude" htmlFor="as-lat"><Input id="as-lat" inputMode="decimal" {...register("latitude")} /></Field>
              <Field label="Longitude" htmlFor="as-lng"><Input id="as-lng" inputMode="decimal" {...register("longitude")} /></Field>
              <Field label="Radius (m)" htmlFor="as-rad"><Input id="as-rad" type="number" {...register("radiusMeters")} /></Field>
            </div>
          ) : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pending}>Create session</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
