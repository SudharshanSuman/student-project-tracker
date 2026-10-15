import { config } from "../config.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { decryptCredential, encryptCredential, verifyGitHubWebhookSignature } from "../lib/crypto.js";
import { logIntegration, queueService, QUEUE_NAMES } from "./queue.js";

export interface GitHubRepoSyncData {
  projectId: string;
  owner: string;
  repo: string;
  manual?: boolean;
}

export interface GitHubWebhookPayload {
  action?: string;
  repository?: {
    name: string;
    owner: { login: string; name?: string };
    default_branch?: string;
  };
  head_commit?: {
    id: string;
    timestamp: string;
    message?: string;
  };
  commits?: Array<{
    id: string;
    timestamp: string;
  }>;
  pull_request?: {
    id: number;
    merged: boolean;
    created_at: string;
    merged_at?: string | null;
  };
}

export class GitHubService {
  /**
   * Resolve credentials securely.
   * Priority: per-project encrypted token in PlatformSetting, fallback to GITHUB_TOKEN in config.
   */
  async resolveToken(projectId?: string): Promise<string | null> {
    if (projectId) {
      try {
        const setting = await prisma.platformSetting.findUnique({
          where: { key: `credential.github.${projectId}` },
        });
        if (setting && typeof setting.value === "string") {
          return decryptCredential(setting.value);
        }
      } catch (err) {
        logger.warn({ projectId, err }, "Failed to decrypt per-project GitHub credential; falling back to global token");
      }
    }
    return config.GITHUB_TOKEN || null;
  }

  /**
   * Resolve webhook secret for HMAC verification
   */
  async resolveWebhookSecret(projectId?: string): Promise<string | null> {
    if (projectId) {
      try {
        const setting = await prisma.platformSetting.findUnique({
          where: { key: `webhook.secret.github.${projectId}` },
        });
        if (setting && typeof setting.value === "string") {
          return decryptCredential(setting.value);
        }
      } catch (err) {
        logger.warn({ projectId, err }, "Failed to decrypt GitHub webhook secret");
      }
    }
    return process.env.GITHUB_WEBHOOK_SECRET || null;
  }

  /**
   * Link a GitHub repository to an existing Project.
   * Securely encrypts any token/secret at rest.
   */
  async linkRepository(params: {
    projectId: string;
    owner: string;
    repo: string;
    token?: string;
    webhookSecret?: string;
  }): Promise<{ id: string; owner: string; repo: string }> {
    const { projectId, owner, repo, token, webhookSecret } = params;

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new Error("Project not found");

    if (token) {
      const encrypted = encryptCredential(token.trim());
      await prisma.platformSetting.upsert({
        where: { key: `credential.github.${projectId}` },
        create: { key: `credential.github.${projectId}`, value: encrypted },
        update: { value: encrypted },
      });
    }

    if (webhookSecret) {
      const encryptedSecret = encryptCredential(webhookSecret.trim());
      await prisma.platformSetting.upsert({
        where: { key: `webhook.secret.github.${projectId}` },
        create: { key: `webhook.secret.github.${projectId}`, value: encryptedSecret },
        update: { value: encryptedSecret },
      });
    }

    const integration = await prisma.gitHubIntegration.upsert({
      where: { projectId },
      create: {
        projectId,
        owner: owner.trim(),
        repo: repo.trim(),
        status: "NOT_CONFIGURED",
      },
      update: {
        owner: owner.trim(),
        repo: repo.trim(),
        lastError: null,
      },
    });

    // Update project repoUrl if not set
    if (!project.repoUrl) {
      await prisma.project.update({
        where: { id: projectId },
        data: { repoUrl: `https://github.com/${owner.trim()}/${repo.trim()}` },
      });
    }

    // Trigger initial background sync
    await queueService.enqueue<GitHubRepoSyncData>(QUEUE_NAMES.GITHUB, "sync-repo", {
      projectId,
      owner: owner.trim(),
      repo: repo.trim(),
    });

    await logIntegration("GITHUB", "INFO", `Linked repository ${owner}/${repo} to project ${project.name}`, {
      projectId,
      owner,
      repo,
    });

    return { id: integration.id, owner: integration.owner, repo: integration.repo };
  }

  /**
   * Unlink a GitHub repository
   */
  async unlinkRepository(projectId: string): Promise<void> {
    await prisma.$transaction([
      prisma.gitHubIntegration.deleteMany({ where: { projectId } }),
      prisma.platformSetting.deleteMany({
        where: { key: { in: [`credential.github.${projectId}`, `webhook.secret.github.${projectId}`] } },
      }),
    ]);

    await logIntegration("GITHUB", "INFO", `Unlinked GitHub repository from project ${projectId}`);
  }

