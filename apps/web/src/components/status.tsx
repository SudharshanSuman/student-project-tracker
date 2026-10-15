import { STAGE_LABELS, TASK_STATUS_LABELS, type ProjectStage, type TaskStatus } from "@iic/shared";
import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/utils";

export function StageBadge({ stage }: { stage: ProjectStage }) {
  return <Badge variant="default">{STAGE_LABELS[stage]}</Badge>;
}

export function HealthBadge({ health }: { health?: string | null }) {
  if (!health) return null;
  const variant = health === "ON_TRACK" ? "success" : health === "AT_RISK" ? "warning" : "danger";
  return <Badge variant={variant}>{humanize(health)}</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const variant = status === "DONE" ? "success" : status === "REVIEW" ? "warning" : status === "IN_PROGRESS" ? "default" : "muted";
  return <Badge variant={variant}>{TASK_STATUS_LABELS[status]}</Badge>;
}

const tone: Record<string, "success" | "warning" | "danger" | "default" | "muted"> = {
  APPROVED: "success", VERIFIED: "success", ACTIVE: "success", PRESENT: "success", COMPLETED: "success", WINNER: "success", OPEN: "default",
  SUBMITTED: "warning", PENDING: "warning", ESTIMATED: "warning", CHANGES_REQUESTED: "warning", SCHEDULED: "muted", RUNNING: "default",
  QUEUED: "muted", FINALIST: "default", INVITED: "warning", CORRECTED: "warning", INCOMPLETE: "warning",
  REJECTED: "danger", FAILED: "danger", DISABLED: "danger", REVOKED: "danger", ERROR: "danger", CANCELLED: "danger", ARCHIVED: "muted",
  CLOSED: "muted", NOT_CONFIGURED: "muted", ON_HOLD: "warning",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={tone[status] ?? "muted"}>{humanize(status)}</Badge>;
}
