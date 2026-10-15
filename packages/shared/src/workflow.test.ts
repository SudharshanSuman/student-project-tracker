import { describe, expect, it } from "vitest";
import { engagementIndex, isTransitionAllowed, nextStage, projectHealth, transitionNeedsLead } from "./workflow";

describe("workflow rules", () => {
  it("transition graph", () => {
    expect(isTransitionAllowed("TODO", "IN_PROGRESS")).toBe(true);
    expect(isTransitionAllowed("TODO", "DONE")).toBe(false);
    expect(isTransitionAllowed("DONE", "TODO")).toBe(false);
    expect(transitionNeedsLead("REVIEW", "DONE")).toBe(true);
    expect(transitionNeedsLead("IN_PROGRESS", "REVIEW")).toBe(false);
  });
  it("stage order", () => {
    expect(nextStage("IDEATION")).toBe("POC");
    expect(nextStage("PRE_INCUBATION")).toBeNull();
  });
  it("engagement index is weighted, clamped and renormalised", () => {
    expect(engagementIndex({ voice: 1, messages: 1, tasks: 1 })).toBe(100);
    expect(engagementIndex({ voice: 1, messages: 0, tasks: 0 })).toBe(50);
    expect(engagementIndex({ voice: 2, messages: -1, tasks: Number.NaN })).toBe(50);
    expect(engagementIndex({ voice: 1, messages: 0, tasks: 0 }, { voice: 1, messages: 1, tasks: 0 })).toBe(50);
    expect(engagementIndex({ voice: 1, messages: 1, tasks: 1 }, { voice: 0, messages: 0, tasks: 0 })).toBe(0);
  });
  it("project health", () => {
    expect(projectHealth({ openTasks: 10, overdueTasks: 0, daysSinceActivity: 1 })).toBe("ON_TRACK");
    expect(projectHealth({ openTasks: 10, overdueTasks: 2, daysSinceActivity: 1 })).toBe("AT_RISK");
    expect(projectHealth({ openTasks: 10, overdueTasks: 5, daysSinceActivity: 1 })).toBe("OFF_TRACK");
    expect(projectHealth({ openTasks: 0, overdueTasks: 0, daysSinceActivity: 30 })).toBe("OFF_TRACK");
  });
});
