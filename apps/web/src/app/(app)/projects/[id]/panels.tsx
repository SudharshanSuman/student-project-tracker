"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Archive, ArrowRightCircle, Pencil, Plus, RotateCcw, Trash2, UserPlus } from "lucide-react";
import { nextStage, PROJECT_STAGES, PROJECT_STATUSES, STAGE_LABELS, type ProjectStage, type Role } from "@iic/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { humanize } from "@/lib/utils";
import { useAction } from "@/lib/use-action";

interface ProjectLite {
  id: string; name: string; description: string; category: string; repoUrl: string | null; status: string; stage: ProjectStage;
  mentorId: string | null; cohortId: string | null;
}

export function ProjectAdminActions({ project, access, cohorts, mentors, gateApproved }: {
  project: ProjectLite;
  access: { canManage: boolean; canReview: boolean; isAdmin: boolean };
  cohorts: { id: string; name: string }[];
  mentors: { id: string; name: string }[];
  gateApproved: boolean;
}) {
  const { run } = useAction();
  return (
    <>
      {access.canManage && project.status !== "ARCHIVED" ? <EditProject project={project} isAdmin={access.isAdmin} cohorts={cohorts} mentors={mentors} /> : null}
      {access.canReview && project.status !== "ARCHIVED" ? <StageDialog project={project} isAdmin={access.isAdmin} gateApproved={gateApproved} /> : null}
      {access.isAdmin ? (
        project.status === "ARCHIVED" ? (
          <ConfirmButton title="Restore project?" description="The project becomes active and editable again." onConfirm={() => run(() => api(`/projects/${project.id}/restore`, { method: "POST" }), "Project restored")}>
            <RotateCcw /> Restore
          </ConfirmButton>
        ) : (
          <ConfirmButton destructive title="Archive project?" description="Archived projects are read-only and hidden from the directory. Records are kept and it can be restored." confirmLabel="Archive" onConfirm={() => run(() => api(`/projects/${project.id}/archive`, { method: "POST" }), "Project archived")}>
            <Archive /> Archive
          </ConfirmButton>
        )
      ) : null}
    </>
  );
}

