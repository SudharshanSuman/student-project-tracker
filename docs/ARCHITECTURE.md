# Architecture & decisions

## Request flow
Browser → Next.js (`/api/*` rewrite proxy) → Express API → Prisma → PostgreSQL. The proxy keeps the session cookie first-party, so no CORS is needed in the browser path. Server components call the API directly (`API_INTERNAL_URL`) and forward the caller's cookie (`apps/web/src/lib/api-server.ts`).

## Authentication
- Accounts are invite-only. Admins create invitations (7-day, single-use, hashed token); the role comes from the invitation, never the request body. Institutional email domains are enforced on invite and accept.
- Sessions are database rows (SHA-256 of a random token) in an `httpOnly`, `SameSite=Lax` cookie (`secure` in production). Logout, password reset, password change and account disable revoke sessions.
- Passwords: scrypt (N=2^15). 5 failed logins lock the account for 15 minutes. Auth routes are rate-limited; forgot-password never reveals whether an email exists.
- CSRF: SameSite cookie + Origin allowlist + JSON/multipart-only bodies for state-changing requests.

## Authorization
All checks are server-side in the API. `apps/api/src/lib/access.ts` resolves project access:
ADMIN → everything; MENTOR → projects where they are the assigned mentor; students → projects they are members of; the project LEAD (membership role) manages tasks, milestones and members. Records in projects you cannot see return **404**, so existence does not leak. The web nav and page gate (`packages/shared/src/nav.ts`) only decide what to show.

## Workflow rules (packages/shared/src/workflow.ts)
- Kanban: TODO → IN_PROGRESS → REVIEW → DONE; one step back allowed; DONE reopens only to REVIEW. Starting/reviewing/finishing requires all dependencies DONE. Assignees move their own work up to REVIEW; only the lead or an admin moves work into or out of DONE. Dependency cycles are rejected.
- Stage gates: members submit evidence; the assigned mentor or an admin approves or requests changes with a mandatory comment (reviewer and time recorded). Stage advancement is a separate explicit action requiring an APPROVED gate for the current stage; admins may override, and the override is stored in stage history. **Task completion never changes milestone, stage or funding state.**
- Attendance: QR codes carry HMAC-SHA256-signed tokens (`lib/qr.ts`) with a configurable lifetime (15–600 s). Rotating policy: one code per screen; single-use: each token id is redeemed once (`QrTokenRedemption`). `unique(sessionId, userId)` prevents duplicate check-ins. Optional location is a supporting signal only and never blocks or identifies.

## Documents
Uploads go to `POST /api/projects/:id/documents` (multipart field `file`, optional `taskId`/`submissionId` of the same project). Members and admins upload; anyone who can see the project can list/download; the uploader or lead deletes. Policy (`lib/storage.ts`): 10 MB cap, MIME allowlist (PDF, PNG, JPEG, WebP, DOCX/XLSX/PPTX, TXT/MD, CSV) with matching extension **and** content signature, stored as `STORAGE_DIR/documents/<uuid>` (mode 600) — never the user's filename. Downloads are always `Content-Disposition: attachment` with `nosniff` and a sandbox CSP. Uploads and deletions are audited.

## Real-time
`/ws` WebSocket (cookie-authenticated, Origin-checked) pushes hints (`notification`, `board`); clients refetch over REST, so dropping the socket loses nothing. Clients also poll unread counts every 60 s.

## Dashboard
`GET /api/dashboard` computes every metric from live rows, scoped to the caller's visible projects, with cohort/project/mentor/stage/date filters. Funding is hidden from plain members.

## Trade-offs
- Embedded Postgres for local dev: the machine has no Docker or system Postgres. It runs real PostgreSQL 17, so no SQLite fallback was needed.
- shadcn/ui components are hand-written in the shadcn pattern (Radix + cva + tailwind-merge) instead of using the interactive CLI.
- Tailwind 3 (not 4) for a stable, well-known config.
- Express 5 handles async errors natively; a central error handler maps Zod/Prisma errors to safe JSON.

## Competitions, funding, reports (SPT-4)
See [REPORTS.md](REPORTS.md): verified-vs-claimed competition outcomes, decimal multi-currency funding with admin-reviewed change requests, and the Postgres-backed PDF job queue with a bounded Chromium pool.

## Known limitations (as of SPT-2)
- Report jobs use a Postgres queue rather than BullMQ (no Redis dependency); attendance eligibility in reports uses current memberships (membership history is not versioned).
- No Playwright end-to-end tests yet; API integration tests cover the core journeys (SPT-5).
- Docker files are unverified (no Docker on the dev machine).
- Remaining `npm audit` findings (15, none critical) all need major upgrades: Next 16, Prisma 7, Tailwind 4, eslint-config-next. Deferred: a framework migration while SPT-3/SPT-4 branches build on the current stack.
