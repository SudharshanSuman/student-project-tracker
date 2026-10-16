# IIC Management Platform

University Innovation Incubation Cell platform: project portfolio, Kanban tasks, stage-gate milestones, QR attendance, executive dashboard, and (in later phases) Discord/GitHub telemetry, competitions, funding and PDF reports. Full requirements: [SPEC.md](SPEC.md).

## Stack

| Layer | Choice |
| --- | --- |
| Web | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 3, shadcn-style Radix components, Recharts, React Hook Form + Zod, dnd-kit, Lucide |
| API | Node 20, Express 5, TypeScript (ESM), Zod validation, pino logging, `ws` WebSocket hints |
| Data | PostgreSQL 17 via Prisma 6 (UUID keys, migrations) |
| Shared | `packages/shared` — enums, Zod request schemas, workflow rules, navigation/role map |
| Tests | Vitest + Supertest against a real Postgres test database |

```
apps/api      Express API, Prisma schema/migrations/seed, tests
apps/web      Next.js app (all UI routes)
packages/shared  code used by both
scripts/      dev-db.mjs (embedded Postgres), dev.mjs (run both servers)
docs/         DATABASE.md, ARCHITECTURE.md, INTEGRATIONS.md
```

## Run locally (no Docker needed)

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # then set QR_TOKEN_SECRET (openssl rand -hex 32)
ln -s ../../.env apps/api/.env && ln -s ../../.env apps/web/.env
npm run db:start            # terminal 1: embedded PostgreSQL 17 on :5433 (data in .dev-db/)
npm run db:migrate          # apply migrations
npm run db:seed             # DEMO data only (labelled [Demo]); refuses to run in production
npm run dev                 # terminal 2: API :4000 + web :3000
```

Open http://localhost:3000. Demo accounts (password `DemoPass2026`): `admin@iic.local`, `mentor.rao@iic.local`, `lead.arjun@iic.local`, `member.priya@iic.local`.

Already have Postgres (system install, hosted, Docker)? Skip `db:start` and set `DATABASE_URL` / `TEST_DATABASE_URL`.

Without SMTP, invitation and password-reset emails are written to the API log, and the admin invitation dialog shows the link to share.

## Checks

```bash
npm run typecheck   # all workspaces
npm run lint
npm test            # shared unit tests + API integration tests (needs TEST_DATABASE_URL)
npm run build       # shared typecheck, API bundle (tsup), Next.js standalone build
npm run test:e2e -w @iic/web   # Playwright browser E2E (starts the dev servers itself; needs the seeded dev DB)
```

## Docker

`docker compose up --build` runs Postgres, Redis, the API (runs `prisma migrate deploy` on start) and the web app. These files were written without a Docker daemon available on the build machine and have **not yet been run**.

## Environment variables

See [.env.example](.env.example). Required: `DATABASE_URL`, `QR_TOKEN_SECRET` (≥ 32 chars). Production also needs `INSTITUTION_EMAIL_DOMAINS` (an empty list rejects all sign-ups in production), `WEB_ORIGIN`, `APP_URL`, and SMTP settings. Integration credentials (`DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `GITHUB_TOKEN`, `REDIS_URL`) are optional until those phases ship.

## Status

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for decisions and known limitations.
