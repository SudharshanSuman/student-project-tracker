import { Router } from "express";
import { Prisma, type FundingAward } from "@prisma/client";
import {
  fundingAwardSchema,
  fundingChangeRequestSchema,
  reviewChangeRequestSchema,
  updateFundingAwardSchema,
  verifyFundingSchema,
} from "@iic/shared";
import { prisma } from "../db.js";
import { requireProjectAccess, visibleProjectsWhere, type ProjectAccess } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { notifyMany } from "../lib/notify.js";
import { parse, uuidParam } from "../lib/validate.js";
import { currentUser, requireAuth, requireRole, type AuthUser } from "../middleware/auth.js";

/**
 * Funding ledger. Rules:
 *  - Amounts are Decimal(14,2) with an explicit ISO 4217 currency; totals are per currency and
 *    per verification state, never converted or summed across currencies.
 *  - New awards are always ESTIMATED. Only the assigned mentor or an admin verifies/rejects them,
 *    and a mentor cannot verify an award they recorded themselves.
 *  - A VERIFIED award's material fields (amount, currency, source, award date, linked
 *    registration) cannot be edited directly: a change request is reviewed by an admin who is not
 *    the requester. Verified awards cannot be deleted.
 *  - Plain project members never see funding.
 */
export const fundingRouter = Router();
fundingRouter.use(requireAuth);

const MATERIAL_FIELDS = ["amount", "currency", "source", "awardedAt", "registrationId"] as const;

const awardInclude = {
  project: { select: { id: true, name: true, mentorId: true } },
  createdBy: { select: { id: true, name: true } },
  verifiedBy: { select: { id: true, name: true } },
  registration: { select: { id: true, outcome: true, competition: { select: { id: true, name: true } } } },
  changeRequests: {
    where: { status: "PENDING" },
    select: { id: true, proposed: true, reason: true, createdAt: true, requestedBy: { select: { id: true, name: true } } },
  },
} satisfies Prisma.FundingAwardInclude;

type AwardRow = Prisma.FundingAwardGetPayload<{ include: typeof awardInclude }>;

function serialize(a: AwardRow, user: AuthUser) {
  return {
    ...a,
    amount: a.amount.toFixed(2),
    canVerify: a.verification !== "VERIFIED" && (user.role === "ADMIN" || (user.role === "MENTOR" && a.project.mentorId === user.id && a.createdById !== user.id)),
  };
}

/** Funding is for staff and project leads; plain members (and non-lead students) are refused. */
function fundingProjectWhere(user: AuthUser): Prisma.ProjectWhereInput {
  if (user.role === "ADMIN" || user.role === "MENTOR") return visibleProjectsWhere(user);
  return { memberships: { some: { userId: user.id, role: "LEAD" } } };
}

async function requireFundingAccess(user: AuthUser, projectId: string): Promise<ProjectAccess> {
  const access = await requireProjectAccess(user, projectId);
  if (!access.canManage && !access.canReview) {
    // Members can see the project but not its money.
    throw forbidden("Funding is visible to the project lead, its mentor and admins only");
  }
  return access;
}

async function loadAward(user: AuthUser, id: string) {
  const award = await prisma.fundingAward.findUnique({ where: { id } });
  if (!award) throw notFound("Funding award not found");
  const access = await requireFundingAccess(user, award.projectId);
  return { award, access };
}

async function assertRegistrationBelongs(registrationId: string | null | undefined, projectId: string) {
  if (!registrationId) return;
  const reg = await prisma.competitionRegistration.findUnique({ where: { id: registrationId }, select: { projectId: true } });
  if (!reg || reg.projectId !== projectId) throw badRequest("That competition registration does not belong to this project");
}

function snapshot(a: Pick<FundingAward, "amount" | "currency" | "source" | "awardedAt" | "registrationId">) {
  return { amount: a.amount.toFixed(2), currency: a.currency, source: a.source, awardedAt: a.awardedAt?.toISOString() ?? null, registrationId: a.registrationId };
}

