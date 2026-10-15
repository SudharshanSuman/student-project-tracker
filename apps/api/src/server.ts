import { createServer } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { logger } from "./logger.js";
import { attachRealtime } from "./realtime.js";

const app = createApp();
const server = createServer(app);
attachRealtime(server);

server.listen(config.API_PORT, () => {
  logger.info({ port: config.API_PORT, env: config.NODE_ENV }, "IIC API listening");
  if (!config.integrations.discordConfigured) logger.warn("Discord credentials not set — Discord telemetry disabled (see docs/INTEGRATIONS.md)");
  if (!config.integrations.githubConfigured) logger.warn("GITHUB_TOKEN not set — GitHub sync disabled");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