  /**
   * Perform GitHub repository sync (metadata, commits, PRs)
   */
  async syncRepository(data: GitHubRepoSyncData): Promise<{
    success: boolean;
    defaultBranch?: string;
    commitsCount?: number;
    error?: string;
  }> {
    const { projectId, owner, repo } = data;

    const token = await this.resolveToken(projectId);
    if (!token) {
      const err = "No GitHub token configured. Set GITHUB_TOKEN or link with scoped token.";
      await prisma.gitHubIntegration.updateMany({
        where: { projectId },
        data: { status: "NOT_CONFIGURED", lastError: err },
      });
      return { success: false, error: err };
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "IIC-Platform/1.0",
    };

    try {
      // 1. Fetch Repository Metadata
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });

      if (repoRes.status === 401 || repoRes.status === 403) {
        const remaining = repoRes.headers.get("x-ratelimit-remaining");
        const resetAt = repoRes.headers.get("x-ratelimit-reset");
        const errMsg = remaining === "0" ? `GitHub rate limit exceeded. Resets at ${resetAt}` : "GitHub authentication failed. Check token permissions.";
        await prisma.gitHubIntegration.updateMany({
          where: { projectId },
          data: { status: "ERROR", lastError: errMsg },
        });
        await logIntegration("GITHUB", "WARN", errMsg, { projectId, owner, repo, status: repoRes.status });
        return { success: false, error: errMsg };
      }

      if (repoRes.status === 404) {
        const errMsg = `Repository ${owner}/${repo} not found or token lacks access.`;
        await prisma.gitHubIntegration.updateMany({
          where: { projectId },
          data: { status: "ERROR", lastError: errMsg },
        });
        await logIntegration("GITHUB", "WARN", errMsg, { projectId, owner, repo });
        return { success: false, error: errMsg };
      }

      if (!repoRes.ok) {
        throw new Error(`GitHub API error ${repoRes.status}: ${repoRes.statusText}`);
      }

      const repoData = (await repoRes.json()) as { default_branch?: string };
      const defaultBranch = repoData.default_branch || "main";

