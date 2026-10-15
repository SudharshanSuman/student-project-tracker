"use client";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, X } from "lucide-react";
import { TASK_PRIORITIES, TASK_STATUS_LABELS, TASK_TRANSITIONS, type TaskPriority, type TaskStatus } from "@iic/shared";
import { TaskStatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field, Skeleton } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/utils";
import { useAction } from "@/lib/use-action";
import type { BoardTask } from "./board";

type Member = { id: string; name: string };
type MilestoneOpt = { id: string; title: string };

const taskForm = z.object({
  title: z.string().trim().min(1, "Required").max(200),
  description: z.string().max(5000),
  priority: z.enum(TASK_PRIORITIES),
  assigneeId: z.string(),
  milestoneId: z.string(),
  startDate: z.string(),
  dueDate: z.string(),
  dependsOn: z.array(z.string()),
}).refine((v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate, { message: "Due date must be after start", path: ["dueDate"] });
type TaskForm = z.infer<typeof taskForm>;

export function NewTaskDialog({ projectId, members, milestones, tasks }: { projectId: string; members: Member[]; milestones: MilestoneOpt[]; tasks: BoardTask[] }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const { register, handleSubmit, formState, reset } = useForm<TaskForm>({
    resolver: zodResolver(taskForm),
    defaultValues: { title: "", description: "", priority: "MEDIUM", assigneeId: "", milestoneId: "", startDate: "", dueDate: "", dependsOn: [] },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus /> New task</Button></DialogTrigger>
      <DialogContent title="New task">
        <form noValidate className="grid gap-3" onSubmit={handleSubmit(async (v) => {
          const ok = await run(() => api(`/projects/${projectId}/tasks`, {
            body: {
              ...v,
              description: v.description || null,
              assigneeId: v.assigneeId || null,
              milestoneId: v.milestoneId || null,
              startDate: v.startDate || null,
              dueDate: v.dueDate || null,
            },
          }), "Task created");
          if (ok !== undefined) { setOpen(false); reset(); }
        })}>
          <Field label="Title" htmlFor="nt-title" error={formState.errors.title?.message}><Input id="nt-title" {...register("title")} /></Field>
          <Field label="Description" htmlFor="nt-desc"><Textarea id="nt-desc" rows={3} {...register("description")} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Priority" htmlFor="nt-pri"><Select id="nt-pri" {...register("priority")}>{TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}</Select></Field>
            <Field label="Assignee" htmlFor="nt-asg"><Select id="nt-asg" {...register("assigneeId")}><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
            <Field label="Start" htmlFor="nt-start"><Input id="nt-start" type="date" {...register("startDate")} /></Field>
            <Field label="Due" htmlFor="nt-due" error={formState.errors.dueDate?.message}><Input id="nt-due" type="date" {...register("dueDate")} /></Field>
          </div>
          <Field label="Milestone" htmlFor="nt-ms"><Select id="nt-ms" {...register("milestoneId")}><option value="">None</option>{milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</Select></Field>
          {tasks.length ? (
            <Field label="Depends on (must be done first)" htmlFor="nt-deps">
              <Select id="nt-deps" multiple size={Math.min(5, tasks.length)} className="h-auto" {...register("dependsOn")}>
                {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </Select>
            </Field>
          ) : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pending}>Create task</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface TaskDetail extends BoardTask {
  createdBy: { name: string };
  dependents: { task: { id: string; title: string; status: TaskStatus } }[];
  comments: { id: string; body: string; createdAt: string; author: { id: string; name: string } }[];
  statusHistory: { id: string; fromStatus: TaskStatus | null; toStatus: TaskStatus; changedAt: string; changedBy: { name: string } }[];
  attachments: { id: string; originalName: string; sizeBytes: number }[];
}

export function TaskDialog({ taskId, onClose, members, milestones, projectTasks, canManage, userId }: {
  taskId: string; onClose: () => void; members: Member[]; milestones: MilestoneOpt[]; projectTasks: BoardTask[]; canManage: boolean; userId: string;
}) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [comment, setComment] = useState("");
  const [depId, setDepId] = useState("");
  const { run, pending } = useAction();

  const load = useCallback(() => {
    api<{ task: TaskDetail }>(`/tasks/${taskId}`).then((r) => setTask(r.task)).catch(() => setFailed(true));
  }, [taskId]);
  useEffect(load, [load]);

  const mutate = async (fn: () => Promise<unknown>, msg: string) => {
    const r = await run(fn, msg);
    load();
    return r;
  };
  const isAssignee = task?.assignee?.id === userId;
  const canMove = canManage || isAssignee;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={task?.title ?? "Task"} className="max-w-2xl">
        {failed ? <p className="text-sm text-muted-foreground">This task could not be loaded. It may have been deleted.</p> : !task ? (
          <div className="space-y-2"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-20" /></div>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <TaskStatusBadge status={task.status} />
              <span>Created by {task.createdBy.name}</span>
              {task.dueDate ? <span>· due {formatDate(task.dueDate)}</span> : null}
              {task.completedAt ? <span>· completed {formatDate(task.completedAt)}</span> : null}
            </div>
            {task.description ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p> : null}

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Status" htmlFor="td-status">
                <Select id="td-status" value={task.status} disabled={!canMove || pending} onChange={(e) => mutate(() => api(`/tasks/${task.id}/move`, { body: { status: e.target.value } }), "Status updated")}>
                  <option value={task.status}>{TASK_STATUS_LABELS[task.status]}</option>
                  {TASK_TRANSITIONS[task.status].map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
                </Select>
              </Field>
              <Field label="Assignee" htmlFor="td-asg">
                <Select id="td-asg" value={task.assignee?.id ?? ""} disabled={!canManage || pending} onChange={(e) => mutate(() => api(`/tasks/${task.id}`, { method: "PATCH", body: { assigneeId: e.target.value || null } }), "Assignee updated")}>
                  <option value="">Unassigned</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </Field>
              <Field label="Priority" htmlFor="td-pri">
                <Select id="td-pri" value={task.priority} disabled={!canManage || pending} onChange={(e) => mutate(() => api(`/tasks/${task.id}`, { method: "PATCH", body: { priority: e.target.value as TaskPriority } }), "Priority updated")}>
                  {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}
                </Select>
              </Field>
              <Field label="Due date" htmlFor="td-due">
                <Input id="td-due" type="date" disabled={!canManage || pending} defaultValue={task.dueDate?.slice(0, 10) ?? ""} onBlur={(e) => {
                  const v = e.target.value;
                  if (v !== (task.dueDate?.slice(0, 10) ?? "")) void mutate(() => api(`/tasks/${task.id}`, { method: "PATCH", body: { dueDate: v || null } }), "Due date updated");
                }} />
              </Field>
              <Field label="Milestone" htmlFor="td-ms">
                <Select id="td-ms" value={task.milestone?.id ?? ""} disabled={!canManage || pending} onChange={(e) => mutate(() => api(`/tasks/${task.id}`, { method: "PATCH", body: { milestoneId: e.target.value || null } }), "Milestone updated")}>
                  <option value="">None</option>
                  {milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                </Select>
              </Field>
            </div>

            <section>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Depends on</h3>
              {task.dependencies.length === 0 ? <p className="text-xs text-muted-foreground">No dependencies.</p> : (
                <ul className="space-y-1">
                  {task.dependencies.map((d) => (
                    <li key={d.dependsOn.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{d.dependsOn.title}</span>
                      <span className="flex items-center gap-1"><TaskStatusBadge status={d.dependsOn.status} />
                        {canManage ? <Button variant="ghost" size="icon" aria-label="Remove dependency" onClick={() => mutate(() => api(`/tasks/${task.id}/dependencies/${d.dependsOn.id}`, { method: "DELETE" }), "Dependency removed")}><X /></Button> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {canManage ? (
                <div className="mt-2 flex gap-2">
                  <Select aria-label="Add dependency" value={depId} onChange={(e) => setDepId(e.target.value)} className="h-8 text-xs">
                    <option value="">Add a dependency…</option>
                    {projectTasks.filter((t) => t.id !== task.id && !task.dependencies.some((d) => d.dependsOn.id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </Select>
                  <Button size="sm" variant="outline" disabled={!depId || pending} onClick={async () => { await mutate(() => api(`/tasks/${task.id}/dependencies`, { body: { dependsOnId: depId } }), "Dependency added"); setDepId(""); }}>Add</Button>
                </div>
              ) : null}
              {task.dependents.length ? <p className="mt-2 text-xs text-muted-foreground">Blocks: {task.dependents.map((d) => d.task.title).join(", ")}</p> : null}
            </section>

            {task.attachments.length ? (
              <section>
                <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Attachments</h3>
                <ul className="space-y-1 text-sm">
                  {task.attachments.map((a) => <li key={a.id}><a className="text-primary hover:underline" href={`/api/documents/${a.id}/download`}>{a.originalName}</a> <span className="text-xs text-muted-foreground">· {Math.max(1, Math.round(a.sizeBytes / 1024))} KB</span></li>)}
                </ul>
              </section>
            ) : null}

            <section>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Comments</h3>
              <ul className="max-h-48 space-y-2 overflow-y-auto">
                {task.comments.length === 0 ? <li className="text-xs text-muted-foreground">No comments yet.</li> : task.comments.map((c) => (
                  <li key={c.id} className="rounded-md border px-3 py-2 text-sm">
                    <p className="whitespace-pre-wrap">{c.body}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{c.author.name} · {formatDateTime(c.createdAt)}</p>
                  </li>
                ))}
              </ul>
              <form className="mt-2 flex gap-2" onSubmit={async (e) => {
                e.preventDefault();
                if (!comment.trim()) return;
                await mutate(() => api(`/tasks/${task.id}/comments`, { body: { body: comment } }), "Comment added");
                setComment("");
              }}>
                <Input aria-label="Add a comment" placeholder="Add a comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} />
                <Button size="sm" disabled={pending || !comment.trim()}>Post</Button>
              </form>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Status history</h3>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {task.statusHistory.map((h) => (
                  <li key={h.id}>{h.fromStatus ? `${TASK_STATUS_LABELS[h.fromStatus]} → ` : ""}{TASK_STATUS_LABELS[h.toStatus]} · {h.changedBy.name} · {formatDateTime(h.changedAt)}</li>
                ))}
              </ul>
            </section>

            {canManage ? (
              <div className="flex justify-end border-t pt-3">
                <ConfirmButton destructive title="Delete task?" description="Comments, history and dependency links for this task are removed. This is recorded in the audit log." confirmLabel="Delete" onConfirm={async () => { await run(() => api(`/tasks/${task.id}`, { method: "DELETE" }), "Task deleted"); onClose(); }}>
                  <Trash2 /> Delete task
                </ConfirmButton>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
