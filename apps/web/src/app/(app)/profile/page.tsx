import type { Metadata } from "next";
import { ROLE_LABELS } from "@iic/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/states";
import { getMe, serverApi } from "@/lib/api-server";
import { formatDateTime } from "@/lib/utils";
import { ChangePasswordForm, ProfileForm, SessionsList } from "./profile-client";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const me = await getMe();
  const { sessions } = await serverApi<{ sessions: { id: string; createdAt: string; lastSeenAt: string; ip: string | null; userAgent: string | null; current: boolean }[] }>("/users/profile/sessions");
  return (
    <>
      <PageHeader title="Your profile" description={`${me.email} · ${ROLE_LABELS[me.role]} · last sign-in ${formatDateTime(me.lastLoginAt)}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardContent><ProfileForm me={me} /></CardContent></Card>
        <div className="space-y-4">
          <Card><CardHeader><CardTitle>Change password</CardTitle></CardHeader><CardContent><ChangePasswordForm /></CardContent></Card>
          <Card>
            <CardHeader><CardTitle>Linked accounts</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>Discord: {me.discordUsername ?? "not linked"} — account linking becomes available once an admin connects the Discord bot.</p>
              <p>GitHub: {me.githubUsername ? <span className="font-mono text-foreground">@{me.githubUsername}</span> : "not set"} (edit in details).</p>
            </CardContent>
          </Card>
          <Card><CardHeader><CardTitle>Active sessions</CardTitle></CardHeader><CardContent><SessionsList sessions={sessions} /></CardContent></Card>
        </div>
      </div>
    </>
  );
}
