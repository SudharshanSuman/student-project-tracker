import { beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { prisma } from "../src/db.js";
import {
  decryptCredential,
  encryptCredential,
  verifyGitHubWebhookSignature,
} from "../src/lib/crypto.js";
import { discordService } from "../src/services/discord.js";
import { githubService } from "../src/services/github.js";
import { queueService, QUEUE_NAMES } from "../src/services/queue.js";
import { telemetryService } from "../src/services/telemetry.js";
import { app, loginAs, resetDb, world } from "./helpers.js";

describe("SPT-3: External Integrations (Discord, GitHub, Background Workers)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe("1. Credential Security & Encryption at Rest (AES-256-GCM)", () => {
    it("encrypts and decrypts secret tokens cleanly at rest", () => {
      const secret = "ghp_secure_github_personal_access_token_12345";
      const encrypted = encryptCredential(secret);

      expect(encrypted).toMatch(/^enc\$v1\$/);
      expect(encrypted).not.toContain(secret);

      const decrypted = decryptCredential(encrypted);
      expect(decrypted).toBe(secret);
    });

    it("generates different ciphertexts for the same plaintext due to random IV", () => {
      const token = "discord_bot_secret_token_abcdef";
      const enc1 = encryptCredential(token);
      const enc2 = encryptCredential(token);

      expect(enc1).not.toBe(enc2);
      expect(decryptCredential(enc1)).toBe(token);
      expect(decryptCredential(enc2)).toBe(token);
    });

    it("rejects tampered ciphertexts and invalid formats", () => {
      const token = "my_sensitive_token";
      const encrypted = encryptCredential(token);
      const parts = encrypted.split("$");

      // Corrupt the ciphertext payload
      parts[4] = "corrupted_payload";
      const tampered = parts.join("$");

      expect(() => decryptCredential(tampered)).toThrow();
      expect(() => decryptCredential("invalid_string_format")).toThrow();
    });
  });

  describe("2. Webhook Signature Verification (HMAC-SHA256)", () => {
    const secret = "super_secret_webhook_key_2026";
    const payload = JSON.stringify({ action: "push", repository: { name: "test-repo" } });

    it("verifies valid GitHub HMAC-SHA256 signatures", () => {
      const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
      const valid = verifyGitHubWebhookSignature(payload, secret, signature);
      expect(valid).toBe(true);
    });

    it("rejects invalid or tampered signatures", () => {
      const badSignature = `sha256=${createHmac("sha256", "wrong_secret").update(payload).digest("hex")}`;
      expect(verifyGitHubWebhookSignature(payload, secret, badSignature)).toBe(false);
      expect(verifyGitHubWebhookSignature(payload, secret, "sha256=invalidhex")).toBe(false);
      expect(verifyGitHubWebhookSignature(payload, secret, null)).toBe(false);
    });
  });

  describe("3. Discord Voice Session & Telemetry Processing", () => {
    it("tracks voice join and leave, calculating verified vs incomplete status based on minSessionSeconds", async () => {
      const w = await world();
      const guildId = "guild-100";
      const channelId = "chan-voice-1";
      const discordUserId = "disc-user-42";

      // 1. Setup Discord Integration with 300s minimum session duration
      const integration = await prisma.discordIntegration.create({
        data: {
          guildId,
          guildName: "Test Guild",
          minSessionSeconds: 300,
          status: "ACTIVE",
          channels: {
            create: {
              channelId,
              name: "General Voice",
              type: "VOICE",
              monitored: true,
              projectId: w.project.id,
            },
          },
        },
      });

      // Link a user to this discord user ID
      await prisma.user.update({
        where: { id: w.member.id },
        data: { discordUserId },
      });

      // 2. Process Voice Join
      const joinTime = new Date("2026-10-16T10:00:00.000Z");
      const joinRes = await discordService.processVoiceJoin({
        guildId,
        channelId,
        discordUserId,
        joinedAt: joinTime,
      });

      expect(joinRes.sessionId).toBeDefined();
      expect(joinRes.duplicate).toBe(false);

      // Verify idempotency: duplicate join event is safely ignored
      const dupJoinRes = await discordService.processVoiceJoin({
        guildId,
        channelId,
        discordUserId,
        joinedAt: joinTime,
      });
      expect(dupJoinRes.duplicate).toBe(true);

      // 3. Process Voice Leave after 600s (>= 300s -> VERIFIED)
      const leaveTimeVerified = new Date("2026-10-16T10:10:00.000Z"); // 600s
      const leaveRes = await discordService.processVoiceLeave({
        guildId,
        channelId,
        discordUserId,
        leftAt: leaveTimeVerified,
      });

      expect(leaveRes.durationSeconds).toBe(600);
      expect(leaveRes.status).toBe("VERIFIED");

      // Verify daily activity aggregation
      const daily = await prisma.discordActivityDaily.findFirst({
        where: { channelId, discordUserId },
      });
      expect(daily?.voiceSeconds).toBe(600);
      expect(daily?.projectId).toBe(w.project.id);

      // 4. Short session test (< 300s -> INCOMPLETE)
      const shortJoin = new Date("2026-10-16T11:00:00.000Z");
      await discordService.processVoiceJoin({
        guildId,
        channelId,
        discordUserId,
        joinedAt: shortJoin,
      });

      const shortLeave = new Date("2026-10-16T11:02:00.000Z"); // 120s
      const shortLeaveRes = await discordService.processVoiceLeave({
        guildId,
        channelId,
        discordUserId,
        leftAt: shortLeave,
      });

      expect(shortLeaveRes.durationSeconds).toBe(120);
      expect(shortLeaveRes.status).toBe("INCOMPLETE");

      // Daily total accumulated: 600 + 120 = 720
      const updatedDaily = await prisma.discordActivityDaily.findFirst({
        where: { channelId, discordUserId },
      });
      expect(updatedDaily?.voiceSeconds).toBe(720);
    });

    it("aggregates message counts without reading or storing message content", async () => {
      const w = await world();
      const guildId = "guild-msg-1";
      const channelId = "chan-text-1";
      const discordUserId = "disc-user-77";

      await prisma.discordIntegration.create({
        data: {
          guildId,
          guildName: "Message Test Guild",
          countMessages: true,
          status: "ACTIVE",
          channels: {
            create: {
              channelId,
              name: "project-chat",
              type: "TEXT",
              monitored: true,
              projectId: w.project.id,
            },
          },
        },
      });

      // Post 3 messages
      await discordService.processMessageTelemetry({
        guildId,
        channelId,
        discordUserId,
      });
      await discordService.processMessageTelemetry({
        guildId,
        channelId,
        discordUserId,
      });
      await discordService.processMessageTelemetry({
        guildId,
        channelId,
        discordUserId,
      });

      const daily = await prisma.discordActivityDaily.findFirst({
        where: { channelId, discordUserId },
      });

      expect(daily?.messageCount).toBe(3);
      expect(daily?.projectId).toBe(w.project.id);
      // Ensure zero voiceSeconds recorded
      expect(daily?.voiceSeconds).toBe(0);
    });

    it("recovers open voice sessions left open after a bot crash or restart", async () => {
      const w = await world();
      const guildId = "guild-crash-1";

      const integration = await prisma.discordIntegration.create({
        data: { guildId, status: "ACTIVE" },
      });

      // Create an abandoned session started 5 hours ago
      const fiveHoursAgo = new Date(Date.now() - 5 * 3600_000);
      await prisma.discordVoiceSession.create({
        data: {
          integrationId: integration.id,
          discordUserId: "user-abandoned",
          channelId: "chan-crash",
          joinedAt: fiveHoursAgo,
          status: "OPEN",
          externalKey: "key-crash-1",
        },
      });

      const recoveredCount = await discordService.recoverOpenVoiceSessions(4);
      expect(recoveredCount).toBe(1);

      const recoveredSession = await prisma.discordVoiceSession.findUnique({
        where: { externalKey: "key-crash-1" },
      });
      expect(recoveredSession?.status).toBe("ESTIMATED");
      expect(recoveredSession?.closeReason).toBe("bot_restart_recovery");
    });
  });

  describe("4. GitHub Sync & Webhook Processing", () => {
    it("links and unlinks repositories with encrypted credentials at rest", async () => {
      const w = await world();
      const token = "ghp_fine_grained_scoped_pat_xyz";
      const webhookSecret = "webhook_secret_9999";

      const linked = await githubService.linkRepository({
        projectId: w.project.id,
        owner: "iic-university",
        repo: "smart-campus",
        token,
        webhookSecret,
      });

      expect(linked.owner).toBe("iic-university");
      expect(linked.repo).toBe("smart-campus");

      // Verify token is encrypted in PlatformSetting and not stored in plain text
      const setting = await prisma.platformSetting.findUnique({
        where: { key: `credential.github.${w.project.id}` },
      });
      expect(setting).toBeDefined();
      expect(setting?.value).toMatch(/^enc\$v1\$/);
      expect(setting?.value).not.toContain(token);

      // Verify decrypted token resolution
      const resolved = await githubService.resolveToken(w.project.id);
      expect(resolved).toBe(token);

      // Unlink repository
      await githubService.unlinkRepository(w.project.id);
      const afterUnlink = await prisma.gitHubIntegration.findUnique({
        where: { projectId: w.project.id },
      });
      expect(afterUnlink).toBeNull();

      const afterUnlinkSetting = await prisma.platformSetting.findUnique({
        where: { key: `credential.github.${w.project.id}` },
      });
      expect(afterUnlinkSetting).toBeNull();
    });

    it("processes GitHub push and pull_request webhooks with HMAC verification and idempotency", async () => {
      const w = await world();
      const secret = "wh_secret_for_push_test";

      await githubService.linkRepository({
        projectId: w.project.id,
        owner: "iic-org",
        repo: "robotics-control",
        webhookSecret: secret,
      });

      const deliveryId = "delivery-push-001";
      const payload = {
        action: "push",
        repository: { name: "robotics-control", owner: { login: "iic-org" } },
        head_commit: {
          id: "commit-sha-123",
          timestamp: new Date().toISOString(),
          message: "Feat: Add motor controller",
        },
        commits: [{ id: "c1", timestamp: new Date().toISOString() }],
      };

      const rawBody = JSON.stringify(payload);
      const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;

      // First webhook delivery
      const res1 = await githubService.handleWebhook({
        rawBody,
        signatureHeader: signature,
        eventHeader: "push",
        deliveryId,
        payload,
      });
      expect(res1.accepted).toBe(true);

      // Verify commit recorded
      const integration = await prisma.gitHubIntegration.findUnique({
        where: { projectId: w.project.id },
        include: { activity: true },
      });
      expect(integration?.status).toBe("ACTIVE");
      expect(integration?.activity.length).toBe(1);
      expect(integration?.activity[0]?.commitCount).toBe(1);

      // Duplicate delivery with same delivery ID is suppressed idempotently
      const res2 = await githubService.handleWebhook({
        rawBody,
        signatureHeader: signature,
        eventHeader: "push",
        deliveryId,
        payload,
      });
      expect(res2.accepted).toBe(true);
      expect(res2.message).toBe("Duplicate event suppressed");

      // Verify commit count was not incremented twice
      const activity = await prisma.repositoryActivityDaily.findFirst({
        where: { githubIntegrationId: integration!.id },
      });
      expect(activity?.commitCount).toBe(1);
    });
  });

  describe("5. Inactivity Alerts & Team Engagement Index", () => {
    it("scans for stalled projects and creates InactivityAlert records", async () => {
      const w = await world();

      // No activity has occurred on project Alpha or Beta
      const count = await telemetryService.scanInactivityAlerts(14);
      expect(count).toBeGreaterThanOrEqual(1);

      const alert = await prisma.inactivityAlert.findFirst({
        where: { projectId: w.project.id, status: "OPEN" },
      });
      expect(alert).toBeDefined();
      expect(alert?.reason).toContain("No voice presence, repository commits, or task transitions");

      // Running scan again does not create duplicate open alerts
      const secondCount = await telemetryService.scanInactivityAlerts(14);
      expect(secondCount).toBe(0);
    });

    it("calculates Team Engagement Index according to configurable weighted formula", async () => {
      const w = await world();

      // Set custom weights: 40% voice, 30% messages, 30% tasks
      await telemetryService.setEngagementWeights({ voice: 0.4, messages: 0.3, tasks: 0.3 });

      const result = await telemetryService.calculateTeamEngagement([w.project.id]);
      expect(result.weights).toEqual({ voice: 0.4, messages: 0.3, tasks: 0.3 });
      expect(result.methodology).toContain("Team Engagement Index is computed as");
      expect(result.scores.length).toBe(1);
      expect(result.scores[0]?.projectId).toBe(w.project.id);
    });
  });

  describe("6. Background Worker Layer & In-Memory Queue Fallback", () => {
    it("enqueues jobs and processes them with retry and backoff semantics", async () => {
      let attempts = 0;
      queueService.registerProcessor("iic-test-queue" as any, async (data: { shouldFailTwice: boolean }) => {
        attempts++;
        if (data.shouldFailTwice && attempts < 2) {
          throw new Error("Simulated transient network timeout");
        }
        return "success";
      });

      const { id } = await queueService.enqueue("iic-test-queue" as any, "test-job", {
        shouldFailTwice: true,
      });
      expect(id).toBeDefined();

      // Allow in-memory processor to execute with backoff
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(attempts).toBeGreaterThanOrEqual(2);
    });

    it("reports queue health and engine mode", async () => {
      const health = await queueService.getHealth();
      expect(health).toHaveProperty("redisConfigured");
      expect(health).toHaveProperty("activeMode");
      expect(health).toHaveProperty("workersCount");
    });
  });

  describe("7. HTTP API Integration Endpoints", () => {
    it("enforces admin authorization for integration settings", async () => {
      const w = await world();
      const student = await loginAs(w.member.email);
      const admin = await loginAs(w.admin.email);

      // Student cannot view /api/integrations
      const denied = await student.get("/api/integrations");
      expect(denied.status).toBe(403);

      // Admin can view /api/integrations
      const allowed = await admin.get("/api/integrations");
      expect(allowed.status).toBe(200);
      expect(allowed.body).toHaveProperty("discord");
      expect(allowed.body).toHaveProperty("github");
      expect(allowed.body).toHaveProperty("queue");
    });

    it("configures Discord bot settings and channel mappings via API", async () => {
      const w = await world();
      const admin = await loginAs(w.admin.email);

      // Configure Discord
      const setupRes = await admin.post("/api/integrations/discord/setup").send({
        guildId: "guild-api-1",
        guildName: "Incubation Hub Discord",
        minSessionSeconds: 180,
        countMessages: true,
        retentionDays: 180,
      });
      expect(setupRes.status).toBe(200);
      expect(setupRes.body.integration.guildId).toBe("guild-api-1");

      // Map Channel
      const mapRes = await admin.post("/api/integrations/discord/channels").send({
        channelId: "chan-api-voice",
        name: "Sprint Standup Voice",
        type: "VOICE",
        monitored: true,
        projectId: w.project.id,
      });
      expect(mapRes.status).toBe(200);
      expect(mapRes.body.channel.name).toBe("Sprint Standup Voice");

      // Delete Channel
      const delRes = await admin.delete(`/api/integrations/discord/channels/${mapRes.body.channel.id}`);
      expect(delRes.status).toBe(200);
    });

    it("allows project lead to link and sync GitHub repository for their project", async () => {
      const w = await world();
      const lead = await loginAs(w.lead.email);
      const outsider = await loginAs(w.outsider.email);

      // Outsider cannot link repo for project Alpha
      const forbiddenRes = await outsider.post("/api/integrations/github/link").send({
        projectId: w.project.id,
        owner: "university",
        repo: "unauthorized-link",
      });
      expect(forbiddenRes.status).toBe(403);

      // Project Lead can link repository
      const linkRes = await lead.post("/api/integrations/github/link").send({
        projectId: w.project.id,
        owner: "iic-university",
        repo: "alpha-robotics",
      });
      expect(linkRes.status).toBe(200);
      expect(linkRes.body.linked.repo).toBe("alpha-robotics");

      // Project Lead can unlink repository
      const unlinkRes = await lead.delete(`/api/integrations/github/link/${w.project.id}`);
      expect(unlinkRes.status).toBe(200);
    });

    it("reviews and resolves inactivity alerts", async () => {
      const w = await world();
      const admin = await loginAs(w.admin.email);

      const alert = await prisma.inactivityAlert.create({
        data: {
          projectId: w.project.id,
          reason: "No activity in 14 days",
          status: "OPEN",
        },
      });

      const reviewRes = await admin.post(`/api/integrations/alerts/${alert.id}/review`).send({
        status: "RESOLVED",
        reviewNote: "Reviewed during weekly mentor standup. Team was preparing midterm exams.",
      });

      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body.alert.status).toBe("RESOLVED");
      expect(reviewRes.body.alert.reviewNote).toContain("midterm exams");
    });
  });
});
