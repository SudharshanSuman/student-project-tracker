import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Router } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";
import { logger } from "./logger.js";
import { loadSession } from "./middleware/auth.js";
import { csrfGuard } from "./middleware/security.js";
import { attendanceRouter } from "./routes/attendance.js";
import { authRouter } from "./routes/auth.js";
import { cohortsRouter } from "./routes/cohorts.js";
import { competitionsRouter } from "./routes/competitions.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { documentsRouter } from "./routes/documents.js";
import { fundingRouter } from "./routes/funding.js";
import { insightsRouter } from "./routes/insights.js";
import { milestonesRouter } from "./routes/milestones.js";
import { projectsRouter } from "./routes/projects.js";
import { reportsRouter } from "./routes/reports.js";
import { tasksRouter } from "./routes/tasks.js";
import { usersRouter } from "./routes/users.js";
import { integrationsRouter } from "./routes/integrations.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: config.webOrigins, credentials: true }));
  if (!config.isTest) app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => req.url === "/api/health" },
        serializers: {
          req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
      }),
    );
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());
  app.use(
    "/api",
    rateLimit({ windowMs: 60_000, limit: config.isTest ? 10_000 : 600, standardHeaders: "draft-7", legacyHeaders: false }),
  );

  app.get("/api/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", db: "ok", time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: "degraded", db: "unreachable" });
    }
  });

  const api = Router();
  api.use(csrfGuard);
  api.use(loadSession);
  api.use("/auth", authRouter);
  api.use("/users", usersRouter);
  api.use("/cohorts", cohortsRouter);
  api.use("/projects", projectsRouter);
  api.use("/dashboard", dashboardRouter);
  api.use("/reports", reportsRouter);
  api.use(tasksRouter);
  api.use(milestonesRouter);
  api.use(attendanceRouter);
  api.use(documentsRouter);
  api.use(integrationsRouter);
  api.use(insightsRouter);
  api.use(competitionsRouter);
  api.use(fundingRouter);
  app.use("/api", api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
