import type { z } from "zod";
import { badRequest } from "./errors.js";

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  return schema.parse(data) as z.output<S>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route params are user input too: reject non-UUID ids before they reach Prisma. */
export function uuidParam(value: string | string[] | undefined, name = "id"): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw badRequest(`Invalid ${name}`);
  return value;
}

export function pageArgs(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