function EditProject({ project, isAdmin, cohorts, mentors }: { project: ProjectLite; isAdmin: boolean; cohorts: { id: string; name: string }[]; mentors: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const { register, handleSubmit } = useForm({
    defaultValues: {
      name: project.name, description: project.description, category: project.category, repoUrl: project.repoUrl ?? "",
      status: project.status, mentorId: project.mentorId ?? "", cohortId: project.cohortId ?? "",
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><Pencil /> Edit</Button></DialogTrigger>
      <DialogContent title="Edit project">
        <form
          className="grid gap-3"
          onSubmit={handleSubmit(async (v) => {
            const body: Record<string, unknown> = { name: v.name, description: v.description, category: v.category, repoUrl: v.repoUrl || null };
            if (isAdmin) Object.assign(body, { status: v.status, mentorId: v.mentorId || null, cohortId: v.cohortId || null });
            const ok = await run(() => api(`/projects/${project.id}`, { method: "PATCH", body }), "Project updated");
            if (ok !== undefined) setOpen(false);
          })}
        >
          <Field label="Name" htmlFor="ep-name"><Input id="ep-name" {...register("name", { required: true })} /></Field>
          <Field label="Description" htmlFor="ep-desc"><Textarea id="ep-desc" rows={4} {...register("description", { required: true })} /></Field>
          <Field label="Category" htmlFor="ep-cat"><Input id="ep-cat" {...register("category", { required: true })} /></Field>
          <Field label="Repository URL" htmlFor="ep-repo"><Input id="ep-repo" {...register("repoUrl")} /></Field>
          {isAdmin ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Status" htmlFor="ep-status">
                <Select id="ep-status" {...register("status")}>{PROJECT_STATUSES.filter((s) => s !== "ARCHIVED").map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
              </Field>
              <Field label="Mentor" htmlFor="ep-mentor">
                <Select id="ep-mentor" {...register("mentorId")}><option value="">Unassigned</option>{mentors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
              </Field>
              <Field label="Cohort" htmlFor="ep-cohort">
                <Select id="ep-cohort" {...register("cohortId")}><option value="">None</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
              </Field>
            </div>
          ) : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pending}>Save</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StageDialog({ project, isAdmin, gateApproved }: { project: ProjectLite; isAdmin: boolean; gateApproved: boolean }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const suggested = nextStage(project.stage) ?? project.stage;
  const { register, handleSubmit, watch } = useForm({ defaultValues: { toStage: suggested, reason: "" } });
  const forward = PROJECT_STAGES.indexOf(watch("toStage")) > PROJECT_STAGES.indexOf(project.stage);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><ArrowRightCircle /> Change stage</Button></DialogTrigger>
      <DialogContent title="Change project stage" description="An explicit, audited decision. Task completion never changes the stage automatically.">
        <form
          className="grid gap-3"
          onSubmit={handleSubmit(async (v) => {
            const ok = await run(() => api(`/projects/${project.id}/stage`, { body: v }), "Stage updated");
            if (ok !== undefined) setOpen(false);
          })}
        >
          <Field label={`From ${STAGE_LABELS[project.stage]} to`} htmlFor="st-to">
            <Select id="st-to" {...register("toStage")}>{PROJECT_STAGES.filter((s) => s !== project.stage).map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</Select>
          </Field>
          {forward && !gateApproved ? (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              The {STAGE_LABELS[project.stage]} stage-gate milestone is not approved. {isAdmin ? "As an admin you can override; the reason is recorded." : "Approve the gate first."}
            </p>
          ) : null}
          <Field label="Reason (recorded in the audit trail)" htmlFor="st-reason"><Textarea id="st-reason" rows={3} {...register("reason", { required: true })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pending || (forward && !gateApproved && !isAdmin)}>Confirm stage change</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MembersPanel({ projectId, memberships, canManage, isAdmin }: {
  projectId: string;
  memberships: { id: string; role: "LEAD" | "MEMBER"; user: { id: string; name: string; email: string; role: Role } }[];
  canManage: boolean;
  isAdmin: boolean;
}) {
  const { run } = useAction();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">Team ({memberships.length}) {canManage ? <AddMember projectId={projectId} isAdmin={isAdmin} existing={memberships.map((m) => m.user.id)} /> : null}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {memberships.length === 0 ? <p className="text-xs text-muted-foreground">No members yet.</p> : memberships.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <p className="truncate">{m.user.name} {m.role === "LEAD" ? <span className="ml-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-link">LEAD</span> : null}</p>
              <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>
            </div>
            {canManage && (m.role !== "LEAD" || isAdmin) ? (
              <ConfirmButton variant="ghost" size="icon" destructive title={`Remove ${m.user.name}?`} description="Their open tasks become unassigned. Past records are kept." confirmLabel="Remove" onConfirm={() => run(() => api(`/projects/${projectId}/members/${m.user.id}`, { method: "DELETE" }), "Member removed")}>
                <Trash2 aria-label="Remove member" />
              </ConfirmButton>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AddMember({ projectId, isAdmin, existing }: { projectId: string; isAdmin: boolean; existing: string[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<{ id: string; name: string; email: string; role: Role }[]>([]);
  const [role, setRole] = useState<"MEMBER" | "LEAD">("MEMBER");
  const { run, pending } = useAction();
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api<{ users: { id: string; name: string; email: string; role: Role }[] }>(`/users/lookup?q=${encodeURIComponent(q)}`)
        .then((r) => setUsers(r.users.filter((u) => (u.role === "PROJECT_LEAD" || u.role === "PROJECT_MEMBER") && !existing.includes(u.id))))
        .catch(() => setUsers([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, existing]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><UserPlus /> Add</Button></DialogTrigger>
      <DialogContent title="Add team member" description="Only active students with an account can be added. Invite new people from User management.">
        <Input placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        {isAdmin ? (
          <Select value={role} onChange={(e) => setRole(e.target.value as "MEMBER" | "LEAD")} aria-label="Membership role">
            <option value="MEMBER">Member</option><option value="LEAD">Lead</option>
          </Select>
        ) : null}
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {users.length === 0 ? <li className="text-xs text-muted-foreground">No matching students.</li> : users.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="min-w-0"><span className="block truncate">{u.name}</span><span className="block truncate text-xs text-muted-foreground">{u.email}</span></span>
              <Button size="sm" disabled={pending} onClick={async () => {
                const ok = await run(() => api(`/projects/${projectId}/members`, { body: { userId: u.id, role } }), "Member added");
                if (ok !== undefined) setOpen(false);
              }}><Plus /> Add</Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function MilestoneCreate({ projectId, stage }: { projectId: string; stage: ProjectStage }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const { register, handleSubmit, reset } = useForm({ defaultValues: { title: "", description: "", stage, isStageGate: true, dueDate: "" } });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Plus /> Milestone</Button></DialogTrigger>
      <DialogContent title="New milestone" description="Stage-gate milestones need mentor or admin approval before the project can advance.">
        <form className="grid gap-3" onSubmit={handleSubmit(async (v) => {
          const ok = await run(() => api(`/projects/${projectId}/milestones`, { body: { ...v, dueDate: v.dueDate || null, description: v.description || null } }), "Milestone created");
          if (ok !== undefined) { setOpen(false); reset(); }
        })}>
          <Field label="Title" htmlFor="ms-title"><Input id="ms-title" {...register("title", { required: true })} /></Field>
          <Field label="Description" htmlFor="ms-desc"><Textarea id="ms-desc" rows={3} {...register("description")} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Stage" htmlFor="ms-stage"><Select id="ms-stage" {...register("stage")}>{PROJECT_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</Select></Field>
            <Field label="Due date" htmlFor="ms-due"><Input id="ms-due" type="date" {...register("dueDate")} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" {...register("isStageGate")} /> This is the stage gate for its stage</label>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pending}>Create</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
