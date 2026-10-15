import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { logIntegration, queueService, QUEUE_NAMES } from "./queue.js";
import { discordService, type VoiceEventData } from "./discord.js";
import { githubService, type GitHubRepoSyncData } from "./github.js";

export interface EngagementWeights {
  voice: number;
  messages: number;
  tasks: number;
}

export const DEFAULT_ENGAGEMENT_WEIGHTS: EngagementWeights = {
  voice: 0.5,
  messages: 0.2,
  tasks: 0.3,
};

export class TelemetryService {
  /**
   * Register queue processors for all background workers
   */
  registerQueueWorkers(): void {
    // Discord Queue Processor
    queueService.registerProcessor<VoiceEventData>(QUEUE_NAMES.DISCORD, async (data, jobContext) => {
      logger.debug({ job: jobContext.name, data }, "Processing Discord queue job");
      if (data.eventType === "JOIN") {
        await discordService.processVoiceJoin({
          guildId: data.guildId,
          channelId: data.channelId,
          discordUserId: data.discordUserId,
          joinedAt: data.joinedAt ? new Date(data.joinedAt) : new Date(),
          eventId: data.eventId,
        });
      } else if (data.eventType === "LEAVE") {
        await discordService.processVoiceLeave({
          guildId: data.guildId,
          channelId: data.channelId,
          discordUserId: data.discordUserId,
          leftAt: data.leftAt ? new Date(data.leftAt) : new Date(),
        });
      } else if (data.eventType === "SWITCH" && data.oldChannelId) {
        await discordService.processVoiceLeave({
          guildId: data.guildId,
          channelId: data.oldChannelId,
          discordUserId: data.discordUserId,
          leftAt: data.leftAt ? new Date(data.leftAt) : new Date(),
        });
        await discordService.processVoiceJoin({
          guildId: data.guildId,
          channelId: data.channelId,
          discordUserId: data.discordUserId,
          joinedAt: data.joinedAt ? new Date(data.joinedAt) : new Date(),
        });
      }
    });

    // GitHub Queue Processor
    queueService.registerProcessor<GitHubRepoSyncData>(QUEUE_NAMES.GITHUB, async (data, jobContext) => {
      logger.debug({ job: jobContext.name, data }, "Processing GitHub sync queue job");
      await githubService.syncRepository(data);
    });

    // Maintenance Queue Processor
    queueService.registerProcessor<{ action: string; maxDays?: number }>(QUEUE_NAMES.MAINTENANCE, async (data) => {
      if (data.action === "inactivity-check") {
        await this.scanInactivityAlerts(data.maxDays ?? 14);
      } else if (data.action === "retention-cleanup") {
        await discordService.purgeOldTelemetry(data.maxDays ?? 365);
      } else if (data.action === "recover-sessions") {
        await discordService.recoverOpenVoiceSessions();
      }
    });

    logger.info("Background queue workers registered for Discord, GitHub, and Maintenance");
  }

  /**
   * Get configured engagement weights
   */
  async getEngagementWeights(): Promise<EngagementWeights> {
    const setting = await prisma.platformSetting.findUnique({
      where: { key: "engagement.weights" },
    });
    if (setting && typeof setting.value === "object" && setting.value !== null) {
      const v = setting.value as Record<string, unknown>;
      if (typeof v["voice"] === "number" && typeof v["messages"] === "number" && typeof v["tasks"] === "number") {
        return { voice: v["voice"], messages: v["messages"], tasks: v["tasks"] };
      }
    }
    return DEFAULT_ENGAGEMENT_WEIGHTS;
  }

  /**
   * Update engagement weights
   */
  async setEngagementWeights(weights: EngagementWeights): Promise<EngagementWeights> {
    const value = weights as unknown as Prisma.InputJsonValue;
    await prisma.platformSetting.upsert({
      where: { key: "engagement.weights" },
      create: { key: "engagement.weights", value },
      update: { value },
    });
    return weights;
  }

