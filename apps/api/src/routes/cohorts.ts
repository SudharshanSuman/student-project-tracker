import { Router } from "express";
import { createCohortSchema } from "@iic/shared";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { parse } from "../lib/validate.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const cohortsRouter = Router();
cohortsRouter.use(requireAuth);

cohortsRouter.get("/", async (_req, res) => {
  const cohorts = await prisma.cohort.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, term: true, startDate: true, endDate: true, _count: { select: { projects: true } } },
  });
  res.json({ cohorts });
});

cohortsRouter.post("/", requireRole("ADMIN"), async (req, res) => {
  const data = parse(createCohortSchema, req.body);
  const cohort = await prisma.cohort.create({ data });
  await audit(req, { action: "cohort.created", entityType: "Cohort", entityId: cohort.id, metadata: { name: cohort.name } });
  res.status(201).json({ cohort });
});