      // 2. Fetch recent commits (last 30 days)
      const sinceDate = new Date(Date.now() - 30 * 86400_000).toISOString();
      const commitsRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(defaultBranch)}&since=${sinceDate}&per_page=100`,
        { headers },
      );

      let latestCommitAt: Date | null = null;
      const commitsByDay = new Map<string, number>();

      if (commitsRes.ok) {
        const commits = (await commitsRes.json()) as Array<{
          commit?: { author?: { date?: string }; committer?: { date?: string } };
        }>;
        for (const c of commits) {
          const dateStr = c.commit?.author?.date || c.commit?.committer?.date;
          if (dateStr) {
            const dateObj = new Date(dateStr);
            if (!latestCommitAt || dateObj > latestCommitAt) {
              latestCommitAt = dateObj;
            }
            const dayKey = dateObj.toISOString().slice(0, 10);
            commitsByDay.set(dayKey, (commitsByDay.get(dayKey) ?? 0) + 1);
          }
        }
      }

      // 3. Fetch Pull Requests activity (last 30 days)
      const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=50`, {
        headers,
      });

      const prOpenedByDay = new Map<string, number>();
      const prMergedByDay = new Map<string, number>();

      if (prRes.ok) {
        const prs = (await prRes.json()) as Array<{
          created_at?: string;
          merged_at?: string | null;
        }>;
        for (const pr of prs) {
          if (pr.created_at) {
            const dayKey = new Date(pr.created_at).toISOString().slice(0, 10);
            prOpenedByDay.set(dayKey, (prOpenedByDay.get(dayKey) ?? 0) + 1);
          }
          if (pr.merged_at) {
            const dayKey = new Date(pr.merged_at).toISOString().slice(0, 10);
            prMergedByDay.set(dayKey, (prMergedByDay.get(dayKey) ?? 0) + 1);
          }
        }
      }

      // 4. Upsert Integration and Daily Summaries in a transaction
      const integration = await prisma.gitHubIntegration.findUnique({
        where: { projectId },
      });
      if (!integration) return { success: false, error: "Integration removed during sync" };

      await prisma.$transaction(async (tx) => {
        await tx.gitHubIntegration.update({
          where: { id: integration.id },
          data: {
            defaultBranch,
            status: "ACTIVE",
            latestCommitAt: latestCommitAt ?? integration.latestCommitAt,
            lastSyncedAt: new Date(),
            lastError: null,
          },
        });

        // Collect all dates
        const allDates = new Set([...commitsByDay.keys(), ...prOpenedByDay.keys(), ...prMergedByDay.keys()]);
        for (const dateStr of allDates) {
          const dateObj = new Date(`${dateStr}T00:00:00.000Z`);
          const commitCount = commitsByDay.get(dateStr) ?? 0;
          const prOpened = prOpenedByDay.get(dateStr) ?? 0;
          const prMerged = prMergedByDay.get(dateStr) ?? 0;

          await tx.repositoryActivityDaily.upsert({
            where: {
              githubIntegrationId_date: {
                githubIntegrationId: integration.id,
                date: dateObj,
              },
            },
            create: {
              githubIntegrationId: integration.id,
              date: dateObj,
              commitCount,
              prOpened,
              prMerged,
            },
            update: {
              commitCount,
              prOpened,
              prMerged,
            },
          });
        }
      });

      await logIntegration("GITHUB", "INFO", `Successfully synced ${owner}/${repo}`, {
        projectId,
        commitsSynced: commitsByDay.size,
        latestCommitAt,
      });

      return {
        success: true,
        defaultBranch,
        commitsCount: commitsByDay.size,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ projectId, owner, repo, err: errMsg }, "Failed to sync GitHub repository");
      await prisma.gitHubIntegration.updateMany({
        where: { projectId },
        data: { status: "ERROR", lastError: errMsg },
      });
      await logIntegration("GITHUB", "ERROR", `Failed to sync ${owner}/${repo}: ${errMsg}`, {
        projectId,
        owner,
        repo,
      });
      return { success: false, error: errMsg };
    }
  }

  /**
   * Handle incoming GitHub Webhook with signature validation and duplicate event deduplication
   */
  async handleWebhook(params: {
    rawBody: Buffer | string;
    signatureHeader?: string | null;
    eventHeader?: string | null;
    deliveryId?: string | null;
    payload: GitHubWebhookPayload;
  }): Promise<{ accepted: boolean; message: string }> {
    const { rawBody, signatureHeader, eventHeader, deliveryId, payload } = params;

    // Delivery ID is used for duplicate prevention
    if (deliveryId) {
      const duplicate = await prisma.processedExternalEvent.findUnique({
        where: {
          source_externalId: {
            source: "GITHUB",
            externalId: deliveryId,
          },
        },
      });
      if (duplicate) {
        return { accepted: true, message: "Duplicate event suppressed" };
      }
    }

    const repoOwner = payload.repository?.owner?.login;
    const repoName = payload.repository?.name;

    if (!repoOwner || !repoName) {
      return { accepted: false, message: "Missing repository information in webhook payload" };
    }

    const integration = await prisma.gitHubIntegration.findFirst({
      where: { owner: repoOwner, repo: repoName },
    });

    if (!integration) {
      return { accepted: false, message: "Repository not linked to any project" };
    }

    // Resolve webhook secret for HMAC verification
    const secret = await this.resolveWebhookSecret(integration.projectId);
    if (secret) {
      const isValid = verifyGitHubWebhookSignature(rawBody, secret, signatureHeader);
      if (!isValid) {
        await logIntegration("GITHUB", "WARN", `Rejected webhook for ${repoOwner}/${repoName}: invalid signature`, {
          deliveryId,
        });
        return { accepted: false, message: "Invalid signature" };
      }
    }

    // Process event
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    await prisma.$transaction(async (tx) => {
      if (deliveryId) {
        await tx.processedExternalEvent.create({
          data: {
            source: "GITHUB",
            externalId: deliveryId,
          },
        });
      }

      if (eventHeader === "push") {
        const commitCount = payload.commits?.length ?? (payload.head_commit ? 1 : 0);
        const commitDate = payload.head_commit?.timestamp ? new Date(payload.head_commit.timestamp) : now;

        await tx.gitHubIntegration.update({
          where: { id: integration.id },
          data: {
            latestCommitAt: commitDate,
            lastSyncedAt: now,
            status: "ACTIVE",
          },
        });

        await tx.repositoryActivityDaily.upsert({
          where: {
            githubIntegrationId_date: {
              githubIntegrationId: integration.id,
              date: today,
            },
          },
          create: {
            githubIntegrationId: integration.id,
            date: today,
            commitCount,
            prOpened: 0,
            prMerged: 0,
          },
          update: {
            commitCount: { increment: commitCount },
          },
        });
      } else if (eventHeader === "pull_request") {
        const isOpened = payload.action === "opened";
        const isMerged = payload.action === "closed" && Boolean(payload.pull_request?.merged);

        await tx.repositoryActivityDaily.upsert({
          where: {
            githubIntegrationId_date: {
              githubIntegrationId: integration.id,
              date: today,
            },
          },
          create: {
            githubIntegrationId: integration.id,
            date: today,
            commitCount: 0,
            prOpened: isOpened ? 1 : 0,
            prMerged: isMerged ? 1 : 0,
          },
          update: {
            ...(isOpened ? { prOpened: { increment: 1 } } : {}),
            ...(isMerged ? { prMerged: { increment: 1 } } : {}),
          },
        });
      }
    });

    await logIntegration("GITHUB", "INFO", `Processed webhook ${eventHeader} for ${repoOwner}/${repoName}`, {
      deliveryId,
      event: eventHeader,
    });

    return { accepted: true, message: "Webhook processed" };
  }
}

export const githubService = new GitHubService();
