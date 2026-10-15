import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import multer from "multer";
import { ZodError } from "zod";
import { logger } from "../logger.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "ERROR",
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, "BAD_REQUEST", details);
export const unauthorized = (msg = "Authentication required") => new HttpError(401, msg, "UNAUTHORIZED");
export const forbidden = (msg = "You do not have permission to do that") => new HttpError(403, msg, "FORBIDDEN");
export const notFound = (msg = "Not found") => new HttpError(404, msg, "NOT_FOUND");
export const conflict = (msg: string, code = "CONFLICT") => new HttpError(409, msg, code);

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
};

/** Converts known errors to safe JSON responses; never leaks stack traces or SQL. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === "LIMIT_FILE_SIZE";
    res.status(tooLarge ? 413 : 400).json({ error: { code: tooLarge ? "FILE_TOO_LARGE" : "BAD_UPLOAD", message: tooLarge ? "The file is larger than 10 MB" : "Invalid upload" } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ error: { code: "DUPLICATE", message: "A record with these details already exists" } });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Record not found" } });
      return;
    }
    if (err.code === "P2003") {
      res.status(400).json({ error: { code: "INVALID_REFERENCE", message: "Referenced record does not exist" } });
      return;
    }
  }
  if (err && typeof err === "object" && "type" in err && err.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "BAD_JSON", message: "Malformed JSON body" } });
    return;
  }
  logger.error({ err, path: req.path, method: req.method }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
};
