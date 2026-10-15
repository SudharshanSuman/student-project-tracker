import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import type { Redis } from "ioredis";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";

export type IntegrationKind = "DISCORD" | "GITHUB" | "EMAIL" | "REPORTS";
export type LogLevel = "INFO" | "WARN" | "ERROR";

/**
 * Record an integration event/error into IntegrationLog and logger.
 */
export async function logIntegration(
  integration: IntegrationKind,
  level: LogLevel,
  message: string,
  context?: Record<string, unknown> | null,
): Promise<void> {
  try {
    const logMethod = level === "ERROR" ? logger.error : level === "WARN" ? logger.warn : logger.info;
    logMethod.call(logger, { integration, ...(context ?? {}) }, message);

    await prisma.integrationLog.create({
      data: {
        integration,
        level,
        message,
        context: context ? JSON.parse(JSON.stringify(context)) : undefined,
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to write IntegrationLog to database");
  }
}

export const QUEUE_NAMES = {
  DISCORD: "iic-discord",
  GITHUB: "iic-github",
  MAINTENANCE: "iic-maintenance",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// In-memory fallback job representation
interface InMemoryJob<T = unknown> {
  id: string;
  name: string;
  data: T;
  attemptsMade: number;
  maxAttempts: number;
  backoffDelayMs: number;
  addedAt: Date;
}

class QueueService {
  private redisConnection: Redis | null = null;
  private bullQueues = new Map<string, Queue>();
  private bullWorkers = new Map<string, Worker>();
  private inMemoryProcessors = new Map<string, (job: InMemoryJob<unknown>) => Promise<unknown>>();
  private inMemoryQueue: InMemoryJob<unknown>[] = [];
  private isProcessingInMemory = false;
  private isConnected = false;

  async init(): Promise<void> {
    if (config.REDIS_URL && !config.isTest) {
      try {
        const { default: IORedis } = await import("ioredis");
        const client = new IORedis(config.REDIS_URL, {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy(times) {
            return Math.min(times * 200, 3000);
          },
        });

        client.on("connect", () => {
          this.isConnected = true;
          logger.info("Connected to Redis for BullMQ background workers");
        });

        client.on("error", (err) => {
          this.isConnected = false;
          logger.warn({ err: err.message }, "Redis connection error; workers using in-memory fallback");
        });

        this.redisConnection = client;

        for (const name of Object.values(QUEUE_NAMES)) {
          const q = new Queue(name, {
            connection: client as unknown as ConnectionOptions,
            defaultJobOptions: {
              attempts: 3,
              backoff: { type: "exponential", delay: 1000 },
              removeOnComplete: { count: 100 },
              removeOnFail: { count: 200 },
            },
          });
          this.bullQueues.set(name, q);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ err: msg }, "Failed to initialize Redis connection; using in-memory queue fallback");
      }
    }
  }

  registerProcessor<T>(queueName: QueueName, processor: (data: T, jobContext: { id: string; name: string }) => Promise<unknown>): void {
    if (this.bullQueues.has(queueName) && this.redisConnection && this.isConnected) {
      try {
        const worker = new Worker(
          queueName,
          async (job: Job) => {
            return processor(job.data as T, { id: job.id ?? "unknown", name: job.name });
          },
          { connection: this.redisConnection as unknown as ConnectionOptions, concurrency: 5 },
        );

        worker.on("failed", async (job, err) => {
          logger.error({ queue: queueName, jobId: job?.id, jobName: job?.name, err: err.message }, "BullMQ job failed");
          if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
            const kind: IntegrationKind = queueName === QUEUE_NAMES.DISCORD ? "DISCORD" : "GITHUB";
            await logIntegration(kind, "ERROR", `Worker job ${job.name} exhausted all retries: ${err.message}`, {
              jobId: job.id,
              data: job.data as Record<string, unknown>,
              attemptsMade: job.attemptsMade,
            });
          }
        });

        this.bullWorkers.set(queueName, worker);
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ queue: queueName, err: msg }, "Failed to start BullMQ worker; falling back to in-memory processor");
      }
    }

    // In-memory fallback
    this.inMemoryProcessors.set(queueName, async (job) => {
      return processor(job.data as T, { id: job.id, name: job.name });
    });
  }

  async enqueue<T>(
    queueName: QueueName,
    jobName: string,
    data: T,
    options: { jobId?: string; delay?: number; attempts?: number } = {},
  ): Promise<{ id: string; mode: "bullmq" | "in-memory" }> {
    const bullQueue = this.bullQueues.get(queueName);
    if (bullQueue && this.isConnected) {
      try {
        const job = await bullQueue.add(jobName, data, {
          jobId: options.jobId,
          delay: options.delay,
          attempts: options.attempts ?? 3,
        });
        return { id: job.id ?? "unknown", mode: "bullmq" };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ err: msg }, "Failed to enqueue into BullMQ; falling back to in-memory queue");
      }
    }

    // In-memory queue implementation with deduplication, retries, and backoff
    const jobId = options.jobId || `${jobName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Check deduplication if jobId is provided
    if (options.jobId && this.inMemoryQueue.some((j) => j.id === options.jobId)) {
      return { id: options.jobId, mode: "in-memory" };
    }

    const job: InMemoryJob<unknown> = {
      id: jobId,
      name: jobName,
      data,
      attemptsMade: 0,
      maxAttempts: options.attempts ?? 3,
      backoffDelayMs: 500,
      addedAt: new Date(),
    };

    if (options.delay && options.delay > 0) {
      setTimeout(() => {
        this.inMemoryQueue.push(job);
        void this.drainInMemoryQueue(queueName);
      }, options.delay);
    } else {
      this.inMemoryQueue.push(job);
      void this.drainInMemoryQueue(queueName);
    }

    return { id: jobId, mode: "in-memory" };
  }

  private async drainInMemoryQueue(queueName: QueueName): Promise<void> {
    if (this.isProcessingInMemory) return;
    this.isProcessingInMemory = true;

    try {
      while (this.inMemoryQueue.length > 0) {
        const job = this.inMemoryQueue.shift();
        if (!job) break;

        const processor = this.inMemoryProcessors.get(queueName);
        if (!processor) {
          logger.warn({ queueName, jobName: job.name }, "No processor registered for queue; dropping job");
          continue;
        }

        try {
          job.attemptsMade++;
          await processor(job);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(
            { queue: queueName, jobId: job.id, jobName: job.name, attempt: job.attemptsMade, err: msg },
            "In-memory job processing failed",
          );

          if (job.attemptsMade < job.maxAttempts) {
            // Exponential backoff
            const delay = job.backoffDelayMs * Math.pow(2, job.attemptsMade - 1);
            setTimeout(() => {
              this.inMemoryQueue.push(job);
              void this.drainInMemoryQueue(queueName);
            }, delay);
          } else {
            const kind: IntegrationKind = queueName === QUEUE_NAMES.DISCORD ? "DISCORD" : "GITHUB";
            await logIntegration(
              kind,
              "ERROR",
              `In-memory job ${job.name} (${job.id}) failed after ${job.attemptsMade} attempts: ${msg}`,
              { jobId: job.id, name: job.name, data: job.data as Record<string, unknown> },
            );
          }
        }
      }
    } finally {
      this.isProcessingInMemory = false;
    }
  }

  async getHealth(): Promise<{
    redisConfigured: boolean;
    redisConnected: boolean;
    activeMode: "bullmq" | "in-memory";
    workersCount: number;
    pendingJobsCount: number;
  }> {
    return {
      redisConfigured: Boolean(config.REDIS_URL),
      redisConnected: this.isConnected,
      activeMode: this.isConnected ? "bullmq" : "in-memory",
      workersCount: this.bullWorkers.size || this.inMemoryProcessors.size,
      pendingJobsCount: this.inMemoryQueue.length,
    };
  }

  async close(): Promise<void> {
    for (const worker of this.bullWorkers.values()) {
      await worker.close();
    }
    for (const queue of this.bullQueues.values()) {
      await queue.close();
    }
    if (this.redisConnection) {
      this.redisConnection.disconnect();
    }
    this.bullWorkers.clear();
    this.bullQueues.clear();
    this.inMemoryQueue = [];
    this.isConnected = false;
  }
}

export const queueService = new QueueService();
