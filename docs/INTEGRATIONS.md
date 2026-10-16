# Integrations (status and setup)

Secrets live in server environment variables or encrypted at rest in the database using AES-256-GCM. The UI reports presence and health, never values.

| Integration | Env vars / Secrets | Status |
| --- | --- | --- |
| Email (SMTP) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Built. Without SMTP, emails are written to the API log. |
| Discord bot | `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` | **Built (SPT-3).** Voice presence tracking, aggregate message counts, bot restart recovery, privacy-preserving telemetry. Requires `GUILD_VOICE_STATES` and `GUILD_MESSAGES` (for count telemetry only; no message content is ever accessed). |
| GitHub sync | `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET` | **Built (SPT-3).** Repo metadata, commit/PR summaries, webhook receiver with HMAC-SHA256 signature verification, encrypted token storage at rest per project. |
| Redis / BullMQ | `REDIS_URL` | **Built (SPT-3).** BullMQ queues for Discord voice processing, GitHub sync, and maintenance jobs. Seamless in-memory fallback with exponential retry & backoff when Redis is unconfigured. |
| PDF reports (Chromium) | `PUPPETEER_EXECUTABLE_PATH`, `PUPPETEER_NO_SANDBOX`, `REPORT_CONCURRENCY`, `REPORT_MAX_ATTEMPTS`, `REPORT_RETENTION_DAYS`, `REPORT_WORKER` | **Built (SPT-4).** See REPORTS.md. Uses its own Postgres-backed job queue (independent of the BullMQ/Redis queues above). |

---

## 1. Discord Bot Setup Guide

### Required Bot Permissions & Gateway Intents
1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **Bot**, click **Reset Token** to obtain `DISCORD_BOT_TOKEN`.
3. Under **Privileged Gateway Intents**, enable:
   - **Server Members Intent**
   - **Guild Voice States** (required for `voiceStateUpdate` join/leave detection)
   - **Guild Messages** (only used for daily message count aggregation; message content intent is **NOT** required and content is never accessed).
4. Under **OAuth2 → URL Generator**, select the `bot` scope with permissions:
   - *View Channels*
   - *Connect*
   - *Read Message History*
5. Open the generated invite link to add the bot to your incubation server. Copy the Server ID as `DISCORD_GUILD_ID`.
6. Add channels to monitor in **Admin → Integration Settings → Map Channel** and link them to projects for automatic attendance tracking.

### Privacy Guarantees
- Voice presence reflects time spent in monitored channels; it is distinguished as `VERIFIED` (>= minimum session duration) vs `INCOMPLETE`.
- Message telemetry only counts messages in monitored text channels. No message content, attachments, or private direct messages are ever collected.

---

## 2. GitHub Integration Setup Guide

### Token Scopes & Permissions
1. Create a fine-grained Personal Access Token (PAT) under **Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens**.
2. Select your repository/organization and assign read-only permissions:
   - `Metadata`: Read-only
   - `Contents`: Read-only (commits and activity)
   - `Pull requests`: Read-only
3. Add the token globally via `GITHUB_TOKEN` in `.env`, or configure it per-project in the web UI. Tokens entered in the UI are encrypted at rest with AES-256-GCM before database storage.

### Webhook Configuration
- **Payload URL:** `https://<domain>/api/integrations/github/webhook`
- **Content type:** `application/json`
- **Secret:** Configure a strong secret and set `GITHUB_WEBHOOK_SECRET` in `.env` (or per project in the link dialog).
- **Events:** Select *Pushes* and *Pull requests*.
- All webhook deliveries are verified using constant-time HMAC-SHA256 comparison and deduplicated using `ProcessedExternalEvent (source: "GITHUB", externalId: deliveryId)`.

---

## 3. Background Workers (BullMQ + Redis)

Background processing runs on BullMQ with Redis:
- `iic-discord`: voice state transitions, daily telemetry aggregation.
- `iic-github`: repository sync jobs and webhook deliveries.
- `iic-maintenance`: inactivity alert scans, telemetry retention cleanup (default 365 days), and open voice session recovery on bot restart.

When `REDIS_URL` is omitted (local dev or embedded database mode), an in-memory job runner provides identical asynchronous execution, exponential retries, and error recording to `IntegrationLog`.