// ── Ledger ──
fundingRouter.get("/funding", requireRole("ADMIN", "MENTOR", "PROJECT_LEAD"), async (req, res) => {
  const user = currentUser(req);
  const projectWhere = fundingProjectWhere(user);
  const projectId = typeof req.query.projectId === "string" ? uuidParam(req.query.projectId, "projectId") : undefined;
  const where: Prisma.FundingAwardWhereInput = { project: projectWhere, ...(projectId ? { projectId } : {}) };
  const [awards, totals, pendingRequests, projects] = await Promise.all([
    prisma.fundingAward.findMany({ where, include: awardInclude, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.fundingAward.groupBy({ by: ["currency", "verification"], where, _sum: { amount: true }, _count: { _all: true }, orderBy: { currency: "asc" } }),
    user.role === "ADMIN"
      ? prisma.fundingChangeRequest.findMany({
          where: { status: "PENDING" },
          include: { requestedBy: { select: { id: true, name: true } }, award: { select: { id: true, title: true, project: { select: { id: true, name: true } } } } },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    prisma.project.findMany({ where: { AND: [projectWhere, { status: { not: "ARCHIVED" } }] }, select: { id: true, name: true, registrations: { select: { id: true, competition: { select: { name: true } } } } }, orderBy: { name: "asc" } }),
  ]);
  res.json({
    awards: awards.map((a) => serialize(a, user)),
    // Sums are computed by Postgres on NUMERIC and returned as exact strings.
    totals: totals.map((t) => ({ currency: t.currency, verification: t.verification, amount: (t._sum.amount ?? new Prisma.Decimal(0)).toFixed(2), count: t._count._all })),
    pendingRequests: pendingRequests.map((r) => ({ ...r, canReview: r.requestedById !== user.id })),
    projects,
    isAdmin: user.role === "ADMIN",
  });
});

fundingRouter.post("/funding", requireRole("ADMIN", "MENTOR", "PROJECT_LEAD"), async (req, res) => {
  const user = currentUser(req);
  const input = parse(fundingAwardSchema, req.body);
  const access = await requireFundingAccess(user, input.projectId);
  if (access.project.status === "ARCHIVED" && !access.isAdmin) throw forbidden("Archived projects are read-only");
  await assertRegistrationBelongs(input.registrationId, input.projectId);
  const award = await prisma.$transaction(async (tx) => {
    const a = await tx.fundingAward.create({
      data: { ...input, amount: new Prisma.Decimal(input.amount), verification: "ESTIMATED", createdById: user.id },
      include: awardInclude,
    });
    await audit(req, { action: "funding.recorded", entityType: "FundingAward", entityId: a.id, projectId: a.projectId, metadata: { title: a.title, ...snapshot(a) } }, tx);
    if (access.project.mentorId && access.project.mentorId !== user.id) {
      await notifyMany([access.project.mentorId], {
        type: "funding.review",
        title: `Funding to verify: ${a.title} (${a.currency} ${a.amount.toFixed(2)})`,
        link: "/funding",
        dedupeKey: `funding.recorded:${a.id}`,
      }, tx);
    }
    return a;
  });
  res.status(201).json({ award: serialize(award, user) });
});

fundingRouter.patch("/funding/:id", requireRole("ADMIN", "MENTOR", "PROJECT_LEAD"), async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const { award, access } = await loadAward(user, id);
  if (access.project.status === "ARCHIVED" && !access.isAdmin) throw forbidden("Archived projects are read-only");
  const input = parse(updateFundingAwardSchema, req.body);
  const material = MATERIAL_FIELDS.filter((f) => input[f] !== undefined);
  if (award.verification === "VERIFIED" && material.length > 0) {
    throw conflict(`Verified awards need a reviewed change request to change ${material.join(", ")}`, "MATERIAL_CHANGE_REQUIRES_REVIEW");
  }
  await assertRegistrationBelongs(input.registrationId, award.projectId);
  const data: Prisma.FundingAwardUncheckedUpdateInput = { ...input, amount: input.amount ? new Prisma.Decimal(input.amount) : undefined };
  // Editing a rejected award's figures resubmits it as an estimate.
  if (award.verification === "REJECTED" && material.length > 0) Object.assign(data, { verification: "ESTIMATED", verifiedById: null, verifiedAt: null });
  const updated = await prisma.$transaction(async (tx) => {
    const a = await tx.fundingAward.update({ where: { id }, data, include: awardInclude });
    await audit(req, { action: "funding.updated", entityType: "FundingAward", entityId: id, projectId: award.projectId, metadata: { changed: Object.keys(input), before: snapshot(award), after: snapshot(a) } }, tx);
    return a;
  });
  res.json({ award: serialize(updated, user) });
});

fundingRouter.post("/funding/:id/verify", requireRole("ADMIN", "MENTOR"), async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const { award, access } = await loadAward(user, id);
  if (!access.canReview) throw forbidden("Only the assigned mentor or an admin can verify funding");
  if (!access.isAdmin && award.createdById === user.id) throw forbidden("You recorded this award; another reviewer must verify it");
  if (award.verification === "VERIFIED") throw conflict("Already verified; use a change request to amend it", "ALREADY_VERIFIED");
  const { decision, note } = parse(verifyFundingSchema, req.body);
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.fundingAward.updateMany({
      where: { id, verification: award.verification, updatedAt: award.updatedAt },
      data: { verification: decision, verifiedById: user.id, verifiedAt: new Date() },
    });
    if (r.count === 0) throw conflict("The award changed while you were reviewing it; reload and try again", "STALE");
    await audit(req, { action: decision === "VERIFIED" ? "funding.verified" : "funding.rejected", entityType: "FundingAward", entityId: id, projectId: award.projectId, metadata: { note, ...snapshot(award) } }, tx);
    await notifyMany([award.createdById].filter((u) => u !== user.id), {
      type: "funding.review",
      title: `Funding ${decision === "VERIFIED" ? "verified" : "rejected"}: ${award.title}`,
      body: note,
      link: "/funding",
      dedupeKey: `funding.${decision}:${id}:${Date.now()}`,
    }, tx);
    return tx.fundingAward.findUniqueOrThrow({ where: { id }, include: awardInclude });
  });
  res.json({ award: serialize(updated, user) });
});

