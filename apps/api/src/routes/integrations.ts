import express, { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { notFound, forbidden } from "../lib/errors.js";
import { parse, uuidParam } from "../lib/validate.js";
import { currentUser, requireAuth, requireRole } from "../middleware/auth.js";
import { projectAccess } from "../lib/access.js";
import { discordService } from "../services/discord.js";
import { githubService } from "../services/github.js";
import { queueService } from "../services/queue.js";
import { telemetryService } from "../services/telemetry.js";

export const integrationsRouter = Router();

// ── Public Webhook Endpoint (No session auth, HMAC authenticated) ──
integrationsRouter.post("/integrations/github/webhook", async (req, res) => {
  const signatureHeader = req.headers["x-hub-signature-256"] as string | undefined;
  const eventHeader = req.headers["x-github-event"] as string | undefined;
  const deliveryId = req.headers["x-github-delivery"] as string | undefined;
  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody || JSON.stringify(req.body);

  const result = await githubService.handleWebhook({
    rawBody,
    signatureHeader,
    eventHeader,
    deliveryId,
    payload: req.body,
  });

  if (!result.accepted) {
    res.status(400).json({ ok: false, error: result.message });
    return;
  }

  res.json({ ok: true, message: result.message });
});

// All following routes require authenticated session
integrationsRouter.use(requireAuth);

// ── Overall Health & Status ──
integrationsRouter.get("/integrations/health", async (_req, res) => {
  const [discordIntegration, linkedReposCount, queueHealth] = await Promise.all([
    prisma.discordIntegration.findFirst({
      select: { status: true, guildName: true, lastHeartbeatAt: true, lastError: true },
    }),
    prisma.gitHubIntegration.count(),
    queueService.getHealth(),
  ]);

  res.json({
    status: "ok",
    discord: {
      configured: config.integrations.discordConfigured,
      status: discordIntegration?.status ?? "NOT_CONFIGURED",
      guildName: discordIntegration?.guildName ?? null,
      lastHeartbeatAt: discordIntegration?.lastHeartbeatAt ?? null,
      lastError: discordIntegration?.lastError ?? null,
    },
    github: {
      configured: config.integrations.githubConfigured,
      linkedRepositories: linkedReposCount,
    },
    queue: queueHealth,
  });
});

// ── Full Integrations Overview (Admin) ──
integrationsRouter.get("/integrations", requireRole("ADMIN"), async (_req, res) => {
  const [discord, githubIntegrations, logs, engagementWeights, queueHealth, openAlerts] = await Promise.all([
    prisma.discordIntegration.findFirst({
      include: {
        channels: {
          include: { project: { select: { id: true, name: true } } },
          orderBy: { name: "asc" },
        },
      },
    }),
    prisma.gitHubIntegration.findMany({
      include: {
        project: { select: { id: true, name: true, repoUrl: true } },
        activity: { orderBy: { date: "desc" }, take: 7 },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.integrationLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    telemetryService.getEngagementWeights(),
    queueService.getHealth(),
    prisma.inactivityAlert.findMany({
      where: { status: "OPEN" },
      include: { project: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  res.json({
    discord: {
      credentialsPresent: config.integrations.discordConfigured,
      integration: discord,
    },
    github: {
      credentialsPresent: config.integrations.githubConfigured,
      linkedRepositories: githubIntegrations.length,
      repositories: githubIntegrations,
    },
    email: { smtpConfigured: config.integrations.smtpConfigured },
    queue: queueHealth,
    engagementWeights,
    openAlerts,
    logs,
  });
});

// ── Discord Configuration ──
const discordSetupSchema = z.object({
  guildId: z.string().trim().min(1, "Guild ID is required"),
  guildName: z.string().trim().max(100).optional().nullable(),
  minSessionSeconds: z.number().int().min(10).max(3600).default(300),
  countMessages: z.boolean().default(true),
  retentionDays: z.number().int().min(7).max(730).default(365),
});

integrationsRouter.post("/integrations/discord/setup", requireRole("ADMIN"), async (req, res) => {
  const input = parse(discordSetupSchema, req.body);

  const integration = await prisma.discordIntegration.upsert({
    where: { guildId: input.guildId },
    create: {
      guildId: input.guildId,
      guildName: input.guildName || null,
      minSessionSeconds: input.minSessionSeconds,
      countMessages: input.countMessages,
      retentionDays: input.retentionDays,
      status: config.integrations.discordConfigured ? "ACTIVE" : "NOT_CONFIGURED",
    },
    update: {
      guildName: input.guildName || undefined,
      minSessionSeconds: input.minSessionSeconds,
      countMessages: input.countMessages,
      retentionDays: input.retentionDays,
    },
  });

  res.json({ ok: true, integration });
});

// Discord channel mapping
const channelMappingSchema = z.object({
  channelId: z.string().trim().min(1, "Channel ID is required"),
  name: z.string().trim().min(1).max(100),
  type: z.enum(["VOICE", "TEXT"]).default("VOICE"),
  monitored: z.boolean().default(true),
  projectId: z.string().uuid().optional().nullable(),
});

integrationsRouter.post("/integrations/discord/channels", requireRole("ADMIN"), async (req, res) => {
  const input = parse(channelMappingSchema, req.body);

  let integration = await prisma.discordIntegration.findFirst();
  if (!integration) {
    integration = await prisma.discordIntegration.create({
      data: {
        guildId: config.DISCORD_GUILD_ID || "default-guild",
        guildName: "Incubation Server",
        status: config.integrations.discordConfigured ? "ACTIVE" : "NOT_CONFIGURED",
      },
    });
  }

  const channel = await prisma.discordChannel.upsert({
    where: { channelId: input.channelId },
    create: {
      integrationId: integration.id,
      channelId: input.channelId,
      name: input.name,
      type: input.type,
      monitored: input.monitored,
      projectId: input.projectId || null,
    },
    update: {
      name: input.name,
      type: input.type,
      monitored: input.monitored,
      projectId: input.projectId || null,
    },
  });

  res.json({ ok: true, channel });
});

integrationsRouter.delete("/integrations/discord/channels/:id", requireRole("ADMIN"), async (req, res) => {
  const id = uuidParam(req.params.id);
  await prisma.discordChannel.deleteMany({ where: { id } });
  res.json({ ok: true });
});

// Discord event simulation (for testing, dev, and verifying pipeline without bot)
const simulateEventSchema = z.object({
  eventType: z.enum(["voice-join", "voice-leave", "message"]),
  channelId: z.string().min(1),
  discordUserId: z.string().min(1),
  guildId: z.string().optional(),
  joinedAt: z.coerce.date().optional(),
  leftAt: z.coerce.date().optional(),
});

integrationsRouter.post("/integrations/discord/simulate", requireRole("ADMIN"), async (req, res) => {
  const input = parse(simulateEventSchema, req.body);
  const guildId = input.guildId || config.DISCORD_GUILD_ID || "default-guild";

  if (input.eventType === "voice-join") {
    const result = await discordService.processVoiceJoin({
      guildId,
      channelId: input.channelId,
      discordUserId: input.discordUserId,
      joinedAt: input.joinedAt || new Date(),
    });
    res.json({ ok: true, result });
  } else if (input.eventType === "voice-leave") {
    const result = await discordService.processVoiceLeave({
      guildId,
      channelId: input.channelId,
      discordUserId: input.discordUserId,
      leftAt: input.leftAt || new Date(),
    });
    res.json({ ok: true, result });
  } else if (input.eventType === "message") {
    const result = await discordService.processMessageTelemetry({
      guildId,
      channelId: input.channelId,
      discordUserId: input.discordUserId,
      timestamp: new Date(),
    });
    res.json({ ok: true, processed: result });
  }
});

// ── Engagement Weights ──
const weightsSchema = z.object({
  voice: z.number().min(0).max(1),
  messages: z.number().min(0).max(1),
  tasks: z.number().min(0).max(1),
}).refine((w) => Math.abs(w.voice + w.messages + w.tasks - 1.0) < 0.05, {
  message: "Weights must sum to 1.0 (±0.05)",
});

integrationsRouter.put("/integrations/engagement-weights", requireRole("ADMIN"), async (req, res) => {
  const input = parse(weightsSchema, req.body);
  const updated = await telemetryService.setEngagementWeights(input);
  res.json({ ok: true, weights: updated });
});

// ── GitHub Link / Sync ──
const linkGitHubSchema = z.object({
  projectId: z.string().uuid(),
  owner: z.string().trim().min(1, "Owner is required").max(100),
  repo: z.string().trim().min(1, "Repo name is required").max(100),
  token: z.string().trim().min(1).optional(),
  webhookSecret: z.string().trim().min(8).optional(),
});

integrationsRouter.post("/integrations/github/link", async (req, res) => {
  const user = currentUser(req);
  const input = parse(linkGitHubSchema, req.body);

  const access = await projectAccess(user, input.projectId);
  if (!access?.canManage) throw forbidden("Only project lead or admin can link repositories");

  const linked = await githubService.linkRepository(input);
  res.json({ ok: true, linked });
});

integrationsRouter.delete("/integrations/github/link/:projectId", async (req, res) => {
  const user = currentUser(req);
  const projectId = uuidParam(req.params.projectId);

  const access = await projectAccess(user, projectId);
  if (!access?.canManage) throw forbidden("Only project lead or admin can unlink repositories");

  await githubService.unlinkRepository(projectId);
  res.json({ ok: true });
});

integrationsRouter.post("/integrations/github/sync/:projectId", async (req, res) => {
  const user = currentUser(req);
  const projectId = uuidParam(req.params.projectId);

  const access = await projectAccess(user, projectId);
  if (!access?.canManage) throw forbidden("Only project lead or admin can trigger repository sync");

  const integration = await prisma.gitHubIntegration.findUnique({ where: { projectId } });
  if (!integration) throw notFound("Repository not linked for this project");

  const syncResult = await githubService.syncRepository({
    projectId,
    owner: integration.owner,
    repo: integration.repo,
    manual: true,
  });

  res.json({ ok: syncResult.success, ...syncResult });
});

// ── Inactivity Alerts Management ──
const reviewAlertSchema = z.object({
  status: z.enum(["RESOLVED", "DISMISSED"]),
  reviewNote: z.string().trim().max(1000).optional().nullable(),
});

integrationsRouter.post("/integrations/alerts/:id/review", requireRole("ADMIN", "MENTOR"), async (req, res) => {
  const id = uuidParam(req.params.id);
  const user = currentUser(req);
  const input = parse(reviewAlertSchema, req.body);

  const alert = await prisma.inactivityAlert.findUnique({ where: { id } });
  if (!alert) throw notFound("Inactivity alert not found");

  const updated = await prisma.inactivityAlert.update({
    where: { id },
    data: {
      status: input.status,
      reviewNote: input.reviewNote || null,
      reviewedById: user.id,
      reviewedAt: new Date(),
    },
  });

  res.json({ ok: true, alert: updated });
});

// ── Maintenance Triggers ──
integrationsRouter.post("/integrations/maintenance/scan-inactivity", requireRole("ADMIN"), async (_req, res) => {
  const count = await telemetryService.scanInactivityAlerts(14);
  res.json({ ok: true, alertsGenerated: count });
});

integrationsRouter.post("/integrations/maintenance/cleanup", requireRole("ADMIN"), async (_req, res) => {
  const [recovered, purged] = await Promise.all([
    discordService.recoverOpenVoiceSessions(),
    discordService.purgeOldTelemetry(365),
  ]);
  res.json({ ok: true, sessionsRecovered: recovered, ...purged });
});
