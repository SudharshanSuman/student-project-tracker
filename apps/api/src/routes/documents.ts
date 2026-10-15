import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireProjectAccess } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { badRequest, forbidden, HttpError, notFound } from "../lib/errors.js";
import { touchProject } from "../lib/projects.js";
import { checkUpload, deleteFile, MAX_UPLOAD_BYTES, readStream, safeName, saveFile } from "../lib/storage.js";
import { uuidParam } from "../lib/validate.js";
import { currentUser, requireAuth } from "../middleware/auth.js";
import { logger } from "../logger.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

// Memory storage: files are size-capped, content-sniffed, then written under a generated id.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } });

const linkSchema = z.object({
  taskId: z.string().uuid().optional(),
  submissionId: z.string().uuid().optional(),
});

const docSelect = {
  id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true, taskId: true, submissionId: true,
  uploadedBy: { select: { id: true, name: true } },
} as const;

documentsRouter.get("/projects/:projectId/documents", async (req, res) => {
  const projectId = uuidParam(req.params.projectId, "projectId");
  await requireProjectAccess(currentUser(req), projectId);
  const documents = await prisma.document.findMany({ where: { projectId }, select: docSelect, orderBy: { createdAt: "desc" } });
  res.json({ documents });
});

/** Upload a project document, optionally attached to a task or milestone submission of that project. */
documentsRouter.post("/projects/:projectId/documents", upload.single("file"), async (req, res) => {
  const user = currentUser(req);
  const projectId = uuidParam(req.params.projectId, "projectId");
  const access = await requireProjectAccess(user, projectId);
  if (!access.isMember && !access.isAdmin) throw forbidden("Only project members can upload documents");
  if (access.project.status === "ARCHIVED") throw forbidden("Archived projects are read-only");
  const file = req.file;
  if (!file) throw badRequest("Attach a file in the 'file' field");
  const links = linkSchema.parse(req.body ?? {});
  if (links.taskId) {
    const task = await prisma.task.findUnique({ where: { id: links.taskId }, select: { projectId: true } });
    if (!task || task.projectId !== projectId) throw badRequest("Task must belong to this project");
  }
  if (links.submissionId) {
    const sub = await prisma.milestoneSubmission.findUnique({ where: { id: links.submissionId }, select: { milestone: { select: { projectId: true } } } });
    if (!sub || sub.milestone.projectId !== projectId) throw badRequest("Submission must belong to this project");
  }
  const check = checkUpload(file);
  if (!check.ok) throw new HttpError(415, check.reason, "UNSUPPORTED_FILE");

  const storageKey = await saveFile(file.buffer);
  try {
    const document = await prisma.$transaction(async (tx) => {
      const d = await tx.document.create({
        data: {
          uploadedById: user.id,
          projectId,
          taskId: links.taskId ?? null,
          submissionId: links.submissionId ?? null,
          storageKey,
          originalName: safeName(file.originalname),
          mimeType: file.mimetype,
          sizeBytes: file.size,
        },
        select: docSelect,
      });
      await touchProject(projectId, tx);
      await audit(req, { action: "document.uploaded", entityType: "Document", entityId: d.id, projectId, metadata: { name: d.originalName, size: d.sizeBytes, mimeType: d.mimeType } }, tx);
      return d;
    });
    res.status(201).json({ document });
  } catch (err) {
    await deleteFile(storageKey); // no orphaned files if the DB write fails
    throw err;
  }
});

async function loadDocument(req: Parameters<typeof currentUser>[0]) {
  const user = currentUser(req);
  const doc = await prisma.document.findUnique({ where: { id: uuidParam(req.params.id) } });
  // Documents without a project are not served through this route.
  if (!doc || !doc.projectId) throw notFound("Document not found");
  const access = await requireProjectAccess(user, doc.projectId);
  return { user, doc, access, projectId: doc.projectId };
}

documentsRouter.get("/documents/:id/download", async (req, res) => {
  const { doc } = await loadDocument(req);
  // Always a download, never rendered inline by the browser.
  res.setHeader("Content-Type", doc.mimeType);
  res.setHeader("Content-Length", String(doc.sizeBytes));
  res.setHeader("Content-Disposition", `attachment; filename="${doc.originalName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(doc.originalName)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, no-store");
  const stream = readStream(doc.storageKey);
  stream.on("error", (err) => {
    logger.error({ err, documentId: doc.id }, "stored file missing");
    if (!res.headersSent) res.status(404).json({ error: { code: "NOT_FOUND", message: "File not found" } });
    else res.destroy();
  });
  stream.pipe(res);
});

documentsRouter.delete("/documents/:id", async (req, res) => {
  const { user, doc, access, projectId } = await loadDocument(req);
  if (doc.uploadedById !== user.id && !access.canManage) throw forbidden("Only the uploader or the project lead can delete this document");
  await prisma.$transaction(async (tx) => {
    await tx.document.delete({ where: { id: doc.id } });
    await audit(req, { action: "document.deleted", entityType: "Document", entityId: doc.id, projectId, metadata: { name: doc.originalName } }, tx);
  });
  await deleteFile(doc.storageKey);
  res.status(204).end();
});
