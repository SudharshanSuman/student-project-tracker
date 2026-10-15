import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@iic/shared";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/**
 * Server-side fetch to the API, forwarding the caller's session cookie.
 * 401 → login, 404 → Next.js not-found, 403 → /forbidden page.
 */
export async function serverApi<T>(path: string): Promise<T> {
  const jar = await cookies();
  const res = await fetch(`${API}/api${path}`, {
    headers: { cookie: jar.toString(), accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (res.status === 404) notFound();
  if (res.status === 403) redirect("/forbidden");
  if (!res.ok) throw new Error(`API ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  avatarUrl: string | null;
  bio: string | null;
  phone: string | null;
  department: string | null;
  discordUsername: string | null;
  githubUsername: string | null;
  onboardedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Current user, deduplicated per request. */
export const getMe = cache(async (): Promise<Me> => {
  const { user } = await serverApi<{ user: Me }>("/auth/me");
  return user;
});

/** Variant for public pages: returns null instead of redirecting. */
export async function getMeOptional(): Promise<Me | null> {
  const jar = await cookies();
  if (!jar.get("iic_session")) return null;
  const res = await fetch(`${API}/api/auth/me`, { headers: { cookie: jar.toString() }, cache: "no-store" });
  if (!res.ok) return null;
  return ((await res.json()) as { user: Me }).user;
}
