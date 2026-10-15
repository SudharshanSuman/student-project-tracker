# Master Build Spec — University Innovation Incubation Cell (IIC) Management Platform

Primary model: Claude Opus 5.5. Target environment: Munder Difflin hive.
Full requirements as given by the human (verbatim, condensed headings only — see sections below for complete detail). This file is the durable reference; dispatch messages point here instead of re-pasting it.

## 0. Environment facts (checked by god, 2026-10-15)
- Project dir `/home/sudharshan-s/Documents/Student Project Tracker` has **no application code and no git repo** — completely greenfield. Only hive/ orchestration metadata lives here.
- Runtime available: Node v20.20.2, npm 10.8.2, Python 3.12.3.
- **No `psql`, no `docker` CLI on this machine.** Do not assume a local Postgres server or Docker daemon is reachable. Write the Docker Compose files per spec anyway (for environments that do have Docker), but for local dev or if Docker is unavailable, make Postgres connectable via `DATABASE_URL` and document how to point it at any reachable Postgres (including a free-tier hosted one), or fall back to a documented SQLite dev path behind the same Prisma schema if no Postgres is reachable at all. Don't block implementation on this — document the blocker per Rule 17 and keep building.
- No existing auth/db/deployment services were found to reuse. Build from scratch per the required stack.

## 1. Product vision
Unified platform for university innovation cells: startup/project portfolio management, agile task/milestone tracking, academic stage-gate approvals, QR-based event attendance, Discord voice telemetry, privacy-preserving engagement analytics, hackathon/competition management, grant/funding records, GitHub integration, automated institutional PDF reporting, RBAC, executive analytics dashboards. Real data persistence, real auth, real workflows. No mock functionality for core features.

## 2. Required stack (use unless the environment imposes a documented constraint)
- Frontend: Next.js (App Router), React, TypeScript, Tailwind CSS, shadcn/ui, Recharts, React Hook Form + Zod, Lucide icons.
- Backend: Node.js + TypeScript, Express REST API, WebSockets, Zod validation, JWT auth where appropriate.
- Database: PostgreSQL, Prisma ORM, UUID PKs, migrations, explicit FKs/constraints.
- Background processing: Redis, BullMQ, dedicated workers.
- External integrations: Discord API (discord.js), GitHub API, webhooks.
- PDF: Puppeteer/headless Chromium, reusable browser pool, HTML templates, print CSS.
- Testing: Vitest or Jest, React Testing Library, Playwright E2E.
- Infra: Docker + Docker Compose, env-based config, structured logging, health checks, production build scripts.

Inspect before changing anything. Preserve existing working code (none exists yet, so this is a from-scratch build). Never overwrite blindly.

## 3. Roles & permissions
ADMIN (full platform control, user/cohort/stage/event config, mentor assignment, platform analytics, overrides, integrations, reports, audit logs) · MENTOR (view assigned projects, review progress/deliverables, approve/reject stage-gates, view attendance/engagement analytics, review competition submissions) · PROJECT LEAD (manage own project, create/assign tasks, deliverables, competition registration, repo links, milestone requests, team analytics) · PROJECT MEMBER (view assigned projects, update own tasks, submit deliverables, attendance, view permitted analytics).
Enforce authorization server-side, never frontend-only. No cross-project/record leakage.

## 4. Auth & onboarding
Secure login/logout, session mgmt, password reset, institutional email validation, profile mgmt, role-based onboarding, membership mgmt, Discord account linking, GitHub linking. Admin-controlled invitations. Users must never self-grant admin. Validate client + server. Guard against unauthorized access, session abuse, privilege escalation.

## 5. Executive dashboard
Dark developer-oriented design. Metrics (ALL from real DB queries, never hardcoded): active projects, registered students, active mentors, projects by stage, task completion rate, overdue tasks, pending milestone approvals, verified attendance hours, Discord participation, hackathons entered, competition wins, total prize/grant funding, recent activity, project health, upcoming deadlines. Interactive charts/cards/tables/filters (term, cohort, project, mentor, stage, date range). Useful empty states when no data. Seed data only in dev, clearly labeled as demo data.

## 6. Project & team management
Fields: name, description, logo, category, members, lead, mentor, cohort, stage, status, repo URL, created/last-activity dates, milestone/task/competition/funding history, documents. Stages: Ideation → PoC → MVP → Market Testing → Pre-Incubation Launch. Directory with search/filter/sort/pagination, stage + health indicators, detail pages. Create/edit/archive/membership mgmt. Audit trail for significant changes.

