import { describe, expect, it } from "vitest";
import { EventType, MilestoneStatus, ProjectStage, ProjectStatus, QrPolicy, ReportType, Role, TaskPriority, TaskStatus } from "@prisma/client";
import * as shared from "@iic/shared";

describe("shared enum mirrors", () => {
  it("match the Prisma schema", () => {
    expect(Object.values(Role)).toEqual([...shared.ROLES]);
    expect(Object.values(ProjectStage)).toEqual([...shared.PROJECT_STAGES]);
    expect(Object.values(ProjectStatus)).toEqual([...shared.PROJECT_STATUSES]);
    expect(Object.values(TaskStatus)).toEqual([...shared.TASK_STATUSES]);
    expect(Object.values(TaskPriority)).toEqual([...shared.TASK_PRIORITIES]);
    expect(Object.values(MilestoneStatus)).toEqual([...shared.MILESTONE_STATUSES]);
    expect(Object.values(EventType)).toEqual([...shared.EVENT_TYPES]);
    expect(Object.values(QrPolicy)).toEqual([...shared.QR_POLICIES]);
    expect(Object.values(ReportType)).toEqual([...shared.REPORT_TYPES]);
  });
});
