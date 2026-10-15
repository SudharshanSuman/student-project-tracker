"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { PROJECT_STAGES, STAGE_LABELS } from "@iic/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/states";
import { api, errorMessage } from "@/lib/api-client";

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  description: z.string().trim().min(1, "Required").max(5000),
  category: z.string().trim().min(1, "Required").max(80),
  stage: z.enum(PROJECT_STAGES),
  cohortId: z.string(),
  mentorId: z.string(),
  leadId: z.string(),
  repoUrl: z.string().trim().url("Must be a valid URL").or(z.literal("")),
});
type Values = z.infer<typeof schema>;

export function NewProjectDialog({ isAdmin, cohorts, mentors, leads }: {
  isAdmin: boolean;
  cohorts: { id: string; name: string }[];
  mentors: { id: string; name: string }[];
  leads: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, formState, reset } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { stage: "IDEATION", cohortId: "", mentorId: "", leadId: "", repoUrl: "" },
  });
  async function onSubmit(v: Values) {
    try {
      const { project } = await api<{ project: { id: string } }>("/projects", {
        body: { ...v, cohortId: v.cohortId || null, mentorId: v.mentorId || null, leadId: v.leadId || null, repoUrl: v.repoUrl || null },
      });
      toast.success("Project created");
      setOpen(false);
      reset();
      router.push(`/projects/${project.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus /> New project</Button>
      </DialogTrigger>
      <DialogContent title="New project" description={isAdmin ? "Create a project and assign its lead and mentor." : "You will be the project lead. An admin assigns the mentor."}>
        <form noValidate onSubmit={handleSubmit(onSubmit)} className="grid gap-3">
          <Field label="Name" htmlFor="np-name" error={formState.errors.name?.message}><Input id="np-name" {...register("name")} /></Field>
          <Field label="Description" htmlFor="np-desc" error={formState.errors.description?.message}><Textarea id="np-desc" rows={3} {...register("description")} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category" htmlFor="np-cat" error={formState.errors.category?.message}><Input id="np-cat" placeholder="e.g. HealthTech" {...register("category")} /></Field>
            <Field label="Stage" htmlFor="np-stage">
              <Select id="np-stage" {...register("stage")}>{PROJECT_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</Select>
            </Field>
            <Field label="Cohort" htmlFor="np-cohort">
              <Select id="np-cohort" {...register("cohortId")}><option value="">None</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            </Field>
            {isAdmin ? (
              <>
                <Field label="Mentor" htmlFor="np-mentor">
                  <Select id="np-mentor" {...register("mentorId")}><option value="">Unassigned</option>{mentors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
                </Field>
                <Field label="Project lead" htmlFor="np-lead">
                  <Select id="np-lead" {...register("leadId")}><option value="">None yet</option>{leads.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
                </Field>
              </>
            ) : null}
          </div>
          <Field label="Repository URL (optional)" htmlFor="np-repo" error={formState.errors.repoUrl?.message}><Input id="np-repo" placeholder="https://github.com/org/repo" {...register("repoUrl")} /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={formState.isSubmitting}>{formState.isSubmitting ? "Creating…" : "Create project"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
