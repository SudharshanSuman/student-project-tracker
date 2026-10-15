import { PROJECT_STAGES, type ProjectStage, type TaskStatus } from "./constants";

/**
 * Allowed Kanban transitions. Moving backwards one column is allowed (rework);
 * skipping REVIEW is not. DONE can only be reopened into REVIEW.
 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  TODO: ["IN_PROGRESS"],
  IN_PROGRESS: ["TODO", "REVIEW"],
  REVIEW: ["IN_PROGRESS", "DONE"],
  DONE: ["REVIEW"],
};

export function isTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || TASK_TRANSITIONS[from].includes(to);
}

/** Statuses that require every dependency to be DONE first. */
export function requiresDependenciesDone(to: TaskStatus): boolean {
  return to === "IN_PROGRESS" || to === "REVIEW" || to === "DONE";
}

/**
 * Who may perform a transition. Assignees move their own work up to REVIEW;
 * accepting work into DONE (or reopening DONE) needs the project lead or an admin.
 */
export function transitionNeedsLead(from: TaskStatus, to: TaskStatus): boolean {
  return to === "DONE" || from === "DONE";
}

export function nextStage(stage: ProjectStage): ProjectStage | null {
  const i = PROJECT_STAGES.indexOf(stage);
  return i >= 0 && i < PROJECT_STAGES.length - 1 ? (PROJECT_STAGES[i + 1] ?? null) : null;
}

export function stageIndex(stage: ProjectStage): number {
  return PROJECT_STAGES.indexOf(stage);
}

/** Configurable weights for the Team Engagement Index (a default, not a universal measure). */
export interface EngagementWeights {
  voice: number;
  messages: number;
  tasks: number;
}

export const DEFAULT_ENGAGEMENT_WEIGHTS: EngagementWeights = { voice: 0.5, messages: 0.2, tasks: 0.3 };

/**
 * Each input is a 0..1 normalised score. Returns 0..100.
 * Weights are re-normalised so a misconfigured sum never inflates the score.
 */
export function engagementIndex(
  scores: { voice: number; messages: number; tasks: number },
  weights: EngagementWeights = DEFAULT_ENGAGEMENT_WEIGHTS,
): number {
  const total = weights.voice + weights.messages + weights.tasks;
  if (total <= 0) return 0;
  const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
  const value =
    (weights.voice * clamp(scores.voice) +
      weights.messages * clamp(scores.messages) +
      weights.tasks * clamp(scores.tasks)) /
    total;
  return Math.round(value * 1000) / 10;
}

/** Simple, explainable project health from overdue ratio and recency of activity. */
export type ProjectHealth = "ON_TRACK" | "AT_RISK" | "OFF_TRACK";

export function projectHealth(input: {
  openTasks: number;
  overdueTasks: number;
  daysSinceActivity: number;
}): ProjectHealth {
  const overdueRatio = input.openTasks > 0 ? input.overdueTasks / input.openTasks : 0;
  if (overdueRatio >= 0.4 || input.daysSinceActivity > 21) return "OFF_TRACK";
  if (overdueRatio >= 0.15 || input.daysSinceActivity > 10) return "AT_RISK";
  return "ON_TRACK";
}
