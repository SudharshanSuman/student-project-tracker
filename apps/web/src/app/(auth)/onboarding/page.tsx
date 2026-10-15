import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { ROLE_LABELS, type Role } from "@iic/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMeOptional } from "@/lib/api-server";
import { AcceptInvitationForm } from "./accept-form";

export const metadata: Metadata = { title: "Onboarding" };

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

interface Invitation {
  email: string;
  role: Role;
  project: { id: string; name: string } | null;
  cohort: { id: string; name: string } | null;
  expiresAt: string;
}

const STEPS: Record<Role, { label: string; href: string }[]> = {
  ADMIN: [
    { label: "Create a cohort and invite mentors", href: "/admin/users" },
    { label: "Review stage-gate requirements", href: "/milestones" },
    { label: "Check integration settings", href: "/admin/integrations" },
  ],
  MENTOR: [
    { label: "Review your assigned projects", href: "/projects" },
    { label: "Open the milestone review queue", href: "/milestones" },
  ],
  PROJECT_LEAD: [
    { label: "Complete your profile", href: "/profile" },
    { label: "Set up your project board", href: "/board" },
    { label: "Add milestones for your current stage", href: "/projects" },
  ],
  PROJECT_MEMBER: [
    { label: "Complete your profile", href: "/profile" },
    { label: "See your assigned tasks", href: "/board" },
    { label: "Check upcoming events", href: "/events" },
  ],
};

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  if (token) {
    const res = await fetch(`${API}/api/auth/invitations/${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!res.ok) {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invitation unavailable</CardTitle>
            <CardDescription>This invitation link is invalid, already used, or expired. Ask an IIC admin for a new one.</CardDescription>
          </CardHeader>
        </Card>
      );
    }
    const { invitation } = (await res.json()) as { invitation: Invitation };
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Join the IIC Platform</CardTitle>
          <CardDescription>
            Invited as <span className="text-foreground">{ROLE_LABELS[invitation.role]}</span>
            {invitation.project ? <> on <span className="text-foreground">{invitation.project.name}</span></> : null}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AcceptInvitationForm token={token} email={invitation.email} />
        </CardContent>
      </Card>
    );
  }

  const me = await getMeOptional();
  if (!me) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Onboarding</CardTitle>
          <CardDescription>Open the invitation link from your email to create your account, or <Link className="text-primary" href="/login">sign in</Link>.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Welcome, {me.name}</CardTitle>
        <CardDescription>Getting started as {ROLE_LABELS[me.role]}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-success" /> Account created</li>
          {STEPS[me.role].map((s) => (
            <li key={s.href}>
              <Link href={s.href} className="flex items-center gap-2 hover:text-primary"><Circle className="h-4 w-4 text-muted-foreground" /> {s.label}</Link>
            </li>
          ))}
        </ul>
        <Link href="/dashboard" className="mt-5 inline-block text-sm text-primary">Go to dashboard →</Link>
      </CardContent>
    </Card>
  );
}
