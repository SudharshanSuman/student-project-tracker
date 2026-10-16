import type { Metadata } from "next";
import { AlertTriangle, BookOpen, Database, Github, Headphones, Server, Shield } from "lucide-react";
import { StatusBadge } from "@/components/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { serverApi } from "@/lib/api-server";
import { formatDateTime } from "@/lib/utils";
import {
  ConfigureDiscordDialog,
  ConfigureWeightsDialog,
  DeleteChannelButton,
  LinkGitHubDialog,
  MaintenanceActions,
  MapChannelDialog,
  ReviewAlertButton,
  SimulateDiscordActivityDialog,
  SyncGitHubButton,
} from "./integration-actions";

export const metadata: Metadata = { title: "Integration settings" };

interface Repository {
  id: string;
  projectId: string;
  owner: string;
  repo: string;
  defaultBranch: string | null;
  status: string;
  latestCommitAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  project: { id: string; name: string; repoUrl: string | null };
  activity: { date: string; commitCount: number; prOpened: number; prMerged: number }[];
}

interface OpenAlert {
  id: string;
  projectId: string;
  reason: string;
  status: string;
  createdAt: string;
  project: { id: string; name: string };
}

interface Data {
  discord: {
    credentialsPresent: boolean;
    integration: {
      guildId: string;
      status: string;
      guildName: string | null;
      minSessionSeconds: number;
      retentionDays: number;
      countMessages: boolean;
      lastHeartbeatAt: string | null;
      lastError: string | null;
      channels: {
        id: string;
        channelId: string;
        name: string;
        type: string;
        monitored: boolean;
        project: { id: string; name: string } | null;
      }[];
    } | null;
  };
  github: {
    credentialsPresent: boolean;
    linkedRepositories: number;
    repositories?: Repository[];
  };
  email: { smtpConfigured: boolean };
  queue: {
    redisConfigured: boolean;
    redisConnected?: boolean;
    activeMode?: string;
    workersCount?: number;
    pendingJobsCount?: number;
  };
  engagementWeights: { voice: number; messages: number; tasks: number } | null;
  openAlerts?: OpenAlert[];
  logs: { id: string; integration: string; level: string; message: string; createdAt: string }[];
}

interface ProjectsResponse {
  projects: { id: string; name: string }[];
}

function Row({ ok, label }: { ok: boolean; label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-success" : "bg-muted-foreground"}`} />
      {label}
    </p>
  );
}

