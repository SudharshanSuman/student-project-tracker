import { Router } from "express";
import { z } from "zod";
import { Prisma, type AttendanceSession } from "@prisma/client";
import {
  checkInSchema,
  correctAttendanceSchema,
  createAttendanceSessionSchema,
  createEventSchema,
  manualAttendanceSchema,
} from "@iic/shared";
import { prisma } from "../db.js";
import { isStaff } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { distanceMeters, issueQrToken, verifyQrToken } from "../lib/qr.js";
import { parse, uuidParam } from "../lib/validate.js";
import { currentUser, requireAuth, requireRole, type AuthUser } from "../middleware/auth.js";

export const attendanceRouter = Router();
attendanceRouter.use(requireAuth);

const staffOnly = requireRole("ADMIN", "MENTOR");

/** Whether a user is eligible for a session under its policy. */
async function isEligible(user: AuthUser, s: AttendanceSession): Promise<boolean> {
  if (s.eligibility === "ALL_ACTIVE_USERS") return true;
  if (s.eligibility === "PROJECT" && s.projectId) {
    return !!(await prisma.projectMembership.findUnique({ where: { projectId_userId: { projectId: s.projectId, userId: user.id } } }));
  }
  if (s.eligibility === "COHORT" && s.cohortId) {
    return (await prisma.projectMembership.count({ where: { userId: user.id, project: { cohortId: s.cohortId } } })) > 0;
  }
  return false;
}

function eligibleUsersWhere(s: AttendanceSession): Prisma.UserWhereInput {
  if (s.eligibility === "PROJECT" && s.projectId) return { status: "ACTIVE", memberships: { some: { projectId: s.projectId } } };
  if (s.eligibility === "COHORT" && s.cohortId) return { status: "ACTIVE", memberships: { some: { project: { cohortId: s.cohortId } } } };
  return { status: "ACTIVE", role: { in: ["PROJECT_LEAD", "PROJECT_MEMBER"] } };
}

// ── Events ──
attendanceRouter.get("/events", async (req, res) => {
  const q = z.object({ when: z.enum(["upcoming", "past", "all"]).default("upcoming") }).parse(req.query);
  const now = new Date();
  const events = await prisma.event.findMany({
    where: q.when === "upcoming" ? { endsAt: { gte: now } } : q.when === "past" ? { endsAt: { lt: now } } : {},
    include: {
      cohort: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      _count: { select: { sessions: true } },
    },
    orderBy: { startsAt: q.when === "past" ? "desc" : "asc" },
    take: 100,
  });
  res.json({ events, canManage: isStaff(currentUser(req)) });
});

attendanceRouter.post("/events", staffOnly, async (req, res) => {
  const user = currentUser(req);
  const input = parse(createEventSchema, req.body);
  const event = await prisma.event.create({ data: { ...input, cohortId: input.cohortId ?? null, createdById: user.id } });
  await audit(req, { action: "event.created", entityType: "Event", entityId: event.id, metadata: { title: event.title } });
  res.status(201).json({ event });
});

attendanceRouter.delete("/events/:id", staffOnly, async (req, res) => {
  const id = uuidParam(req.params.id);
  const sessions = await prisma.attendanceSession.count({ where: { eventId: id, records: { some: {} } } });
  if (sessions > 0) throw conflict("This event has attendance records and cannot be deleted");
  await prisma.event.delete({ where: { id } });
  await audit(req, { action: "event.deleted", entityType: "Event", entityId: id });
  res.status(204).end();
});

// ── Attendance sessions ──
attendanceRouter.get("/attendance/sessions", async (req, res) => {
  const user = currentUser(req);
  const sessions = await prisma.attendanceSession.findMany({
    include: {
      event: { select: { id: true, title: true } },
      cohort: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      _count: { select: { records: { where: { status: { not: "REVOKED" } } } } },
      records: { where: { userId: user.id }, select: { id: true, status: true, checkedInAt: true, method: true } },
    },
    orderBy: { startsAt: "desc" },
    take: 200,
  });
  const visible = isStaff(user) ? sessions : (await Promise.all(sessions.map(async (s) => ((await isEligible(user, s)) ? s : null)))).filter((s) => s !== null);
  res.json({
    sessions: visible.map(({ records, ...s }) => ({ ...s, myRecord: records[0] ?? null })),
    canManage: isStaff(user),
  });
});

