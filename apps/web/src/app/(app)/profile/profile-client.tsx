"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { passwordSchema } from "@iic/shared";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils";
import { useAction } from "@/lib/use-action";

const profileForm = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  department: z.string().max(120),
  phone: z.string().max(40),
  bio: z.string().max(1000),
  githubUsername: z.string().max(39).regex(/^[A-Za-z0-9-]*$/, "Letters, numbers and dashes only"),
});

export function ProfileForm({ me }: { me: { name: string; department: string | null; phone: string | null; bio: string | null; githubUsername: string | null } }) {
  const { run, pending } = useAction();
  const { register, handleSubmit, formState } = useForm<z.infer<typeof profileForm>>({
    resolver: zodResolver(profileForm),
    defaultValues: { name: me.name, department: me.department ?? "", phone: me.phone ?? "", bio: me.bio ?? "", githubUsername: me.githubUsername ?? "" },
  });
  return (
    <form noValidate className="grid gap-3" onSubmit={handleSubmit((v) => run(() => api("/users/profile", { method: "PATCH", body: v }), "Profile saved"))}>
      <Field label="Name" htmlFor="pf-name" error={formState.errors.name?.message}><Input id="pf-name" {...register("name")} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Department" htmlFor="pf-dept"><Input id="pf-dept" {...register("department")} /></Field>
        <Field label="Phone" htmlFor="pf-phone"><Input id="pf-phone" {...register("phone")} /></Field>
      </div>
      <Field label="GitHub username" htmlFor="pf-gh" error={formState.errors.githubUsername?.message}><Input id="pf-gh" {...register("githubUsername")} /></Field>
      <Field label="Bio" htmlFor="pf-bio"><Textarea id="pf-bio" rows={3} {...register("bio")} /></Field>
      <div className="flex justify-end"><Button disabled={pending}>Save profile</Button></div>
    </form>
  );
}

const pwForm = z.object({ currentPassword: z.string().min(1, "Required"), newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

export function ChangePasswordForm() {
  const { run, pending } = useAction();
  const { register, handleSubmit, formState, reset } = useForm<z.infer<typeof pwForm>>({ resolver: zodResolver(pwForm) });
  return (
    <form noValidate className="grid gap-3" onSubmit={handleSubmit(async (v) => {
      const r = await run(() => api("/auth/password/change", { body: { currentPassword: v.currentPassword, newPassword: v.newPassword } }), "Password changed; other sessions signed out");
      if (r !== undefined) reset();
    })}>
      <Field label="Current password" htmlFor="pw-cur" error={formState.errors.currentPassword?.message}><Input id="pw-cur" type="password" autoComplete="current-password" {...register("currentPassword")} /></Field>
      <Field label="New password" htmlFor="pw-new" error={formState.errors.newPassword?.message}><Input id="pw-new" type="password" autoComplete="new-password" {...register("newPassword")} /></Field>
      <Field label="Confirm" htmlFor="pw-confirm" error={formState.errors.confirm?.message}><Input id="pw-confirm" type="password" autoComplete="new-password" {...register("confirm")} /></Field>
      <div className="flex justify-end"><Button disabled={pending}>Change password</Button></div>
    </form>
  );
}

export function SessionsList({ sessions }: { sessions: { id: string; createdAt: string; lastSeenAt: string; ip: string | null; userAgent: string | null; current: boolean }[] }) {
  const { run, pending } = useAction();
  return (
    <ul className="space-y-2">
      {sessions.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0">
            <span className="block truncate">{s.userAgent ?? "Unknown device"}</span>
            <span className="block font-mono text-[11px] text-muted-foreground">{s.ip ?? "—"} · last seen {formatDateTime(s.lastSeenAt)}</span>
          </span>
          {s.current ? <span className="text-xs bg-success px-1 text-foreground">This device</span> : <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => api(`/users/profile/sessions/${s.id}`, { method: "DELETE" }), "Session signed out")}>Sign out</Button>}
        </li>
      ))}
    </ul>
  );
}
