import { z } from "zod";
import {
  ATTENDANCE_ELIGIBILITY,
  COMPETITION_OUTCOMES,
  COMPETITION_REGISTRATION_STATUSES,
  FUNDING_SOURCES,
  REPORT_TYPES,
  EVENT_TYPES,
  MEMBERSHIP_ROLES,
  PROJECT_STAGES,
  PROJECT_STATUSES,
  QR_POLICIES,
  ROLES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  USER_STATUSES,
} from "./constants";
import { AMOUNT_RE, isIsoCurrency, normalizeAmount } from "./money";

// Shared request schemas: used by React Hook Form on the client and re-validated
// by the API on the server. Never trust the client copy alone.

const trimmed = (max: number) => z.string().trim().min(1, "Required").max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .url("Must be a valid URL")
  .refine((v) => /^https?:\/\//i.test(v), "Only http(s) URLs are allowed")
  .optional()
  .nullable()
  .or(z.literal("").transform(() => null));
const isoDate = z.coerce.date();
const optionalDate = z
  .union([z.coerce.date(), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v instanceof Date ? v : null));
const uuid = z.string().uuid();

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email").max(254);

export const passwordSchema = z
  .string()
  .min(10, "At least 10 characters")
  .max(128)
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[0-9]/, "Include a number");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Required").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  name: trimmed(120),
  password: passwordSchema,
  department: optionalText(120),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: z.enum(ROLES),
  cohortId: uuid.optional().nullable(),
  projectId: uuid.optional().nullable(),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const updateUserSchema = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
});

