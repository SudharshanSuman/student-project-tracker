# Database

PostgreSQL via Prisma (`apps/api/prisma/schema.prisma`, migrations in `apps/api/prisma/migrations`). All primary keys are UUIDs; every relation declares its delete behaviour.

| Area | Models | Notes |
| --- | --- | --- |
| Identity | User, Session, PasswordResetToken, Invitation | Tokens stored as SHA-256 hashes only. |
| Projects | Cohort, Project, ProjectMembership, ProjectStageHistory | `unique(projectId, userId)`; lead = membership role LEAD. |
| Work | Task, TaskDependency, TaskComment, TaskStatusHistory | `unique(taskId, dependsOnId)`; indexes on (projectId, status), assignee, due date. |
| Stage gates | StageGateRequirement, Milestone, MilestoneSubmission, MilestoneReview | One review per submission (`submissionId` unique). |
| Attendance | Event, AttendanceSession, AttendanceRecord, QrTokenRedemption | `unique(sessionId, userId)`; redeemed single-use token ids. |
| Discord | DiscordIntegration, DiscordChannel, DiscordVoiceSession, DiscordActivityDaily | No message content columns. `externalKey` and `unique(date, channelId, discordUserId)` prevent duplicates. |
| GitHub | GitHubIntegration, RepositoryActivityDaily | `unique(integrationId, date)`. |
| Competitions & money | Competition, CompetitionRegistration, FundingAward, FundingChangeRequest | `Decimal(14,2)` + `Char(3)` ISO currency; verified vs estimated via `verification`. Outcome verification (`outcomeVerifiedById/At`) on registrations. Change requests hold proposed/previous values for admin review. Competitions with registrations cannot be deleted (`Restrict`). |
| Reports | GeneratedReport | Doubles as the job queue: `status`, `attempts`, `nextAttemptAt` (backoff), `startedAt`, `storageKey`, `sizeBytes`, `expiresAt`. |
| Other | Document, Notification, NotificationPreference, AuditLog, InactivityAlert, IntegrationLog, ProcessedExternalEvent, PlatformSetting | Notifications deduplicated by `unique(userId, dedupeKey)`. |

Multi-row changes (e.g. review + milestone status + audit + notifications) run in a single transaction.

Commands: `npm run db:migrate` (dev), `npm run db:deploy` (production), `npm run db:seed` (demo data, refuses in production), `npm run db:reset`.