attendanceRouter.post("/attendance/sessions", staffOnly, async (req, res) => {
  const user = currentUser(req);
  const input = parse(createAttendanceSessionSchema, req.body);
  const session = await prisma.attendanceSession.create({
    data: {
      ...input,
      eventId: input.eventId ?? null,
      cohortId: input.eligibility === "COHORT" ? input.cohortId ?? null : null,
      projectId: input.eligibility === "PROJECT" ? input.projectId ?? null : null,
      latitude: input.locationCheck ? input.latitude ?? null : null,
      longitude: input.locationCheck ? input.longitude ?? null : null,
      radiusMeters: input.locationCheck ? input.radiusMeters ?? null : null,
      createdById: user.id,
    },
  });
  await audit(req, { action: "attendance.session_created", entityType: "AttendanceSession", entityId: session.id, projectId: session.projectId, metadata: { name: session.name } });
  res.status(201).json({ session });
});

attendanceRouter.get("/attendance/sessions/:id", staffOnly, async (req, res) => {
  const id = uuidParam(req.params.id);
  const session = await prisma.attendanceSession.findUnique({
    where: { id },
    include: {
      event: { select: { id: true, title: true } },
      cohort: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      records: {
        include: { user: { select: { id: true, name: true, email: true } }, correctedBy: { select: { name: true } } },
        orderBy: { checkedInAt: "asc" },
      },
    },
  });
  if (!session) throw notFound("Session not found");
  const eligibleCount = await prisma.user.count({ where: eligibleUsersWhere(session) });
  res.json({ session, eligibleCount });
});

attendanceRouter.post("/attendance/sessions/:id/status", staffOnly, async (req, res) => {
  const id = uuidParam(req.params.id);
  const { status } = z.object({ status: z.enum(["OPEN", "CLOSED", "CANCELLED"]) }).parse(req.body);
  const session = await prisma.attendanceSession.findUnique({ where: { id } });
  if (!session) throw notFound("Session not found");
  if (session.status === "CLOSED" || session.status === "CANCELLED") throw conflict("Session is already finished");
  const updated = await prisma.attendanceSession.update({ where: { id }, data: { status } });
  await audit(req, { action: `attendance.session_${status.toLowerCase()}`, entityType: "AttendanceSession", entityId: id, projectId: session.projectId });
  if (status === "OPEN") {
    const users = await prisma.user.findMany({ where: eligibleUsersWhere(session), select: { id: true } });
    for (const u of users) {
      await notify({ userId: u.id, type: "attendance.open", title: `Check-in open: ${session.name}`, link: "/attendance", dedupeKey: `attendance-open:${id}` });
    }
  }
  res.json({ session: updated });
});

/** Fresh short-lived QR token for display. Only staff can mint tokens. */
attendanceRouter.get("/attendance/sessions/:id/qr", staffOnly, async (req, res) => {
  const id = uuidParam(req.params.id);
  const session = await prisma.attendanceSession.findUnique({ where: { id } });
  if (!session) throw notFound("Session not found");
  if (session.status !== "OPEN") throw conflict("Open the session before displaying its QR code");
  const { token, payload } = issueQrToken(session.id, session.qrTtlSeconds);
  res.set("Cache-Control", "no-store");
  res.json({ token, expiresAt: new Date(payload.exp * 1000), ttlSeconds: session.qrTtlSeconds, policy: session.qrPolicy });
});

