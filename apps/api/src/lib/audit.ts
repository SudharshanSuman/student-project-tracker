import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { prisma, type Tx } from "../db.js";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Append-only audit trail. Pass `tx` to make the entry part of the same transaction. */
export async function audit(req: Request | null, entry: AuditEntry, tx: Tx = prisma) {
  await tx.auditLog.create({
    data: {
      actorId: req?.user?.id ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      projectId: entry.projectId ?? null,
      metadata: entry.metadata,
      ip: req?.ip ?? null,
    },
  });
}
