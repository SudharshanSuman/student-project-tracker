// Enum values mirrored from the Prisma schema so the web app never imports Prisma.
// apps/api/test/shared-enums.test.ts asserts these stay identical to the Prisma enums.

export const ROLES = ["ADMIN", "MENTOR", "PROJECT_LEAD", "PROJECT_MEMBER"] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ["INVITED", "ACTIVE", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const MEMBERSHIP_ROLES = ["LEAD", "MEMBER"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const PROJECT_STAGES = ["IDEATION", "POC", "MVP", "MARKET_TESTING", "PRE_INCUBATION"] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_STATUSES = ["ACTIVE", "ON_HOLD", "ARCHIVED", "GRADUATED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const MILESTONE_STATUSES = ["OPEN", "SUBMITTED", "APPROVED", "CHANGES_REQUESTED"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const EVENT_TYPES = ["WORKSHOP", "MENTORING", "MEETUP", "DEMO_DAY", "HACKATHON", "OTHER"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ATTENDANCE_ELIGIBILITY = ["ALL_ACTIVE_USERS", "COHORT", "PROJECT"] as const;
export type AttendanceEligibility = (typeof ATTENDANCE_ELIGIBILITY)[number];

export const QR_POLICIES = ["ROTATING", "SINGLE_USE"] as const;
export type QrPolicy = (typeof QR_POLICIES)[number];

export const ATTENDANCE_SESSION_STATUSES = ["SCHEDULED", "OPEN", "CLOSED", "CANCELLED"] as const;
export type AttendanceSessionStatus = (typeof ATTENDANCE_SESSION_STATUSES)[number];

export const COMPETITION_OUTCOMES = ["PENDING", "PARTICIPANT", "FINALIST", "WINNER"] as const;
export type CompetitionOutcome = (typeof COMPETITION_OUTCOMES)[number];

export const REPORT_TYPES = [
  "PROJECT",
  "COHORT",
  "TERM",
  "ATTENDANCE_COMPLIANCE",
  "MILESTONE_PROGRESSION",
  "COMPETITION_OUTCOMES",
  "FUNDING",
  "DISCORD_ENGAGEMENT",
  "EXECUTIVE_SUMMARY",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  MENTOR: "Mentor",
  PROJECT_LEAD: "Project lead",
  PROJECT_MEMBER: "Project member",
};

export const STAGE_LABELS: Record<ProjectStage, string> = {
  IDEATION: "Ideation",
  POC: "Proof of Concept",
  MVP: "MVP",
  MARKET_TESTING: "Market Testing",
  PRE_INCUBATION: "Pre-Incubation Launch",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  REVIEW: "Review",
  DONE: "Done",
};

/** Default stage-gate checklist used to seed StageGateRequirement (admins can edit). */
export const DEFAULT_STAGE_GATES: Record<ProjectStage, string[]> = {
  IDEATION: [
    "Problem statement validated with at least 5 potential users",
    "Target customer segment defined",
    "Initial solution hypothesis documented",
  ],
  POC: [
    "Technical feasibility demonstrated",
    "Core risk assumptions tested",
    "Proof-of-concept demo recorded or presented",
  ],
  MVP: [
    "Minimum viable product usable by real users",
    "Feedback collected from pilot users",
    "Repository and documentation linked",
  ],
  MARKET_TESTING: [
    "Pricing or value hypothesis tested",
    "Early traction metrics recorded",
    "Go-to-market plan reviewed by mentor",
  ],
  PRE_INCUBATION: [
    "Pitch deck finalised",
    "Business model canvas complete",
    "Incubation application readiness reviewed",
  ],
};

export const COMPETITION_REGISTRATION_STATUSES = ["INTERESTED", "REGISTERED", "SUBMITTED", "WITHDRAWN"] as const;
export const FUNDING_SOURCES = ["COMPETITION", "GRANT", "SPONSOR", "INSTITUTIONAL", "OTHER"] as const;
export const FUNDING_VERIFICATIONS = ["ESTIMATED", "VERIFIED", "REJECTED"] as const;

/** Leaderboard points per verified outcome. */
export const OUTCOME_POINTS: Record<CompetitionOutcome, number> = { PENDING: 0, PARTICIPANT: 1, FINALIST: 3, WINNER: 5 };

/** Report types that are scoped to one project / one cohort; the rest are period reports. */
export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  PROJECT: "Project report",
  COHORT: "Cohort report",
  TERM: "Term report",
  ATTENDANCE_COMPLIANCE: "Attendance compliance",
  MILESTONE_PROGRESSION: "Milestone progression",
  COMPETITION_OUTCOMES: "Competition outcomes",
  FUNDING: "Funding report",
  DISCORD_ENGAGEMENT: "Discord engagement",
  EXECUTIVE_SUMMARY: "Executive summary",
};
