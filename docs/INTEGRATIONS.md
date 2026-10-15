# Integrations (status and setup)

Secrets live only in server environment variables; the UI reports presence, never values.

| Integration | Env vars | Status |
| --- | --- | --- |
| Email (SMTP) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Built. Without SMTP, mails are logged by the API. |
| Discord bot | `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` | Schema + read views built; bot worker is SPT-3. Needs `GUILD_VOICE_STATES` intent (and `GUILD_MESSAGES` for counts only; no message content). |
| GitHub | `GITHUB_TOKEN` (fine-grained, read-only metadata/contents/PRs) | Schema + read views built; sync worker is SPT-3. |
| Redis / BullMQ | `REDIS_URL` | Not used yet (SPT-3 workers). Reports use a Postgres queue. |
| PDF reports (Chromium) | `PUPPETEER_EXECUTABLE_PATH`, `PUPPETEER_NO_SANDBOX`, `REPORT_CONCURRENCY`, `REPORT_MAX_ATTEMPTS`, `REPORT_RETENTION_DAYS`, `REPORT_WORKER` | Built (SPT-4). See REPORTS.md. |

Idempotency for external events uses `ProcessedExternalEvent (source, externalId)` and `DiscordVoiceSession.externalKey`.
