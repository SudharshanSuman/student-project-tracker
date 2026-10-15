"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Copy, MailPlus } from "lucide-react";
import { toast } from "sonner";
import { ROLE_LABELS, ROLES, type Role } from "@iic/shared";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/states";
import { api } from "@/lib/api-client";
import { useAction } from "@/lib/use-action";

const inviteForm = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email"), role: z.enum(ROLES), cohortId: z.string(), projectId: z.string() });

export function InviteDialog({ cohorts, projects }: { cohorts: { id: string; name: string }[]; projects: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const { run, pending } = useAction();
  const { register, handleSubmit, formState, reset, watch } = useForm<z.infer<typeof inviteForm>>({ resolver: zodResolver(inviteForm), defaultValues: { email: "", role: "PROJECT_MEMBER", cohortId: "", projectId: "" } });
  const role = watch("role");
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setLink(null); reset(); } }}>
      <DialogTrigger asChild><Button><MailPlus /> Invite user</Button></DialogTrigger>
      <DialogContent title="Invite a user" description="Only institutional email addresses are accepted. The invitation expires in 7 days.">
        {link ? (
          <div className="space-y-2 text-sm">
            <p>Email delivery is not configured, so share this one-time link with the invitee:</p>
            <div className="flex gap-2"><Input readOnly value={link} aria-label="Invitation link" className="font-mono text-xs" /><Button size="icon" variant="outline" aria-label="Copy link" onClick={() => { void navigator.clipboard.writeText(link); toast.success("Copied"); }}><Copy /></Button></div>
          </div>
        ) : (
          <form noValidate className="grid gap-3" onSubmit={handleSubmit(async (v) => {
            const r = await run(() => api<{ inviteUrl?: string }>("/users/invitations", { body: { email: v.email, role: v.role, cohortId: v.cohortId || null, projectId: v.projectId || null } }), "Invitation created");
            if (r?.inviteUrl) setLink(r.inviteUrl);
            else if (r !== undefined) setOpen(false);
          })}>
            <Field label="Institutional email" htmlFor="inv-email" error={formState.errors.email?.message}><Input id="inv-email" type="email" {...register("email")} /></Field>
            <Field label="Role" htmlFor="inv-role"><Select id="inv-role" {...register("role")}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select></Field>
            {role === "PROJECT_LEAD" || role === "PROJECT_MEMBER" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Add to project (optional)" htmlFor="inv-project"><Select id="inv-project" {...register("projectId")}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
                <Field label="Cohort (optional)" htmlFor="inv-cohort"><Select id="inv-cohort" {...register("cohortId")}><option value="">None</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
              </div>
            ) : null}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pending}>Send invitation</Button></div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function UserRowActions({ user }: { user: { id: string; name: string; role: Role; status: string } }) {
  const { run, pending } = useAction();
  return (
    <div className="flex items-center justify-end gap-1">
      <Select aria-label={`Role for ${user.name}`} className="h-8 w-36 text-xs" value={user.role} disabled={pending}
        onChange={(e) => run(() => api(`/users/${user.id}`, { method: "PATCH", body: { role: e.target.value } }), "Role updated")}>
        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      </Select>
      {user.status === "ACTIVE" ? (
        <ConfirmButton variant="ghost" destructive title={`Disable ${user.name}?`} description="They are signed out everywhere and cannot sign in until re-enabled." confirmLabel="Disable" onConfirm={() => run(() => api(`/users/${user.id}`, { method: "PATCH", body: { status: "DISABLED" } }), "User disabled")}>Disable</ConfirmButton>
      ) : user.status === "DISABLED" ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => api(`/users/${user.id}`, { method: "PATCH", body: { status: "ACTIVE" } }), "User enabled")}>Enable</Button>
      ) : null}
    </div>
  );
}

export function RevokeInvitation({ id, email }: { id: string; email: string }) {
  const { run } = useAction();
  return <ConfirmButton variant="ghost" destructive title={`Revoke invitation for ${email}?`} description="The link stops working immediately." confirmLabel="Revoke" onConfirm={() => run(() => api(`/users/invitations/${id}`, { method: "DELETE" }), "Invitation revoked")}>Revoke</ConfirmButton>;
}
