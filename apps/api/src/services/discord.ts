import {
  Client,
  GatewayIntentBits,
  type VoiceState,
  type Message,
} from "discord.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { sha256 } from "../lib/crypto.js";
import { logIntegration, queueService, QUEUE_NAMES } from "./queue.js";

export interface VoiceEventData {
  guildId: string;
  channelId: string;
  discordUserId: string;
  eventType: "JOIN" | "LEAVE" | "SWITCH";
  joinedAt?: Date;
  leftAt?: Date;
  oldChannelId?: string;
  eventId?: string;
}

export class DiscordService {
  private client: Client | null = null;
  private isRunning = false;

  getClient(): Client | null {
    return this.client;
  }

  async start(): Promise<void> {
    if (!config.DISCORD_BOT_TOKEN || !config.DISCORD_GUILD_ID) {
      logger.info("Discord bot credentials not configured in environment — bot worker in standby mode");
      return;
    }

    try {
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildVoiceStates,
          GatewayIntentBits.GuildMessages,
        ],
      });

      this.client.on("ready", async () => {
        this.isRunning = true;
        const guild = this.client?.guilds.cache.get(config.DISCORD_GUILD_ID);
        const guildName = guild?.name ?? "Unknown Guild";

        logger.info({ guildName, guildId: config.DISCORD_GUILD_ID }, "Discord bot online and connected");

        await prisma.discordIntegration.upsert({
          where: { guildId: config.DISCORD_GUILD_ID },
          create: {
            guildId: config.DISCORD_GUILD_ID,
            guildName,
            status: "ACTIVE",
            lastHeartbeatAt: new Date(),
          },
          update: {
            guildName,
            status: "ACTIVE",
            lastHeartbeatAt: new Date(),
            lastError: null,
          },
        });

        // Run recovery of abandoned/open voice sessions from previous bot crashes
        await this.recoverOpenVoiceSessions();
      });

      this.client.on("error", async (err) => {
        logger.error({ err: err.message }, "Discord client error");
        await logIntegration("DISCORD", "ERROR", `Discord client error: ${err.message}`);
        await prisma.discordIntegration.updateMany({
          where: { guildId: config.DISCORD_GUILD_ID },
          data: { status: "ERROR", lastError: err.message },
        });
      });

      this.client.on("voiceStateUpdate", (oldState: VoiceState, newState: VoiceState) => {
        void this.handleVoiceStateUpdate(oldState, newState);
      });

      this.client.on("messageCreate", (message: Message) => {
        void this.handleMessageCreate(message);
      });

      await this.client.login(config.DISCORD_BOT_TOKEN);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err: errMsg }, "Failed to login Discord bot");
      await logIntegration("DISCORD", "ERROR", `Discord bot failed to start: ${errMsg}`);
      await prisma.discordIntegration.updateMany({
        where: { guildId: config.DISCORD_GUILD_ID },
        data: { status: "ERROR", lastError: errMsg },
      });
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.client = null;
      this.isRunning = false;
      logger.info("Discord bot disconnected");
    }
  }

  /**
   * Handle voice-state transition from discord.js event
   */
  async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (newState.member?.user.bot || oldState.member?.user.bot) return;

    const guildId = newState.guild.id || oldState.guild.id;
    if (config.DISCORD_GUILD_ID && guildId !== config.DISCORD_GUILD_ID) return;

    const discordUserId = newState.id || oldState.id;
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    if (!oldChannelId && newChannelId) {
      // User Joined
      await queueService.enqueue<VoiceEventData>(QUEUE_NAMES.DISCORD, "voice-join", {
        guildId,
        channelId: newChannelId,
        discordUserId,
        eventType: "JOIN",
        joinedAt: new Date(),
      });
    } else if (oldChannelId && !newChannelId) {
      // User Left
      await queueService.enqueue<VoiceEventData>(QUEUE_NAMES.DISCORD, "voice-leave", {
        guildId,
        channelId: oldChannelId,
        discordUserId,
        eventType: "LEAVE",
        leftAt: new Date(),
      });
    } else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
      // User Switched Channel
      await queueService.enqueue<VoiceEventData>(QUEUE_NAMES.DISCORD, "voice-switch", {
        guildId,
        channelId: newChannelId,
        oldChannelId,
        discordUserId,
        eventType: "SWITCH",
        leftAt: new Date(),
        joinedAt: new Date(),
      });
    }
  }

  /**
   * Privacy-preserving message count telemetry:
   * NEVER reads, inspects or stores message content.
   * NEVER counts private/DM messages.
   */
  async handleMessageCreate(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;
    if (config.DISCORD_GUILD_ID && message.guild.id !== config.DISCORD_GUILD_ID) return;

    await this.processMessageTelemetry({
      guildId: message.guild.id,
      channelId: message.channelId,
      discordUserId: message.author.id,
      timestamp: message.createdAt,
    });
  }

  /**
   * Process a voice join event idempotently
   */
  async processVoiceJoin(event: {
    guildId: string;
    channelId: string;
    discordUserId: string;
    joinedAt: Date;
    eventId?: string;
  }): Promise<{ sessionId: string | null; duplicate: boolean }> {
    const { guildId, channelId, discordUserId, joinedAt } = event;

    // Verify integration configuration
    const integration = await prisma.discordIntegration.findFirst({
      where: { guildId },
      include: { channels: true },
    });

    if (!integration) {
      return { sessionId: null, duplicate: false };
    }

    // Check if channel is monitored
    const channel = integration.channels.find((c) => c.channelId === channelId && c.monitored);
    if (!channel) {
      return { sessionId: null, duplicate: false };
    }

    // Idempotency key derived from guild, channel, user, and join instant
    const externalKey = sha256(`voice-join:${guildId}:${channelId}:${discordUserId}:${joinedAt.getTime()}`);

    const existing = await prisma.discordVoiceSession.findUnique({
      where: { externalKey },
    });
    if (existing) {
      return { sessionId: existing.id, duplicate: true };
    }

    // Resolve user mapping if linked
    const user = await prisma.user.findFirst({
      where: { discordUserId },
      select: { id: true },
    });

    const session = await prisma.discordVoiceSession.create({
      data: {
        integrationId: integration.id,
        discordUserId,
        userId: user?.id ?? null,
        projectId: channel.projectId ?? null,
        channelId,
        joinedAt,
        status: "OPEN",
        externalKey,
      },
    });

    return { sessionId: session.id, duplicate: false };
  }

  /**
   * Process a voice leave event, calculate duration, and update daily aggregates
   */
  async processVoiceLeave(event: {
    guildId: string;
    channelId: string;
    discordUserId: string;
    leftAt: Date;
  }): Promise<{ sessionId: string | null; durationSeconds: number; status: string }> {
    const { guildId, channelId, discordUserId, leftAt } = event;

    const integration = await prisma.discordIntegration.findFirst({
      where: { guildId },
    });
    if (!integration) {
      return { sessionId: null, durationSeconds: 0, status: "NOT_FOUND" };
    }

    // Find the latest open session for this user in this channel
    const session = await prisma.discordVoiceSession.findFirst({
      where: {
        integrationId: integration.id,
        discordUserId,
        channelId,
        status: "OPEN",
      },
      orderBy: { joinedAt: "desc" },
    });

    if (!session) {
      // Missing join event (e.g. joined before bot restarted)
      return { sessionId: null, durationSeconds: 0, status: "NO_OPEN_SESSION" };
    }

    const durationSeconds = Math.max(0, Math.round((leftAt.getTime() - session.joinedAt.getTime()) / 1000));
    const minSeconds = integration.minSessionSeconds ?? 300;
    const status = durationSeconds >= minSeconds ? "VERIFIED" : "INCOMPLETE";
    const closeReason = durationSeconds >= minSeconds ? "normal_leave" : "below_minimum_duration";

    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.discordVoiceSession.update({
        where: { id: session.id },
        data: {
          leftAt,
          durationSeconds,
          status,
          closeReason,
        },
      });

      // Update daily aggregated telemetry
      const dayDate = new Date(Date.UTC(leftAt.getUTCFullYear(), leftAt.getUTCMonth(), leftAt.getUTCDate()));

      await tx.discordActivityDaily.upsert({
        where: {
          date_channelId_discordUserId: {
            date: dayDate,
            channelId,
            discordUserId,
          },
        },
        create: {
          date: dayDate,
          channelId,
          discordUserId,
          projectId: session.projectId,
          voiceSeconds: durationSeconds,
          messageCount: 0,
        },
        update: {
          voiceSeconds: { increment: durationSeconds },
          ...(session.projectId ? { projectId: session.projectId } : {}),
        },
      });

      return s;
    });

    return { sessionId: updated.id, durationSeconds, status };
  }

  /**
   * Aggregate message telemetry without content
   */
  async processMessageTelemetry(event: {
    guildId: string;
    channelId: string;
    discordUserId: string;
    timestamp?: Date;
  }): Promise<boolean> {
    const { guildId, channelId, discordUserId, timestamp = new Date() } = event;

    const integration = await prisma.discordIntegration.findFirst({
      where: { guildId },
      include: { channels: true },
    });

    if (!integration || !integration.countMessages) return false;

    const channel = integration.channels.find((c) => c.channelId === channelId && c.monitored);
    if (!channel) return false;

    const dayDate = new Date(Date.UTC(timestamp.getUTCFullYear(), timestamp.getUTCMonth(), timestamp.getUTCDate()));

    await prisma.discordActivityDaily.upsert({
      where: {
        date_channelId_discordUserId: {
          date: dayDate,
          channelId,
          discordUserId,
        },
      },
      create: {
        date: dayDate,
        channelId,
        discordUserId,
        projectId: channel.projectId,
        voiceSeconds: 0,
        messageCount: 1,
      },
      update: {
        messageCount: { increment: 1 },
        ...(channel.projectId ? { projectId: channel.projectId } : {}),
      },
    });

    return true;
  }

  /**
   * Safe bot-restart / crashed session recovery:
   * Close any open voice sessions left open longer than maxHours or when bot restarts
   */
  async recoverOpenVoiceSessions(maxHours = 4): Promise<number> {
    const cutoff = new Date(Date.now() - maxHours * 3600_000);
    const abandonedSessions = await prisma.discordVoiceSession.findMany({
      where: {
        status: "OPEN",
        joinedAt: { lt: cutoff },
      },
      take: 100,
    });

    let recoveredCount = 0;
    for (const session of abandonedSessions) {
      const estimatedDuration = Math.min(3600, Math.round((Date.now() - session.joinedAt.getTime()) / 1000));
      await prisma.discordVoiceSession.update({
        where: { id: session.id },
        data: {
          status: "ESTIMATED",
          closeReason: "bot_restart_recovery",
          durationSeconds: estimatedDuration,
          leftAt: new Date(session.joinedAt.getTime() + estimatedDuration * 1000),
        },
      });
      recoveredCount++;
    }

    if (recoveredCount > 0) {
      logger.info({ recoveredCount }, "Recovered abandoned open Discord voice sessions");
      await logIntegration("DISCORD", "INFO", `Recovered ${recoveredCount} abandoned voice sessions on restart`);
    }

    return recoveredCount;
  }

  /**
   * Purge telemetry older than retentionDays
   */
  async purgeOldTelemetry(retentionDays = 365): Promise<{ purgedSessions: number; purgedDaily: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 86400_000);

    const [sessions, daily] = await prisma.$transaction([
      prisma.discordVoiceSession.deleteMany({
        where: { joinedAt: { lt: cutoff } },
      }),
      prisma.discordActivityDaily.deleteMany({
        where: { date: { lt: cutoff } },
      }),
    ]);

    return { purgedSessions: sessions.count, purgedDaily: daily.count };
  }
}

export const discordService = new DiscordService();
