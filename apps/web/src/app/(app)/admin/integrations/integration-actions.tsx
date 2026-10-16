"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  AlertCircle,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Sliders,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/states";
import { api, errorMessage } from "@/lib/api-client";

// ── Discord Configuration Form ──

const discordSetupSchema = z.object({
  guildId: z.string().trim().min(1, "Guild ID is required"),
  guildName: z.string().trim().optional(),
  minSessionSeconds: z.coerce.number().int().min(10).max(3600),
  countMessages: z.boolean(),
  retentionDays: z.coerce.number().int().min(7).max(730),
});
type DiscordSetupValues = z.infer<typeof discordSetupSchema>;

export function ConfigureDiscordDialog({
  initialData,
}: {
  initialData: {
    guildId?: string;
    guildName?: string | null;
    minSessionSeconds?: number;
    countMessages?: boolean;
    retentionDays?: number;
  } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, formState } = useForm<DiscordSetupValues>({
    resolver: zodResolver(discordSetupSchema),
    defaultValues: {
      guildId: initialData?.guildId ?? "",
      guildName: initialData?.guildName ?? "",
      minSessionSeconds: initialData?.minSessionSeconds ?? 300,
      countMessages: initialData?.countMessages ?? true,
      retentionDays: initialData?.retentionDays ?? 365,
    },
  });

  async function onSubmit(values: DiscordSetupValues) {
    try {
      await api("/integrations/discord/setup", {
        body: values,
      });
      toast.success("Discord integration settings saved");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings className="h-4 w-4" /> Configure Bot
        </Button>
      </DialogTrigger>
      <DialogContent title="Discord Bot Settings" description="Configure server guild, voice attendance rules, and telemetry retention.">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 text-sm">
          <Field label="Guild (Server) ID" htmlFor="disc-guild" error={formState.errors.guildId?.message}>
            <Input id="disc-guild" placeholder="e.g. 110022334455667788" {...register("guildId")} />
          </Field>
          <Field label="Server Name (Optional)" htmlFor="disc-name" error={formState.errors.guildName?.message}>
            <Input id="disc-name" placeholder="e.g. Innovation Cell Guild" {...register("guildName")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min Voice Session (seconds)" htmlFor="disc-min" error={formState.errors.minSessionSeconds?.message}>
              <Input id="disc-min" type="number" {...register("minSessionSeconds")} />
            </Field>
            <Field label="Retention (days)" htmlFor="disc-ret" error={formState.errors.retentionDays?.message}>
              <Input id="disc-ret" type="number" {...register("retentionDays")} />
            </Field>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <input type="checkbox" id="disc-msg" {...register("countMessages")} className="rounded border-input" />
            <label htmlFor="disc-msg" className="text-xs text-muted-foreground">
              Count messages in monitored text channels (aggregates only; content is never inspected)
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save Settings</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Map Channel Dialog ──

const channelSchema = z.object({
  channelId: z.string().trim().min(1, "Channel ID is required"),
  name: z.string().trim().min(1, "Channel name is required"),
  type: z.enum(["VOICE", "TEXT"]),
  projectId: z.string().optional(),
});
type ChannelValues = z.infer<typeof channelSchema>;

export function MapChannelDialog({
  projects,
}: {
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, reset } = useForm<ChannelValues>({
    resolver: zodResolver(channelSchema),
    defaultValues: { type: "VOICE", projectId: "" },
  });

  async function onSubmit(values: ChannelValues) {
    try {
      await api("/integrations/discord/channels", {
        body: {
          ...values,
          monitored: true,
          projectId: values.projectId || null,
        },
      });
      toast.success("Channel mapping saved");
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" /> Map Channel
        </Button>
      </DialogTrigger>
      <DialogContent title="Map Discord Channel" description="Map a Discord voice or text channel to a project for attendance and telemetry.">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 text-sm">
          <Field label="Channel ID" htmlFor="ch-id">
            <Input id="ch-id" placeholder="e.g. 109988776655443322" {...register("channelId")} />
          </Field>
          <Field label="Channel Name" htmlFor="ch-name">
            <Input id="ch-name" placeholder="e.g. team-alpha-voice" {...register("name")} />
          </Field>
          <Field label="Channel Type" htmlFor="ch-type">
            <Select id="ch-type" {...register("type")}>
              <option value="VOICE">Voice Channel (attendance tracking)</option>
              <option value="TEXT">Text Channel (message count telemetry)</option>
            </Select>
          </Field>
          <Field label="Link to Project (Optional)" htmlFor="ch-proj">
            <Select id="ch-proj" {...register("projectId")}>
              <option value="">— Unlinked / Cell-wide —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save Channel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete Channel Button ──

export function DeleteChannelButton({ channelId }: { channelId: string }) {
  const router = useRouter();

  async function onDelete() {
    try {
      await api(`/integrations/discord/channels/${channelId}`, { method: "DELETE" });
      toast.success("Channel mapping removed");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <ConfirmButton
      title="Remove channel mapping?"
      description="The channel will stop being monitored for Discord engagement telemetry."
      confirmLabel="Remove"
      destructive
      variant="ghost"
      size="sm"
      onConfirm={onDelete}
    >
      <Trash2 className="h-3 w-3" />
    </ConfirmButton>
  );
}

// ── Simulate Activity (Verification Helper) ──

export function SimulateDiscordActivityDialog({
  channels,
}: {
  channels: { id: string; channelId: string; name: string; type: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [simType, setSimType] = useState<"voice-join" | "voice-leave" | "message">("voice-join");
  const [channelId, setChannelId] = useState(channels[0]?.channelId ?? "");
  const [discordUserId, setDiscordUserId] = useState("simulated-student-01");
  const [loading, setLoading] = useState(false);

  async function onSimulate() {
    setLoading(true);
    try {
      await api("/integrations/discord/simulate", {
        body: {
          eventType: simType,
          channelId,
          discordUserId,
        },
      });
      toast.success(`Simulated ${simType} event processed successfully`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Play className="h-3 w-3" /> Test Simulation
        </Button>
      </DialogTrigger>
      <DialogContent title="Simulate Discord Event" description="Test the telemetry and voice-attendance pipeline without a live Discord bot.">
        <div className="space-y-3 text-sm">
          <Field label="Event Type" htmlFor="sim-type">
            <Select
              id="sim-type"
              value={simType}
              onChange={(e) => setSimType(e.target.value as "voice-join" | "voice-leave" | "message")}
            >
              <option value="voice-join">Voice Join (starts voice session)</option>
              <option value="voice-leave">Voice Leave (calculates duration, updates daily total)</option>
              <option value="message">Message Post (increments daily message count)</option>
            </Select>
          </Field>
          <Field label="Channel" htmlFor="sim-channel">
            <Select id="sim-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              {channels.map((c) => (
                <option key={c.channelId} value={c.channelId}>
                  {c.name} ({c.type})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Simulated Discord User ID" htmlFor="sim-user">
            <Input id="sim-user" value={discordUserId} onChange={(e) => setDiscordUserId(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onSimulate} disabled={loading || !channelId}>
              {loading ? "Running..." : "Dispatch Event"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Team Engagement Weights Dialog ──

export function ConfigureWeightsDialog({
  initialWeights,
}: {
  initialWeights: { voice: number; messages: number; tasks: number };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [voice, setVoice] = useState(initialWeights.voice);
  const [messages, setMessages] = useState(initialWeights.messages);
  const [tasks, setTasks] = useState(initialWeights.tasks);
  const [loading, setLoading] = useState(false);

  const sum = Math.round((voice + messages + tasks) * 100) / 100;
  const isValid = Math.abs(sum - 1.0) < 0.05;

  async function onSave() {
    if (!isValid) return;
    setLoading(true);
    try {
      await api("/integrations/engagement-weights", {
        method: "PUT",
        body: { voice, messages, tasks },
      });
      toast.success("Team Engagement formula weights updated");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Sliders className="h-4 w-4" /> Edit Formula
        </Button>
      </DialogTrigger>
      <DialogContent title="Team Engagement Index Formula" description="Configure weights for the administrative health formula. Weights must sum to 1.0.">
        <div className="space-y-4 text-sm">
          <div>
            <div className="flex justify-between mb-1">
              <span>Voice Attendance / Presence ({Math.round(voice * 100)}%)</span>
              <span className="tabular-nums text-xs">{voice}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={voice}
              onChange={(e) => setVoice(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span>Message Activity ({Math.round(messages * 100)}%)</span>
              <span className="tabular-nums text-xs">{messages}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={messages}
              onChange={(e) => setMessages(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span>Task Progress / Completion ({Math.round(tasks * 100)}%)</span>
              <span className="tabular-nums text-xs">{tasks}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={tasks}
              onChange={(e) => setTasks(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
          <div className="rounded border p-2 text-xs">
            <span className={isValid ? "text-success font-medium" : "text-destructive font-medium"}>
              Total Weight: {sum} {isValid ? "✓ (Balanced)" : "✗ (Must equal 1.0)"}
            </span>
            <p className="mt-1 text-muted-foreground">
              Formula: {voice} × Voice + {messages} × Messages + {tasks} × Tasks
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={loading || !isValid}>
              Save Weights
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Link GitHub Repository Dialog ──

const linkGithubSchema = z.object({
  projectId: z.string().min(1, "Select a project"),
  owner: z.string().trim().min(1, "Owner is required"),
  repo: z.string().trim().min(1, "Repository name is required"),
  token: z.string().trim().optional(),
  webhookSecret: z.string().trim().optional(),
});
type LinkGithubValues = z.infer<typeof linkGithubSchema>;

export function LinkGitHubDialog({
  projects,
}: {
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, formState, reset } = useForm<LinkGithubValues>({
    resolver: zodResolver(linkGithubSchema),
    defaultValues: { projectId: "", owner: "", repo: "", token: "", webhookSecret: "" },
  });

  async function onSubmit(values: LinkGithubValues) {
    try {
      await api("/integrations/github/link", {
        body: {
          projectId: values.projectId,
          owner: values.owner,
          repo: values.repo,
          token: values.token || undefined,
          webhookSecret: values.webhookSecret || undefined,
        },
      });
      toast.success("GitHub repository linked successfully");
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" /> Link Repository
        </Button>
      </DialogTrigger>
      <DialogContent title="Link GitHub Repository" description="Connect a project to GitHub. Scoped credentials and webhook secrets are encrypted at rest.">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 text-sm">
          <Field label="Project" htmlFor="gh-proj" error={formState.errors.projectId?.message}>
            <Select id="gh-proj" {...register("projectId")}>
              <option value="">— Select project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Owner / Organization" htmlFor="gh-owner" error={formState.errors.owner?.message}>
              <Input id="gh-owner" placeholder="e.g. facebook" {...register("owner")} />
            </Field>
            <Field label="Repository Name" htmlFor="gh-repo" error={formState.errors.repo?.message}>
              <Input id="gh-repo" placeholder="e.g. react" {...register("repo")} />
            </Field>
          </div>
          <Field label="Scoped Access Token (Optional)" htmlFor="gh-tok">
            <Input id="gh-tok" type="password" placeholder="Fine-grained token (encrypted at rest)" {...register("token")} />
          </Field>
          <Field label="Webhook Secret (Optional)" htmlFor="gh-sec">
            <Input id="gh-sec" type="password" placeholder="Webhook secret for HMAC validation" {...register("webhookSecret")} />
          </Field>
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Link Repository</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Sync GitHub Button ──

export function SyncGitHubButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onSync() {
    setLoading(true);
    try {
      const res = await api<{ ok: boolean; defaultBranch?: string }>(`/integrations/github/sync/${projectId}`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success("Repository synced successfully");
      } else {
        toast.warning("Repository sync completed with warnings");
      }
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={onSync} disabled={loading} className="h-7 px-2 text-xs">
      <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
      Sync Now
    </Button>
  );
}

// ── Inactivity Review Button ──

export function ReviewAlertButton({
  alertId,
  status,
}: {
  alertId: string;
  status: "RESOLVED" | "DISMISSED";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function onReview() {
    setLoading(true);
    try {
      await api(`/integrations/alerts/${alertId}/review`, {
        body: { status, reviewNote: note.trim() || null },
      });
      toast.success(`Alert marked as ${status.toLowerCase()}`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setNote(""); }}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`h-7 px-2 text-xs ${status === "RESOLVED" ? "text-success" : "text-muted-foreground"}`}
        >
          {status === "RESOLVED" ? "Resolve" : "Dismiss"}
        </Button>
      </DialogTrigger>
      <DialogContent title={`Mark alert as ${status.toLowerCase()}`} description="An optional note is kept with the review for the audit trail.">
        <Field label="Note (optional)" htmlFor="alert-note">
          <Input id="alert-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this alert is being closed" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={loading} onClick={onReview}>{loading ? "Working…" : "Confirm"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Maintenance Actions ──

export function MaintenanceActions() {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  async function onScan() {
    setScanning(true);
    try {
      const res = await api<{ alertsGenerated: number }>("/integrations/maintenance/scan-inactivity", {
        method: "POST",
      });
      toast.success(`Inactivity scan completed: ${res.alertsGenerated} alert(s) generated`);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setScanning(false);
    }
  }

  async function onCleanup() {
    setCleaning(true);
    try {
      const res = await api<{ sessionsRecovered: number; purgedSessions: number }>("/integrations/maintenance/cleanup", {
        method: "POST",
      });
      toast.success(`Maintenance complete: ${res.sessionsRecovered} session(s) recovered, ${res.purgedSessions} purged`);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCleaning(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={onScan} disabled={scanning} className="text-xs">
        <AlertCircle className="h-3 w-3 mr-1" />
        {scanning ? "Scanning..." : "Scan Inactivity"}
      </Button>
      <Button variant="outline" size="sm" onClick={onCleanup} disabled={cleaning} className="text-xs">
        <RefreshCw className="h-3 w-3 mr-1" />
        {cleaning ? "Running..." : "Run Retention Cleanup"}
      </Button>
    </div>
  );
}