attendanceRouter.post("/attendance/check-in", async (req, res) => {
  const user = currentUser(req);
  const input = parse(checkInSchema, req.body);
  const verified = verifyQrToken(input.token);
  if (!verified.ok) {
    const message = verified.reason === "EXPIRED" ? "This QR code has expired. Scan the current code." : "This QR code is not valid.";
    throw new HttpError(400, message, verified.reason === "EXPIRED" ? "QR_EXPIRED" : "QR_INVALID");
  }
  const { sid, jti } = verified.payload;
  const session = await prisma.attendanceSession.findUnique({ where: { id: sid } });
  if (!session) throw new HttpError(400, "This QR code is not valid.", "QR_INVALID");
  if (session.status !== "OPEN") throw conflict("Check-in for this session is closed", "SESSION_CLOSED");
  if (!(await isEligible(user, session))) throw forbidden("You are not eligible for this session");

  let locationVerified: boolean | null = null;
  if (session.locationCheck && input.location && session.latitude != null && session.longitude != null && session.radiusMeters != null) {
    // Supporting signal only; never treated as identity proof and never blocks check-in.
    locationVerified = distanceMeters(input.location, { latitude: session.latitude, longitude: session.longitude }) <= session.radiusMeters;
  }

  try {
    const record = await prisma.$transaction(async (tx) => {
      if (session.qrPolicy === "SINGLE_USE") {
        await tx.qrTokenRedemption.create({ data: { jti, sessionId: session.id } });
      }
      const r = await tx.attendanceRecord.create({
        data: { sessionId: session.id, userId: user.id, method: "QR", tokenJti: jti, locationVerified },
        select: { id: true, checkedInAt: true, locationVerified: true },
      });
      await audit(req, { action: "attendance.checked_in", entityType: "AttendanceRecord", entityId: r.id, projectId: session.projectId, metadata: { sessionId: session.id } }, tx);
      return r;
    });
    res.status(201).json({ record, session: { id: session.id, name: session.name } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = String((err.meta as { target?: unknown } | undefined)?.target ?? "");
      if (target.includes("jti") || target.includes("QrTokenRedemption")) throw conflict("This QR code has already been used", "QR_ALREADY_USED");
      throw conflict("You have already checked in to this session", "ALREADY_CHECKED_IN");
    }
    throw err;
  }
});

attendanceRouter.post("/attendance/sessions/:id/manual", staffOnly, async (req, res) => {
  const id = uuidParam(req.params.id);
  const input = parse(manualAttendanceSchema, req.body);
  const session = await prisma.attendanceSession.findUnique({ where: { id } });
  if (!session) throw notFound("Session not found");
  const target = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!target) throw badRequest("User not found");
  const record = await prisma.$transaction(async (tx) => {
    const r = await tx.attendanceRecord.create({
      data: { sessionId: id, userId: input.userId, method: "MANUAL", status: "CORRECTED", correctedById: currentUser(req).id, correctionReason: input.reason },
    });
    await audit(req, { action: "attendance.manual_added", entityType: "AttendanceRecord", entityId: r.id, projectId: session.projectId, metadata: { userId: input.userId, reason: input.reason } }, tx);
    return r;
  });
  res.status(201).json({ record });
});

attendanceRouter.patch("/attendance/records/:id", staffOnly, async (req, res) => {
  const id = uuidParam(req.params.id);
  const input = parse(correctAttendanceSchema, req.body);
  const before = await prisma.attendanceRecord.findUnique({ where: { id }, include: { session: { select: { projectId: true } } } });
  if (!before) throw notFound("Record not found");
  const record = await prisma.$transaction(async (tx) => {
    const r = await tx.attendanceRecord.update({
      where: { id },
      data: { status: input.status === "REVOKED" ? "REVOKED" : "CORRECTED", correctedById: currentUser(req).id, correctionReason: input.reason },
    });
    await audit(req, { action: "attendance.corrected", entityType: "AttendanceRecord", entityId: id, projectId: before.session.projectId, metadata: { from: before.status, to: r.status, reason: input.reason } }, tx);
    return r;
  });
  res.json({ record });
});

/** The signed-in user's own attendance and verified hours. */
attendanceRouter.get("/attendance/me", async (req, res) => {
  const user = currentUser(req);
  const records = await prisma.attendanceRecord.findMany({
    where: { userId: user.id },
    include: { session: { select: { id: true, name: true, startsAt: true, endsAt: true, location: true } } },
    orderBy: { checkedInAt: "desc" },
    take: 100,
  });
  const verifiedHours = records
    .filter((r) => r.status !== "REVOKED")
    .reduce((h, r) => h + (r.session.endsAt.getTime() - r.session.startsAt.getTime()) / 3_600_000, 0);
  res.json({ records, verifiedHours: Math.round(verifiedHours * 10) / 10 });
});
