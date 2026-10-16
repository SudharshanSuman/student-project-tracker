import type { Metadata } from "next";
import Link from "next/link";
import { Headphones } from "lucide-react";
import { StatusBadge } from "@/components/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { serverApi } from "@/lib/api-server";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Discord analytics" };

interface Data {
  configured: boolean;
  integration: { status: string; guildName: string | null; lastHeartbeatAt: string | null; minSessionSeconds: number } | null;
  projects: { id: string; name: string }[];
  daily: { projectId: string | null; date: string; voiceSeconds: number; messages: number }[];
  sessions: { id: string; joinedAt: string; leftAt: string | null; durationSeconds: number | null; status: string; user: { name: string } | null; project: { name: string } | null }[];
  alerts: { id: string; reason: string; project: { name: string } }[];
  individualDataVisible: boolean;
}

export default async function DiscordPage() {
  const d = await serverApi<Data>("/discord");
  const totals = d.projects.map((p) => {
    const rows = d.daily.filter((r) => r.projectId === p.id);
    return { ...p, voiceHours: rows.reduce((s, r) => s + r.voiceSeconds, 0) / 3600, messages: rows.reduce((s, r) => s + r.messages, 0) };
  });
  return (
    <>
      <PageHeader title="Discord analytics" description="Privacy-preserving aggregates: voice duration and message counts only. No message content is ever collected." />
      {!d.configured ? (
        <EmptyState icon={<Headphones className="h-6 w-6" />} title="Discord is not connected" description="Telemetry appears here once an admin configures the bot. Nothing is estimated or invented in the meantime." action={<Link href="/admin/integrations" className="text-sm text-link">Integration settings →</Link>} />
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <Stat label="Bot status" value={d.integration ? <StatusBadge status={d.integration.status} /> : "Waiting"} hint={d.integration ? `Heartbeat ${formatDateTime(d.integration.lastHeartbeatAt)}` : undefined} />
            <Stat label="Voice hours (30 days)" value={Math.round(totals.reduce((s, t) => s + t.voiceHours, 0) * 10) / 10} />
            <Stat label="Messages counted (30 days)" value={totals.reduce((s, t) => s + t.messages, 0)} />
          </div>
          <Card className="mb-4">
            <CardHeader><CardTitle>Team totals (30 days)</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table><THead><TR><TH>Project</TH><TH>Voice hours</TH><TH>Messages</TH></TR></THead>
                <TBody>{totals.map((t) => <TR key={t.id}><TD>{t.name}</TD><TD className="tabular-nums">{t.voiceHours.toFixed(1)}</TD><TD className="tabular-nums">{t.messages}</TD></TR>)}</TBody>
              </Table>
            </CardContent>
          </Card>
          {d.individualDataVisible ? (
            <Card>
              <CardHeader><CardTitle>Recent voice sessions (staff only)</CardTitle></CardHeader>
              <CardContent className="p-0">
                {d.sessions.length === 0 ? <p className="px-4 pb-4 text-xs text-muted-foreground">No voice sessions recorded.</p> : (
                  <Table><THead><TR><TH>Member</TH><TH>Project</TH><TH>Joined</TH><TH>Duration</TH><TH>Status</TH></TR></THead>
                    <TBody>{d.sessions.map((s) => <TR key={s.id}><TD>{s.user?.name ?? "Unlinked account"}</TD><TD>{s.project?.name ?? "—"}</TD><TD className="tabular-nums text-xs">{formatDateTime(s.joinedAt)}</TD><TD className="tabular-nums text-xs">{s.durationSeconds ? `${Math.round(s.durationSeconds / 60)} min` : "—"}</TD><TD><StatusBadge status={s.status} /></TD></TR>)}</TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
      <p className="mt-4 text-[11px] text-muted-foreground">Voice presence shows time spent in monitored channels. It is not evidence of productive work and is never used alone to judge individuals.</p>
    </>
  );
}
