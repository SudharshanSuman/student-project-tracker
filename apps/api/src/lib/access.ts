import type { MembershipRole, Prisma, Project } from "@prisma/client";
import { prisma } from "../db.js";
import type { AuthUser } from "../middleware/auth.js";
import { forbidden, notFound } from "./errors.js";

/**
 * Central project-scoped authorization. Every project-scoped route resolves access
 * through here so the rules live in one place:
 *  - ADMIN: everything
 *  - MENTOR: projects where they are the assigned mentor (view + review)
 *  - others: projects they are a member of; LEAD membership grants management
 */
export function visibleProjectsWhere(user: AuthUser): Prisma.ProjectWhereInput {
  if (user.role === "ADMIN") return {};
  if (user.role === "MENTOR") return { mentorId: user.id };
  return { memberships: { some: { userId: user.id } } };
}

export interface ProjectAccess {
  project: Project;
  membershipRole: MembershipRole | null;
  isAdmin: boolean;
  isMentor: boolean;
  isLead: boolean;
  isMember: boolean;
  /** create/edit tasks, milestones, membership, registrations */
  canManage: boolean;
  /** approve stage-gates and review deliverables */
  canReview: boolean;
}

export async function projectAccess(user: AuthUser, projectId: string): Promise<ProjectAccess | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return null;
  const membership = await prisma.projectMembership.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } },
    select: { role: true },
  });
  const isAdmin = user.role === "ADMIN";
  const isMentor = user.role === "MENTOR" && project.mentorId === user.id;
  const isLead = membership?.role === "LEAD";
  const isMember = !!membership;
  if (!isAdmin && !isMentor && !isMember) return null;
  return {
    project,
    membershipRole: membership?.role ?? null,
    isAdmin,
    isMentor,
    isLead,
    isMember,
    canManage: isAdmin || isLead,
    canReview: isAdmin || isMentor,
  };
}

/**
 * Throws 404 (not 403) when the user cannot see the project, so record existence
 * does not leak across projects.
 */
export async function requireProjectAccess(
  user: AuthUser,
  projectId: string,
  need: "view" | "manage" | "review" = "view",
): Promise<ProjectAccess> {
  const access = await projectAccess(user, projectId);
  if (!access) throw notFound("Project not found");
  if (need === "manage" && !access.canManage) throw forbidden("Only the project lead or an admin can do that");
  if (need === "review" && !access.canReview) throw forbidden("Only the assigned mentor or an admin can review");
  if (access.project.status === "ARCHIVED" && need === "manage" && !access.isAdmin) {
    throw forbidden("Archived projects are read-only");
  }
  return access;
}

export function isStaff(user: AuthUser) {
  return user.role === "ADMIN" || user.role === "MENTOR";
}