export const updateProfileSchema = z.object({
  name: trimmed(120),
  bio: optionalText(1000),
  phone: optionalText(40),
  department: optionalText(120),
  githubUsername: z
    .string()
    .trim()
    .max(39)
    .regex(/^[A-Za-z0-9-]*$/, "Letters, numbers and dashes only")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

// ── Projects ──
export const createProjectSchema = z.object({
  name: trimmed(120),
  description: trimmed(5000),
  category: trimmed(80),
  stage: z.enum(PROJECT_STAGES).default("IDEATION"),
  cohortId: uuid.optional().nullable(),
  mentorId: uuid.optional().nullable(),
  leadId: uuid.optional().nullable(),
  repoUrl: optionalUrl,
  logoUrl: optionalUrl,
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: trimmed(120).optional(),
  description: trimmed(5000).optional(),
  category: trimmed(80).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  cohortId: uuid.optional().nullable(),
  mentorId: uuid.optional().nullable(),
  repoUrl: optionalUrl,
  logoUrl: optionalUrl,
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const projectListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  stage: z.enum(PROJECT_STAGES).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  cohortId: uuid.optional(),
  mentorId: uuid.optional(),
  sort: z.enum(["name", "createdAt", "lastActivityAt", "stage"]).default("lastActivityAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
});

export const addMemberSchema = z.object({
  userId: uuid,
  role: z.enum(MEMBERSHIP_ROLES).default("MEMBER"),
});

export const changeStageSchema = z.object({
  toStage: z.enum(PROJECT_STAGES),
  reason: trimmed(1000),
});

export const createCohortSchema = z.object({
  name: trimmed(80),
  term: trimmed(40),
  startDate: optionalDate,
  endDate: optionalDate,
});

// ── Tasks ──
export const createTaskSchema = z.object({
  title: trimmed(200),
  description: optionalText(5000),
  priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
  assigneeId: uuid.optional().nullable(),
  milestoneId: uuid.optional().nullable(),
  startDate: optionalDate,
  dueDate: optionalDate,
  dependsOn: z.array(uuid).max(20).default([]),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: trimmed(200).optional(),
  description: optionalText(5000),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeId: uuid.optional().nullable(),
  milestoneId: uuid.optional().nullable(),
  startDate: optionalDate,
  dueDate: optionalDate,
});

export const moveTaskSchema = z.object({
  status: z.enum(TASK_STATUSES),
  position: z.number().finite().optional(),
});

export const taskDependencySchema = z.object({ dependsOnId: uuid });

export const taskCommentSchema = z.object({ body: trimmed(4000) });

// ── Milestones ──
export const createMilestoneSchema = z.object({
  title: trimmed(200),
  description: optionalText(5000),
  stage: z.enum(PROJECT_STAGES),
  isStageGate: z.boolean().default(false),
  dueDate: optionalDate,
});

export const submitMilestoneSchema = z.object({
  notes: trimmed(5000),
  evidenceUrl: optionalUrl,
});

export const reviewMilestoneSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: trimmed(5000),
});

export const stageGateRequirementSchema = z.object({
  stage: z.enum(PROJECT_STAGES),
  title: trimmed(200),
  description: optionalText(1000),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

// ── Events & attendance ──
export const createEventSchema = z
  .object({
    title: trimmed(200),
    description: optionalText(5000),
    type: z.enum(EVENT_TYPES).default("WORKSHOP"),
    location: optionalText(200),
    startsAt: isoDate,
    endsAt: isoDate,
    cohortId: uuid.optional().nullable(),
  })
  .refine((v) => v.endsAt > v.startsAt, { message: "End must be after start", path: ["endsAt"] });

export const createAttendanceSessionSchema = z
  .object({
    eventId: uuid.optional().nullable(),
    name: trimmed(200),
    description: optionalText(2000),
    location: optionalText(200),
    startsAt: isoDate,
    endsAt: isoDate,
    eligibility: z.enum(ATTENDANCE_ELIGIBILITY).default("ALL_ACTIVE_USERS"),
    cohortId: uuid.optional().nullable(),
    projectId: uuid.optional().nullable(),
    qrPolicy: z.enum(QR_POLICIES).default("ROTATING"),
    qrTtlSeconds: z.number().int().min(15).max(600).default(60),
    locationCheck: z.boolean().default(false),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    radiusMeters: z.number().int().min(10).max(5000).optional().nullable(),
  })
  .refine((v) => v.endsAt > v.startsAt, { message: "End must be after start", path: ["endsAt"] })
  .refine((v) => v.eligibility !== "COHORT" || !!v.cohortId, {
    message: "Pick a cohort",
    path: ["cohortId"],
  })
  .refine((v) => v.eligibility !== "PROJECT" || !!v.projectId, {
    message: "Pick a project",
    path: ["projectId"],
  })
  .refine((v) => !v.locationCheck || (v.latitude != null && v.longitude != null && v.radiusMeters != null), {
    message: "Location check needs latitude, longitude and radius",
    path: ["locationCheck"],
  });

export const checkInSchema = z.object({
  token: z.string().min(20).max(1000),
  /** Optional, only sent when the user explicitly grants location permission. */
  location: z
    .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
    .optional(),
});

export const manualAttendanceSchema = z.object({
  userId: uuid,
  reason: trimmed(500),
});

export const correctAttendanceSchema = z.object({
  status: z.enum(["PRESENT", "REVOKED"]),
  reason: trimmed(500),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ── Competitions ──
export const competitionSchema = z
  .object({
    name: trimmed(200),
    organizer: trimmed(200),
    description: optionalText(5000),
    registrationUrl: optionalUrl,
    eligibility: optionalText(2000),
    startDate: optionalDate,
    endDate: optionalDate,
    submissionDeadline: optionalDate,
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { message: "End must be on or after start", path: ["endDate"] });
export const updateCompetitionSchema = competitionSchema.innerType().partial();

export const competitionListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  when: z.enum(["upcoming", "past", "all"]).default("all"),
  outcome: z.enum(COMPETITION_OUTCOMES).optional(),
  projectId: uuid.optional(),
});

export const registrationSchema = z.object({
  projectId: uuid,
  status: z.enum(COMPETITION_REGISTRATION_STATUSES).default("REGISTERED"),
  submissionRepoUrl: optionalUrl,
  demoUrl: optionalUrl,
  pitchDeckUrl: optionalUrl,
});

export const updateRegistrationSchema = z.object({
  status: z.enum(COMPETITION_REGISTRATION_STATUSES).optional(),
  outcome: z.enum(COMPETITION_OUTCOMES).optional(),
  outcomeEvidenceUrl: optionalUrl,
  submissionRepoUrl: optionalUrl,
  demoUrl: optionalUrl,
  pitchDeckUrl: optionalUrl,
  mentorNotes: optionalText(5000).optional(),
});

export const verifyOutcomeSchema = z.object({ note: trimmed(1000) });

export const leaderboardQuerySchema = z.object({
  cohortId: uuid.optional(),
  from: optionalDate,
  to: optionalDate,
  includeUnverified: z.enum(["true", "false"]).optional(),
});

// ── Funding ──
/** Decimal string, max Decimal(14,2), strictly positive. Numbers are rejected to avoid float rounding. */
export const amountSchema = z
  .string()
  .trim()
  .regex(AMOUNT_RE, "Enter an amount with up to 2 decimals")
  .refine((v) => /[1-9]/.test(v), "Amount must be greater than zero")
  .transform(normalizeAmount);
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(3, "Use a 3-letter ISO currency code")
  .refine(isIsoCurrency, "Unknown ISO 4217 currency code");

export const fundingAwardSchema = z.object({
  projectId: uuid,
  registrationId: uuid.optional().nullable(),
  source: z.enum(FUNDING_SOURCES),
  title: trimmed(200),
  amount: amountSchema,
  currency: currencySchema,
  awardedAt: optionalDate.optional(),
  notes: optionalText(2000).optional(),
});

export const updateFundingAwardSchema = z.object({
  title: trimmed(200).optional(),
  notes: optionalText(2000).optional(),
  source: z.enum(FUNDING_SOURCES).optional(),
  amount: amountSchema.optional(),
  currency: currencySchema.optional(),
  awardedAt: optionalDate.optional(),
  registrationId: uuid.optional().nullable(),
});

export const verifyFundingSchema = z.object({
  decision: z.enum(["VERIFIED", "REJECTED"]),
  note: trimmed(2000),
});

export const fundingChangeRequestSchema = z
  .object({
    amount: amountSchema.optional(),
    currency: currencySchema.optional(),
    source: z.enum(FUNDING_SOURCES).optional(),
    awardedAt: z.coerce.date().optional(),
    reason: trimmed(2000),
  })
  .refine((v) => v.amount !== undefined || v.currency !== undefined || v.source !== undefined || v.awardedAt !== undefined, {
    message: "Propose at least one change",
    path: ["amount"],
  });

export const reviewChangeRequestSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: trimmed(2000),
});

// ── Reports ──
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const createReportSchema = z
  .object({
    type: z.enum(REPORT_TYPES),
    projectId: uuid.optional().nullable(),
    cohortId: uuid.optional().nullable(),
    periodStart: ymd.optional().nullable(),
    periodEnd: ymd.optional().nullable(),
  })
  .refine((v) => v.type !== "PROJECT" || !!v.projectId, { message: "Pick a project", path: ["projectId"] })
  .refine((v) => v.type !== "COHORT" || !!v.cohortId, { message: "Pick a cohort", path: ["cohortId"] })
  .refine((v) => v.type === "PROJECT" || v.type === "COHORT" || (!!v.periodStart && !!v.periodEnd), {
    message: "Pick a reporting period",
    path: ["periodStart"],
  })
  .refine((v) => !v.periodStart || !v.periodEnd || v.periodEnd >= v.periodStart, { message: "End must be on or after start", path: ["periodEnd"] })
  .refine(
    (v) => !v.periodStart || !v.periodEnd || Date.parse(v.periodEnd) - Date.parse(v.periodStart) <= 3 * 366 * 86400_000,
    { message: "Period can be at most 3 years", path: ["periodEnd"] },
  );