  /**
   * Calculate Team Engagement Index for projects over a 30-day window
   */
  async calculateTeamEngagement(projectIds: string[], windowDays = 30): Promise<{
    methodology: string;
    weights: EngagementWeights;
    scores: Array<{
      projectId: string;
      voiceHours: number;
      messageCount: number;
      taskCompletionRate: number;
      engagementScore: number;
    }>;
  }> {
    const weights = await this.getEngagementWeights();
    const since = new Date(Date.now() - windowDays * 86400_000);

    const [dailyDiscord, tasks] = await Promise.all([
      prisma.discordActivityDaily.groupBy({
        by: ["projectId"],
        where: { projectId: { in: projectIds }, date: { gte: since } },
        _sum: { voiceSeconds: true, messageCount: true },
      }),
      prisma.task.findMany({
        where: { projectId: { in: projectIds } },
        select: { projectId: true, status: true },
      }),
    ]);

    const discordMap = new Map(dailyDiscord.map((d) => [d.projectId, {
      voiceSeconds: d._sum.voiceSeconds ?? 0,
      messages: d._sum.messageCount ?? 0,
    }]));

    const taskMap = new Map<string, { total: number; done: number }>();
    for (const t of tasks) {
      const entry = taskMap.get(t.projectId) ?? { total: 0, done: 0 };
      entry.total++;
      if (t.status === "DONE") entry.done++;
      taskMap.set(t.projectId, entry);
    }

    const scores = projectIds.map((projectId) => {
      const d = discordMap.get(projectId) ?? { voiceSeconds: 0, messages: 0 };
      const voiceHours = Math.round((d.voiceSeconds / 3600) * 10) / 10;
      const messageCount = d.messages;
      const t = taskMap.get(projectId) ?? { total: 0, done: 0 };
      const taskCompletionRate = t.total > 0 ? Math.round((t.done / t.total) * 100) : 0;

      // Normalization benchmarks:
      // Voice: benchmark is 20 hours over 30 days = 100%
      // Messages: benchmark is 100 messages over 30 days = 100%
      // Task completion: 0-100%
      const normVoice = Math.min(100, (voiceHours / 20) * 100);
      const normMessages = Math.min(100, (messageCount / 100) * 100);
      const normTasks = taskCompletionRate;

      const engagementScore = Math.round(
        weights.voice * normVoice + weights.messages * normMessages + weights.tasks * normTasks,
      );

      return {
        projectId,
        voiceHours,
        messageCount,
        taskCompletionRate,
        engagementScore,
      };
    });

    const methodology = `Team Engagement Index is computed as (${weights.voice} × voice presence + ${weights.messages} × messages + ${weights.tasks} × task completion). It serves as an administrative operational indicator to identify teams that may require mentoring or additional resources, and is never used as an individual competence measure.`;

    return { methodology, weights, scores };
  }

  /**
   * Scan for project inactivity across Discord, GitHub, and Tasks
   */
  async scanInactivityAlerts(inactiveDays = 14): Promise<number> {
    const cutoff = new Date(Date.now() - inactiveDays * 86400_000);

    const activeProjects = await prisma.project.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        github: { select: { latestCommitAt: true } },
      },
    });

    let newAlertsCount = 0;

    for (const project of activeProjects) {
      // Check open alerts
      const existingAlert = await prisma.inactivityAlert.findFirst({
        where: { projectId: project.id, status: "OPEN" },
      });
      if (existingAlert) continue;

      // Check Discord activity
      const recentDiscord = await prisma.discordActivityDaily.findFirst({
        where: { projectId: project.id, date: { gte: cutoff } },
      });

      // Check GitHub activity
      const hasRecentCommit = project.github?.latestCommitAt && project.github.latestCommitAt >= cutoff;

      // Check Task activity
      const recentTask = await prisma.taskStatusHistory.findFirst({
        where: { task: { projectId: project.id }, changedAt: { gte: cutoff } },
      });

      if (!recentDiscord && !hasRecentCommit && !recentTask) {
        await prisma.inactivityAlert.create({
          data: {
            projectId: project.id,
            reason: `No voice presence, repository commits, or task transitions recorded in the past ${inactiveDays} days.`,
            status: "OPEN",
          },
        });
        newAlertsCount++;
      }
    }

    if (newAlertsCount > 0) {
      logger.info({ newAlertsCount }, "Generated inactivity alerts for stalled projects");
      await logIntegration("DISCORD", "WARN", `Generated ${newAlertsCount} inactivity alerts`);
    }

    return newAlertsCount;
  }
}

export const telemetryService = new TelemetryService();