## 7. Task & milestone management
Kanban: TODO/IN_PROGRESS/REVIEW/DONE. Task fields: title, description, project, assignee, priority, start/due/completion dates, dependencies, comments, attachments, status history, milestone link. Drag-and-drop; validate dependency/workflow transitions. Stage-gate milestones with example gates per stage (see full prompt for the per-stage checklist items — Ideation/PoC/MVP/Market Testing/Pre-Incubation). Admin-configurable requirements. Evidence submission → mentor/admin approve/reject with comments; record reviewer/timestamp/reason. Funding is never auto-unlocked by task completion — require explicit authorization for financial/stage-gate decisions.

## 8. Attendance
A. Physical: sessions (name, description, date, start/end time, location, eligible participants, policy). Dynamic QR: expiring, signed short-lived tokens, single-use per policy, backend-validated, duplicate check-in prevention, timestamped, correctly associated. Optional, non-mandatory, explicitly-permissioned location check — never treat coordinates as identity proof. Manual correction workflow + audit trail.
B. Discord voice: discord.js bot, admin-configured monitored channels, track user/project/channel/join/leave/duration via voice-state events, configurable minimum duration, safe bot-restart/incomplete-session handling, no duplicate records, graceful handling of disconnects/missing events/API interruptions. Clearly distinguish verified vs. estimated/incomplete sessions. Never describe presence as proof of productive work.

## 9. Discord engagement telemetry
Privacy-preserving: only configured/authorized metadata — voice duration, aggregate message counts, channel activity counts, daily team totals, integration health, aggregated trends. No message content, no private-message inspection, no unnecessary PII. Document required bot permissions/gateway intents. Team Engagement Index = configurable weighted formula (e.g. 0.50 voice + 0.20 message + 0.30 task completion) — display methodology, treat as configurable default not a universal measure. No individual productivity/competence inference from telemetry alone. Data retention + access restriction rules. Context-aware inactivity alerts, admin review/dismiss. Integration health monitoring + error logs.

## 10. GitHub integration
Link repos per project. Where API permissions allow: metadata sync, default branch, latest commit timestamp, commit activity summaries, PR summaries, repo links, integration health. Secure OAuth/scoped credentials, never exposed to frontend/logs. Respect rate limits; cache + async sync. Commit counts are supporting context only, never a full contribution measure. If credentials unavailable: clear setup screen, never invented activity.

## 11. Hackathon & competition management
Fields: name, organizer, description, registration URL, start/end dates, eligibility, participants, submission deadline/repo/demo/pitch deck, application status, outcome (PARTICIPANT/FINALIST/WINNER), prize/grant amount + currency, verification docs, mentor notes. Searchable directory, project-level history, filterable leaderboard. Verified vs. estimated funding tracked separately, multi-currency, decimal precision, authorized review for material award changes. Never invent prize money or outcomes.

## 12. Automated PDF reporting
Puppeteer engine for: project, cohort, term, attendance compliance, milestone progression, competition outcomes, funding, Discord engagement, executive summary reports. Content: institutional ID, title, period, generation timestamp, summary metrics, project directory, stages, task completion, milestone status, verified attendance, aggregate engagement, competition outcomes, verified funding, risks/overdue, approval/sign-off. A4, headers/footers/page numbers/tables/page-breaks, print CSS. Background job processing, status, retry, error logging, downloadable PDFs, authorization checks, secure temp file handling, expiring links if object storage used. Reusable Puppeteer browser pool (never unbounded Chromium processes); non-blocking generation. Real DB-derived content only; empty state if no records for a period.

## 13. Database design (Prisma, normalized, relational)
Entities (minimum): User, Project, ProjectMembership, Cohort, Task, TaskDependency, Milestone, MilestoneSubmission, MilestoneReview, Event, AttendanceSession, AttendanceRecord, DiscordIntegration, DiscordVoiceSession, DiscordActivityDaily, GitHubIntegration, RepositoryActivityDaily, Competition, CompetitionRegistration, FundingAward, Document, Notification, AuditLog, GeneratedReport (+ any others required for correctness). UUID PKs, explicit FKs + deletion behavior, indexes for dashboard/filter queries, consistent timestamps, duplicate-prevention constraints (attendance, external event processing), decimal + explicit currency for money, transactions for atomic multi-write ops, secrets kept out of ordinary tables where a secure credential mechanism is more appropriate. Migrations + dev seed scripts. Document the schema. No single generic table for everything.

