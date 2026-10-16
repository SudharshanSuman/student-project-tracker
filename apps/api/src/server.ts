import { createServer } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { logger } from "./logger.js";
import { attachRealtime } from "./realtime.js";
import { queueService } from "./services/queue.js";
import { telemetryService } from "./services/telemetry.js";
import { discordService } from "./services/discord.js";
import { closeBrowserPool, resolveChromePath } from "./reports/browser-pool.js";
import { startReportWorker, stopReportWorker } from "./reports/queue.js";

const app = createApp();
const server = createServer(app);
attachRealtime(server);

// Boot background workers & integrations
async function bootServices() {
  await queueService.init();
  telemetryService.registerQueueWorkers();
  await discordService.start();
}

server.listen(config.API_PORT, async () => {
  logger.info({ port: config.API_PORT, env: config.NODE_ENV }, "IIC API listening");
  if (!config.integrations.discordConfigured) logger.warn("Discord credentials not set — Discord telemetry standby mode (see docs/INTEGRATIONS.md)");
  if (!config.integrations.githubConfigured) logger.warn("GITHUB_TOKEN not set — GitHub sync standby mode");
  if (!resolveChromePath()) logger.warn("No Chrome/Chromium found — PDF reports will fail until PUPPETEER_EXECUTABLE_PATH is set");

  // PDF reports use their own Postgres queue; start them independently of the integration services,
  // so a Discord/Redis boot failure can never stop report generation.
  if (config.REPORT_WORKER === "true") startReportWorker();

  await bootServices();
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close();
  await discordService.stop();
  await queueService.close();
  stopReportWorker();
  await closeBrowserPool();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