fundingRouter.delete("/funding/:id", requireRole("ADMIN", "MENTOR", "PROJECT_LEAD"), async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const { award } = await loadAward(user, id);
  if (award.verification === "VERIFIED") throw conflict("Verified awards cannot be deleted", "VERIFIED_IMMUTABLE");
  await prisma.$transaction(async (tx) => {
    await tx.fundingAward.delete({ where: { id } });
    await audit(req, { action: "funding.deleted", entityType: "FundingAward", entityId: id, projectId: award.projectId, metadata: { title: award.title, verification: award.verification, ...snapshot(award) } }, tx);
  });
  res.status(204).end();
});

// ── Change requests for verified awards ──
fundingRouter.post("/funding/:id/change-requests", requireRole("ADMIN", "MENTOR", "PROJECT_LEAD"), async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const { award } = await loadAward(user, id);
  if (award.verification !== "VERIFIED") throw conflict("Only verified awards need a change request; edit it directly", "NOT_VERIFIED");
  const { reason, ...proposed } = parse(fundingChangeRequestSchema, req.body);
  const pending = await prisma.fundingChangeRequest.count({ where: { awardId: id, status: "PENDING" } });
  if (pending > 0) throw conflict("A change request is already pending for this award", "PENDING_EXISTS");
  const request = await prisma.$transaction(async (tx) => {
    const r = await tx.fundingChangeRequest.create({
      data: {
        awardId: id,
        requestedById: user.id,
        reason,
        previous: snapshot(award),
        proposed: { ...proposed, awardedAt: proposed.awardedAt?.toISOString() },
      },
    });
    await audit(req, { action: "funding.change_requested", entityType: "FundingAward", entityId: id, projectId: award.projectId, metadata: { requestId: r.id, reason, proposed: r.proposed as Prisma.InputJsonValue } }, tx);
    const admins = await tx.user.findMany({ where: { role: "ADMIN", status: "ACTIVE", id: { not: user.id } }, select: { id: true } });
    await notifyMany(admins.map((a) => a.id), {
      type: "funding.review",
      title: `Funding change to review: ${award.title}`,
      body: reason,
      link: "/funding",
      dedupeKey: `funding.change:${r.id}`,
    }, tx);
    return r;
  });
  res.status(201).json({ request });
});

fundingRouter.post("/funding/change-requests/:id/review", requireRole("ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const id = uuidParam(req.params.id);
  const { decision, note } = parse(reviewChangeRequestSchema, req.body);
  const request = await prisma.fundingChangeRequest.findUnique({ where: { id }, include: { award: true } });
  if (!request) throw notFound("Change request not found");
  if (request.status !== "PENDING") throw conflict("This request has already been reviewed", "ALREADY_REVIEWED");
  if (request.requestedById === user.id) throw forbidden("You cannot review your own change request");
  const p = request.proposed as { amount?: string; currency?: string; source?: FundingAward["source"]; awardedAt?: string };
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.fundingChangeRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: decision, reviewedById: user.id, reviewedAt: new Date(), reviewNote: note },
    });
    if (claimed.count === 0) throw conflict("This request has already been reviewed", "ALREADY_REVIEWED");
    let award = request.award;
    if (decision === "APPROVED") {
      award = await tx.fundingAward.update({
        where: { id: request.awardId },
        data: {
          amount: p.amount ? new Prisma.Decimal(p.amount) : undefined,
          currency: p.currency,
          source: p.source,
          awardedAt: p.awardedAt ? new Date(p.awardedAt) : undefined,
          // The reviewer re-verifies the amended figures.
          verification: "VERIFIED",
          verifiedById: user.id,
          verifiedAt: new Date(),
        },
      });
    }
    await audit(req, {
      action: decision === "APPROVED" ? "funding.change_approved" : "funding.change_rejected",
      entityType: "FundingAward",
      entityId: request.awardId,
      projectId: request.award.projectId,
      metadata: { requestId: id, note, before: snapshot(request.award), after: snapshot(award) },
    }, tx);
    await notifyMany([request.requestedById], {
      type: "funding.review",
      title: `Funding change ${decision === "APPROVED" ? "approved" : "rejected"}: ${request.award.title}`,
      body: note,
      link: "/funding",
      dedupeKey: `funding.change.review:${id}`,
    }, tx);
    return award;
  });
  res.json({ award: { ...result, amount: result.amount.toFixed(2) } });
});