## 14. Design system & UX
Premium dark-mode developer aesthetic:
- Background `#090D16`, card surfaces `#111827`, borders `#1F2937`, primary accent `#6366F1`, success `#10B981`, warning `#F59E0B`, primary text `#F9FAFB`, muted text `#9CA3AF`.
- Fonts: Inter (interface), JetBrains Mono (technical identifiers/telemetry).
- Responsive Bento Grid dashboard: TOP (active projects, task completion rate, verified attendance, recorded funding) · MAIN (project portfolio, kanban activity, milestone approvals, project health) · SIDE (Discord status, upcoming events, pending attendance sessions, recent notifications) · BOTTOM (hackathon leaderboard, funding overview, activity timeline, report generation panel).
- Required pages (19): Login, Onboarding, Executive dashboard, Project directory, Project details, Kanban board, Milestone review, Attendance management, Event management, Discord analytics, GitHub integration, Competition hub, Funding ledger, Reports, Notifications, User management, Integration settings, Audit logs, User profile.
- Desktop/tablet/mobile responsive. Loading/error/empty states, success feedback, accessible forms, keyboard nav, confirmation dialogs, search/filter, pagination, tooltips. No unnecessary animation. No decorative charts disconnected from real data.

## 15. Security & privacy
Server-side role checks, request validation, rate limiting, secure sessions, CSRF where applicable, CORS policy, secure HTTP headers, secret management, input sanitization, upload validation, audit logging, DB least privilege, safe error responses, dependency vuln checks. Uploads: type allowlist, size limits, generated storage IDs, authorization-restricted access, never execute uploaded files. Discord/GitHub: secure secret storage, minimum-permission requests, credential rotation support, revoked-credential handling, never log credentials/private data. Configurable retention policies. Transparent attendance/engagement collection disclosures. Individual-level telemetry restricted to authorized staff only. Compliance is configurable, never claimed without real review.

## 16. Real-time updates & notifications
Notify on: task assignment, approaching/overdue deadlines, milestone submission/approval/rejection, upcoming events, attendance reminders, competition deadlines, integration failures, report completion. In-app notifications, WebSockets where materially useful, read/unread state, no duplicates, configurable preferences, background queues for non-blocking ops.

## 17. Testing & QA
Cover at minimum: auth, authorization, project membership restriction, task state transitions, milestone approval permissions, duplicate attendance prevention, QR token expiration, Discord session duration calc, funding calculations, competition registration, PDF report authorization, data isolation between projects, API validation, dashboard metric calculations. E2E journeys: admin creates project → lead assigns task → member completes task → mentor approves milestone → admin creates attendance session → student checks in via valid QR → expired QR rejected → Discord voice activity recorded (when configured) → project registers for competition → authorized user generates PDF → unauthorized user blocked from restricted records. Run tests/typecheck/lint/production build for real; fix errors; never claim passing tests that weren't executed.

## 18. Implementation phases
1. Environment discovery (inspect repo/runtime/tools/db/integrations/AI model options, preserve existing code, write implementation plan).
2. Application foundation (config, design system, DB schema, migrations, auth, authorization, main navigation, dev seed data).
3. Core operations (projects, teams/memberships, Kanban, milestones/stage-gates, events/attendance).
4. External integrations (Discord, privacy-preserving telemetry, GitHub sync, integration config screens, background workers).
5. Competitions & reporting (competitions, funding records, analytics queries, PDF generation, download workflows).
6. Polish & verification (responsive layouts, loading/error states, tests, defect fixes, authorization boundary verification, production build, deployment docs).

End of every phase: summarize what was implemented, identify incomplete work, run relevant checks, fix errors, preserve a working application. Never stop at a plan/mockup only — implement.

## 19. Engineering rules (non-negotiable)
Working features not placeholders · real DB queries · never expose secrets to the browser · never fake Discord/GitHub/attendance/PDF functionality · when credentials are unavailable, build the integration correctly + provide a config UI · migrations only, no undocumented manual schema changes · modular maintainable components · strict TypeScript, avoid `any` · validate all external input · handle loading/failure/retry/empty states · document architectural trade-offs · prefer simple reliable implementations · don't remove existing functionality without documented reason · never claim a feature complete unless verified working · don't block unrelated feature work waiting on credentials — keep going on what's independent · no critical business logic left as TODO · if blocked by a missing external dependency, build the surrounding architecture and document the blocker clearly · keep sensitive telemetry and admin actions auditable.

## 20. Definition of done
App starts; schema/migrations work; auth+authz work; projects/teams manageable; tasks/milestones function; attendance workflows work; Discord/GitHub integrations work once credentials are configured; competition/funding records persist; PDF reports generate and download; dashboard metrics reflect real DB records; critical tests pass; production build succeeds; env vars documented; setup/deploy instructions available; no critical workflow depends on fake data or placeholder actions.

Final summary (owed at the end of each phase and the whole build) must cover: features completed, architecture/key decisions, DB/migration details, integrations configured, required env vars, install/run commands, tests executed + actual results, deployment instructions, known limitations, remaining work.
