"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { CalendarClock, Link2, Lock, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { isTransitionAllowed, TASK_STATUS_LABELS, TASK_STATUSES, type TaskPriority, type TaskStatus } from "@iic/shared";
import { Badge } from "@/components/ui/badge";
import { api, errorMessage } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import { NewTaskDialog, TaskDialog } from "./task-dialogs";

export interface BoardTask {
  id: string; title: string; description: string | null; status: TaskStatus; priority: TaskPriority; position: number;
  startDate: string | null; dueDate: string | null; completedAt: string | null;
  assignee: { id: string; name: string } | null; milestone: { id: string; title: string } | null;
  dependencies: { dependsOn: { id: string; title: string; status: TaskStatus } }[];
  _count: { comments: number; attachments: number };
}

export interface BoardData {
  project: { id: string; name: string; status: string };
  tasks: BoardTask[];
  members: { id: string; name: string; membershipRole: "LEAD" | "MEMBER" }[];
  milestones: { id: string; title: string; status: string }[];
  access: { canManage: boolean; userId: string };
}

const PRIORITY_TONE: Record<TaskPriority, "muted" | "default" | "warning" | "danger"> = { LOW: "muted", MEDIUM: "default", HIGH: "warning", URGENT: "danger" };

function Card({ task, onOpen, draggable }: { task: BoardTask; onOpen: () => void; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled: !draggable });
  const blocked = task.dependencies.some((d) => d.dependsOn.status !== "DONE");
  const overdue = task.dueDate && task.status !== "DONE" && new Date(task.dueDate) < new Date();
  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cn("rounded-md border bg-background p-3 text-sm", isDragging && "z-10 opacity-80 ring-2 ring-primary", draggable && "cursor-grab")}
      {...attributes}
      {...listeners}
    >
      <button type="button" className="block w-full text-left font-medium hover:text-link" onClick={onOpen} onPointerDown={(e) => e.stopPropagation()}>
        {task.title}
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant={PRIORITY_TONE[task.priority]}>{task.priority.toLowerCase()}</Badge>
        {blocked ? <Badge variant="warning"><Lock className="h-3 w-3" /> blocked</Badge> : null}
        {task.milestone ? <Badge variant="muted" title={task.milestone.title}>milestone</Badge> : null}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="truncate">{task.assignee?.name ?? "Unassigned"}</span>
        <span className="flex items-center gap-2">
          {task.dependencies.length ? <span className="flex items-center gap-0.5"><Link2 className="h-3 w-3" />{task.dependencies.length}</span> : null}
          {task._count.comments ? <span className="flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{task._count.comments}</span> : null}
          {task.dueDate ? <span className={cn("flex items-center gap-0.5 tabular-nums", overdue && "text-destructive")}><CalendarClock className="h-3 w-3" />{formatDate(task.dueDate)}</span> : null}
        </span>
      </div>
    </div>
  );
}

function Column({ status, children, count, dropAllowed }: { status: TaskStatus; children: React.ReactNode; count: number; dropAllowed: boolean | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${TASK_STATUS_LABELS[status]} column`}
      className={cn(
        "flex min-h-[300px] flex-col gap-2 rounded-lg border bg-muted p-3 transition-colors",
        isOver && dropAllowed && "border-primary/60 bg-primary/5",
        isOver && dropAllowed === false && "border-destructive/60",
      )}
    >
      <h2 className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {TASK_STATUS_LABELS[status]} <span className="tabular-nums">{count}</span>
      </h2>
      {children}
    </section>
  );
}

export function Board({ data, openTaskId }: { data: BoardData; openTaskId?: string }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(data.tasks);
  const [openId, setOpenId] = useState<string | undefined>(openTaskId);
  const [dragging, setDragging] = useState<BoardTask | null>(null);
  useEffect(() => setTasks(data.tasks), [data.tasks]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const readOnly = data.project.status === "ARCHIVED";

  const columns = useMemo(() => {
    const by: Record<TaskStatus, BoardTask[]> = { TODO: [], IN_PROGRESS: [], REVIEW: [], DONE: [] };
    for (const t of [...tasks].sort((a, b) => a.position - b.position)) by[t.status].push(t);
    return by;
  }, [tasks]);

  const canDrag = (t: BoardTask) => !readOnly && (data.access.canManage || t.assignee?.id === data.access.userId);

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const task = tasks.find((t) => t.id === e.active.id);
    const to = e.over?.id as TaskStatus | undefined;
    if (!task || !to || to === task.status) return;
    if (!isTransitionAllowed(task.status, to)) {
      toast.error(`Tasks move ${TASK_STATUS_LABELS[task.status]} → ${TASK_STATUS_LABELS[to]} only through the workflow (To do → In progress → Review → Done).`);
      return;
    }
    const position = (columns[to].at(-1)?.position ?? 0) + 1000;
    const previous = tasks;
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, status: to, position } : t)));
    try {
      await api(`/tasks/${task.id}/move`, { body: { status: to, position } });
      router.refresh();
    } catch (err) {
      setTasks(previous);
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{data.project.name} · {tasks.length} tasks{readOnly ? " · archived (read-only)" : ""}</p>
        {data.access.canManage && !readOnly ? <NewTaskDialog projectId={data.project.id} members={data.members} milestones={data.milestones} tasks={tasks} /> : null}
      </div>
      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No tasks yet.{data.access.canManage ? " Create the first one with “New task”." : " Your project lead will add tasks here."}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={(e) => setDragging(tasks.find((t) => t.id === e.active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {TASK_STATUSES.map((status) => (
              <Column key={status} status={status} count={columns[status].length} dropAllowed={dragging ? isTransitionAllowed(dragging.status, status) : null}>
                {columns[status].map((t) => (
                  <Card key={t.id} task={t} draggable={canDrag(t)} onOpen={() => setOpenId(t.id)} />
                ))}
              </Column>
            ))}
          </div>
        </DndContext>
      )}
      {openId ? (
        <TaskDialog
          taskId={openId}
          onClose={() => setOpenId(undefined)}
          members={data.members}
          milestones={data.milestones}
          projectTasks={tasks}
          canManage={data.access.canManage && !readOnly}
          userId={data.access.userId}
        />
      ) : null}
      <p className="mt-4 text-[11px] text-muted-foreground">
        Keyboard: focus a card, press Space to pick it up, arrow keys to move, Space to drop. You can also change status from the task dialog.
      </p>
    </>
  );
}
