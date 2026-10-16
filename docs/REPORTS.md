# Competitions, funding and PDF reports (SPT-4)

## Competitions
- **Directory** (`GET /api/competitions?q=&when=upcoming|past&outcome=&projectId=`): every signed-in user can browse. Staff (admin, mentor) add competitions; the creator or an admin edits; only admins delete, and never while registrations exist (outcome history is kept).
- **Registrations** belong to a project. The project lead, its assigned mentor or an admin registers it and updates status, submission links (repo, demo, pitch deck) and the outcome.
- **Outcomes are claims until verified.** `PARTICIPANT/FINALIST/WINNER` set by a lead stays unverified until the assigned mentor or an admin calls `POST /api/competition-registrations/:id/verify-outcome` with a mandatory note. Changing an outcome clears its verification; a lead cannot change a verified outcome. Every step is audited.
- **Leaderboard** (`GET /api/competitions/leaderboard`) counts verified outcomes only (Winner 5, Finalist 3, Participant 1) across all non-archived projects. It never includes money. Staff can add `includeUnverified=true`; unverified rows are flagged.
- Mentor notes are visible to staff and the project lead only.
- Project history: `GET /api/projects/:id/competitions`.

## Funding
- `Decimal(14,2)` + ISO 4217 currency (validated against `Intl.supportedValuesOf("currency")`). The API accepts amounts only as decimal **strings** (`"1500.50"`); JSON numbers are rejected so no float rounding can happen. Totals are summed by Postgres per currency and per verification state; currencies are never converted or added together.
- New awards are always `ESTIMATED`, whatever the client sends. The assigned mentor or an admin verifies or rejects them with a mandatory evidence note; a mentor cannot verify an award they recorded.
- **Material changes** (amount, currency, source, award date, linked registration) to a `VERIFIED` award are refused (`409 MATERIAL_CHANGE_REQUIRES_REVIEW`). Instead `POST /api/funding/:id/change-requests` creates a `FundingChangeRequest`; an admin **other than the requester** approves or rejects it (`POST /api/funding/change-requests/:id/review`). Approval applies the change and re-verifies under the reviewer's name; the audit log keeps before/after values. Verified awards cannot be deleted.
- Plain project members never see funding.

## PDF reports
Flow: `POST /api/reports` (admin/mentor) inserts a `GeneratedReport` row (`QUEUED`) and returns `202`. The in-process worker claims jobs from Postgres (`FOR UPDATE SKIP LOCKED`, so several API replicas are safe), builds the report from live queries, renders HTML to PDF in Chromium and stores it.

| Concern | Implementation |
| --- | --- |
| Bounded Chromium | `reports/browser-pool.ts`: fixed pool of `REPORT_CONCURRENCY` browsers, FIFO wait queue, recycle after 50 renders, relaunch on crash, close when idle 5 min. |
| Retry + errors | Up to `REPORT_MAX_ATTEMPTS` with exponential backoff (10 s, 20 s, …). Permanent errors (requester disabled, project no longer visible, cohort deleted) fail at once. Failures go to the report row and `IntegrationLog` (`REPORTS`). Jobs stuck `RUNNING` > 10 min (crash) are re-queued at startup. Failed jobs can be retried from the UI. |
| Print layout | A4, 16 mm side margins, Chromium header (institution, title, period) and footer (generation time, "Page X of Y"), repeating table headers, rows never split, section headings kept with content, sign-off block kept together. |
| Safety | Every value is HTML-escaped; the page runs with JavaScript disabled and all network requests aborted. |
| Storage | `STORAGE_DIR/reports/<uuid>.pdf`, dir `0700`, file `0600`, written to a temp file then renamed. Storage keys never leave the API. |
| Downloads | `GET /api/reports/:id/download`: admin, or the requesting mentor while they can still see the project. `410` after `REPORT_RETENTION_DAYS` (file deleted by the maintenance job). `Cache-Control: private, no-store`, attachment disposition. Downloads are audited. |
| Scope | Content is limited to what the requester can see at generation time (mentors: their mentored projects). Executive summaries are admin-only. Max 5 open jobs per user. |
| Honesty | All figures are counts/sums of real rows. Empty tables print an explicit empty state; estimated funding and unverified outcomes are labelled and excluded from verified totals. |

Report types: Project, Cohort (all records to date), and period reports: Term, Attendance compliance, Milestone progression, Competition outcomes, Funding, Executive summary (admin). Period reports accept an optional cohort filter.

**Discord engagement** renders a "pending integration" notice only. It shows no numbers until the Discord bot (SPT-3) is merged; then replace `builders.DISCORD_ENGAGEMENT` in `apps/api/src/reports/data.ts` with queries over `DiscordActivityDaily` / `DiscordVoiceSession`.

### Requirements
A Chrome or Chromium binary (`puppeteer-core` does not download one). Set `PUPPETEER_EXECUTABLE_PATH`, or install Chrome/Chromium in a standard path. In Docker, install `chromium` in the API image and set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` (and `PUPPETEER_NO_SANDBOX=true` only if the container must run as root).
