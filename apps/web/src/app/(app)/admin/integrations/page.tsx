import type { Metadata } from "next";
import { Github, Headphones, Mail, Server } from "lucide-react";
import { StatusBadge } from "@/components/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/states";
import { serverApi } from "@/lib/api-server";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Integration settings" };

interface Data {
  discord: { credentialsPresent: boolean; integration: { status: string; guildName: string | null; minSessionSeconds: number; retentionDays: number; lastHeartbeatAt: string | null; lastError: string | null; channels: { id: string; name: string; type: string; monitored: boolean; project: { name: string } | null }[] } | null };
  github: { credentialsPresent: boolean; linkedRepositories: number };
  email: { smtpConfigured: boolean };
  queue: { redisConfigured: boolean };
  engagementWeights: { voice: number; messages: number; tasks: number } | null;
  logs: { id: string; integration: string; level: string; message: string; createdAt: string }[];
}

function Row({ ok, label }: { ok: boolean; label: string }) {
  return <p className="flex items-center gap-2 text-sm"><span className={`h-2 w-2 rounded-full ${ok ? "bg-success" : "bg-muted-foreground"}`} />{label}</p>;
}

export default async function IntegrationsPage() {
  const d = await serverApi<Data>("/integrations");
  const w = d.engagementWeights ?? { voice: 0.5, messages: 0.2, tasks: 0.3 };
  return (
    <>
      <PageHeader title="Integration settings" description="Secrets are read from server environment variables and never shown here — only whether they are present." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Headphones className="h-4 w-4 text-primary" /> Discord bot</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row ok={d.discord.credentialsPresent} label={d.discord.credentialsPresent ? "DISCORD_BOT_TOKEN and DISCORD_GUILD_ID present" : "Credentials missing"} />
            {d.discord.integration ? (
              <>
                <p className="flex items-center gap-2">Status <StatusBadge status={d.discord.integration.status} /> · last heartbeat {formatDateTime(d.discord.integration.lastHeartbeatAt)}</p>
                <p className="text-xs text-muted-foreground">Minimum voice session {d.discord.integration.minSessionSeconds}s · retention {d.discord.integration.retentionDays} days</p>
                <p className="text-xs text-muted-foreground">{d.discord.integration.channels.length} channels mapped</p>
              </>
            ) : (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">Setup required</p>
                <ol className="list-decimal space-y-0.5 pl-4">
                  <li>Create a bot in the Discord developer portal; enable the <span className="font-mono">GUILD_VOICE_STATES</span> intent (message-count telemetry also needs <span className="font-mono">GUILD_MESSAGES</span>; no message content is read).</li>
                  <li>Invite it with View Channels permission only.</li>
                  <li>Set <span className="font-mono">DISCORD_BOT_TOKEN</span> and <span className="font-mono">DISCORD_GUILD_ID</span> in the server environment and restart the worker.</li>
                </ol>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Github className="h-4 w-4" /> GitHub</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row ok={d.github.credentialsPresent} label={d.github.credentialsPresent ? "GITHUB_TOKEN present" : "GITHUB_TOKEN missing — repository sync disabled"} />
            <p className="text-xs text-muted-foreground">{d.github.linkedRepositories} repositories linked for sync. Use a fine-grained token with read-only Metadata, Contents and Pull requests access.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Email & queues</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Row ok={d.email.smtpConfigured} label={d.email.smtpConfigured ? "SMTP configured" : "SMTP not configured — emails are written to the API log"} />
            <Row ok={d.queue.redisConfigured} label={d.queue.redisConfigured ? "Redis configured for background jobs" : "REDIS_URL not set — background workers inactive"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Server className="h-4 w-4" /> Team Engagement Index</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-mono">{w.voice} × voice + {w.messages} × messages + {w.tasks} × task completion</p>
            <p className="text-xs text-muted-foreground">A configurable default for spotting teams that may need support. It is not a measure of individual productivity or competence, and telemetry alone never drives decisions.</p>
          </CardContent>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader><CardTitle>Integration log</CardTitle></CardHeader>
        <CardContent>
          {d.logs.length === 0 ? <p className="text-xs text-muted-foreground">No integration events recorded.</p> : (
            <ul className="space-y-1 font-mono text-xs">{d.logs.map((l) => <li key={l.id}><span className="text-muted-foreground">{formatDateTime(l.createdAt)}</span> [{l.integration}/{l.level}] {l.message}</li>)}</ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