export default async function IntegrationsPage() {
  const [d, p] = await Promise.all([
    serverApi<Data>("/integrations"),
    serverApi<ProjectsResponse>("/projects?pageSize=100"),
  ]);

  const projects = p.projects ?? [];
  const w = d.engagementWeights ?? { voice: 0.5, messages: 0.2, tasks: 0.3 };
  const channels = d.discord.integration?.channels ?? [];
  const repos = d.github.repositories ?? [];
  const alerts = d.openAlerts ?? [];

  return (
    <>
      <PageHeader
        title="Integration settings"
        description="Configure Discord voice attendance, GitHub repository sync, background workers, and privacy telemetry."
      />

      <div className="grid gap-4 md:grid-cols-2">
        {/* Discord Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Headphones className="h-4 w-4 text-link" /> Discord Bot
            </CardTitle>
            <div className="flex gap-2">
              <ConfigureDiscordDialog initialData={d.discord.integration} />
              {channels.length > 0 && <SimulateDiscordActivityDialog channels={channels} />}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row
              ok={d.discord.credentialsPresent}
              label={
                d.discord.credentialsPresent
                  ? "DISCORD_BOT_TOKEN and DISCORD_GUILD_ID configured"
                  : "Environment credentials missing (standby mode — architecture active)"
              }
            />

            {d.discord.integration ? (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    {d.discord.integration.guildName || `Guild ${d.discord.integration.guildId}`}
                  </span>
                  <StatusBadge status={d.discord.integration.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Last heartbeat: {formatDateTime(d.discord.integration.lastHeartbeatAt)}
                  {d.discord.integration.lastError && (
                    <span className="block bg-destructive px-1 text-foreground">Error: {d.discord.integration.lastError}</span>
                  )}
                </p>
                <div className="flex justify-between text-xs text-muted-foreground border-t pt-2">
                  <span>Min duration: {d.discord.integration.minSessionSeconds}s</span>
                  <span>Retention: {d.discord.integration.retentionDays}d</span>
                  <span>Messages: {d.discord.integration.countMessages ? "Counted" : "Off"}</span>
                </div>
              </div>
            ) : null}

            {/* Monitored Channels */}
            <div className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Monitored Channels ({channels.length})
                </span>
                <MapChannelDialog projects={projects} />
              </div>

              {channels.length === 0 ? (
                <p className="text-xs text-muted-foreground border border-dashed rounded p-2 text-center">
                  No channels mapped. Map voice channels to projects to track attendance sessions.
                </p>
              ) : (
                <div className="rounded border divide-y max-h-40 overflow-y-auto">
                  {channels.map((c) => (
                    <div key={c.id} className="flex items-center justify-between p-2 text-xs">
                      <div>
                        <span className="font-mono font-medium">{c.name}</span>
                        <span className="ml-2 text-muted-foreground">({c.type})</span>
                        <span className="block text-muted-foreground">
                          Project: {c.project?.name ?? "Cell-wide"}
                        </span>
                      </div>
                      <DeleteChannelButton channelId={c.id} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* GitHub Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Github className="h-4 w-4" /> GitHub Integration
            </CardTitle>
            <LinkGitHubDialog projects={projects} />
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row
              ok={d.github.credentialsPresent}
              label={
                d.github.credentialsPresent
                  ? "GITHUB_TOKEN configured (read-only metadata & commits)"
                  : "GITHUB_TOKEN missing from env — per-project encrypted tokens supported"
              }
            />

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{d.github.linkedRepositories} linked repositories</span>
              <span>Encrypted credentials at rest (AES-256-GCM)</span>
            </div>

            {repos.length === 0 ? (
              <p className="text-xs text-muted-foreground border border-dashed rounded p-3 text-center">
                No repositories linked yet. Click &quot;Link Repository&quot; to link a project.
              </p>
            ) : (
              <div className="rounded border divide-y max-h-56 overflow-y-auto">
                {repos.map((r) => (
                  <div key={r.id} className="p-2.5 text-xs flex items-center justify-between">
                    <div>
                      <span className="font-semibold">{r.project.name}</span>
                      <span className="ml-2 font-mono text-muted-foreground">
                        {r.owner}/{r.repo}
                      </span>
                      <div className="mt-1 flex gap-3 text-muted-foreground">
                        <span>Branch: {r.defaultBranch ?? "—"}</span>
                        <span>Latest: {formatDateTime(r.latestCommitAt)}</span>
                        <span>Status: <StatusBadge status={r.status} /></span>
                      </div>
                    </div>
                    <SyncGitHubButton projectId={r.projectId} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Queues and Maintenance */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Server className="h-4 w-4" /> Workers & Infrastructure
            </CardTitle>
            <MaintenanceActions />
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row
              ok={d.queue.redisConfigured}
              label={
                d.queue.redisConfigured
                  ? "Redis configured (BullMQ workers active)"
                  : "Redis URL not set — In-memory job worker active with retries & backoff"
              }
            />

            <div className="rounded-md border p-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <span className="text-muted-foreground block">Queue Engine</span>
                <span className="font-mono font-medium uppercase text-foreground">
                  {d.queue.activeMode ?? (d.queue.redisConfigured ? "BullMQ" : "In-Memory")}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">Workers</span>
                <span className="font-medium tabular-nums text-foreground">
                  {d.queue.workersCount ?? 3} active
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">Pending Jobs</span>
                <span className="font-medium tabular-nums text-foreground">
                  {d.queue.pendingJobsCount ?? 0}
                </span>
              </div>
            </div>

            <Row ok={d.email.smtpConfigured} label={d.email.smtpConfigured ? "SMTP email configured" : "SMTP not configured — emails written to API log"} />
          </CardContent>
        </Card>

        {/* Team Engagement Formula */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4 text-link" /> Team Engagement Index
            </CardTitle>
            <ConfigureWeightsDialog initialWeights={w} />
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-md bg-muted p-3 font-mono text-xs">
              {w.voice} × voice + {w.messages} × messages + {w.tasks} × tasks
            </div>
            <p className="text-xs text-muted-foreground">
              A configurable default for spotting teams that may need support. It is an operational administrative guide, not an individual productivity or competence measure.
            </p>
            <div className="flex items-center gap-2 text-xs bg-success px-1 text-foreground">
              <Shield className="h-3.5 w-3.5" />
              Privacy preserving: message content and private messages are strictly excluded.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Inactivity Alerts */}
      {alerts.length > 0 && (
        <Card className="mt-4 border-foreground">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 bg-warning px-1 text-foreground">
              <AlertTriangle className="h-4 w-4" /> Open Inactivity Alerts ({alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Project</TH>
                  <TH>Reason</TH>
                  <TH>Detected</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {alerts.map((a) => (
                  <TR key={a.id}>
                    <TD className="font-medium">{a.project.name}</TD>
                    <TD className="text-xs text-muted-foreground">{a.reason}</TD>
                    <TD className="tabular-nums text-xs">{formatDateTime(a.createdAt)}</TD>
                    <TD className="text-right space-x-2">
                      <ReviewAlertButton alertId={a.id} status="RESOLVED" />
                      <ReviewAlertButton alertId={a.id} status="DISMISSED" />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Setup Instructions / Documentation Guide */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Integration Setup & Credentials Guide
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-xs text-muted-foreground">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border p-3 space-y-2">
              <p className="font-medium text-foreground flex items-center gap-1.5">
                <Headphones className="h-3.5 w-3.5 text-link" /> Discord Bot Setup Requirements
              </p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>Create application in <span className="font-mono text-foreground">discord.com/developers/applications</span>.</li>
                <li>Under <strong>Bot</strong>, click <strong>Reset Token</strong> to copy <span className="font-mono text-foreground">DISCORD_BOT_TOKEN</span>.</li>
                <li>Under <strong>Privileged Gateway Intents</strong>, toggle ON:
                  <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                    <li><span className="font-mono text-foreground">Server Members Intent</span></li>
                    <li><span className="font-mono text-foreground">Guild Voice States</span> (Required for voice session start/leave detection)</li>
                    <li><span className="font-mono text-foreground">Guild Messages</span> (Only for message count aggregates; no message content is ever accessed)</li>
                  </ul>
                </li>
                <li>Under <strong>OAuth2 → URL Generator</strong>, select <span className="font-mono">bot</span> scope with permissions: <em>View Channels, Connect, Read Message History</em>.</li>
                <li>Invite bot to your server; copy Server ID as <span className="font-mono text-foreground">DISCORD_GUILD_ID</span>.</li>
              </ol>
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <p className="font-medium text-foreground flex items-center gap-1.5">
                <Github className="h-3.5 w-3.5" /> GitHub Token & Webhook Setup Requirements
              </p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>Go to GitHub <strong>Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens</strong>.</li>
                <li>Grant repository access with read-only permissions:
                  <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                    <li><span className="font-mono text-foreground">Repository metadata: Read-only</span></li>
                    <li><span className="font-mono text-foreground">Contents: Read-only</span> (for commit summaries)</li>
                    <li><span className="font-mono text-foreground">Pull requests: Read-only</span> (for PR summaries)</li>
                  </ul>
                </li>
                <li>Add token to <span className="font-mono text-foreground">GITHUB_TOKEN</span> in <span className="font-mono">.env</span> or paste in the project link dialog (encrypted at rest with AES-256-GCM).</li>
                <li>Webhooks (optional): In repo Settings → Webhooks, set Payload URL to <span className="font-mono text-foreground">https://&lt;domain&gt;/api/integrations/github/webhook</span> with Content type <span className="font-mono">application/json</span>.</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Integration Logs */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Integration Log</CardTitle>
        </CardHeader>
        <CardContent>
          {d.logs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No integration events recorded.</p>
          ) : (
            <ul className="space-y-1 font-mono text-xs max-h-60 overflow-y-auto">
              {d.logs.map((l) => (
                <li key={l.id} className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">{formatDateTime(l.createdAt)}</span>
                  <span
                    className={`font-semibold shrink-0 ${
                      l.level === "ERROR"
                        ? "bg-destructive px-1 text-foreground"
                        : l.level === "WARN"
                        ? "bg-warning px-1 text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    [{l.integration}/{l.level}]
                  </span>
                  <span className="truncate">{l.message}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
