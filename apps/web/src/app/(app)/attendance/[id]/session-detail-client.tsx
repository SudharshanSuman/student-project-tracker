"use client";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Play, Square, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/states";
import { api, errorMessage } from "@/lib/api-client";
import { useAction } from "@/lib/use-action";

export function SessionStatusActions({ id, status }: { id: string; status: string }) {
  const { run } = useAction();
  if (status === "CLOSED" || status === "CANCELLED") return null;
  return (
    <>
      {status === "SCHEDULED" ? <Button size="sm" onClick={() => run(() => api(`/attendance/sessions/${id}/status`, { body: { status: "OPEN" } }), "Check-in opened")}><Play /> Open check-in</Button> : null}
      <ConfirmButton title="Close this session?" description="No further QR check-ins will be accepted. Manual corrections remain possible." confirmLabel="Close session" onConfirm={() => run(() => api(`/attendance/sessions/${id}/status`, { body: { status: "CLOSED" } }), "Session closed")}>
        <Square /> Close
      </ConfirmButton>
    </>
  );
}

/** Displays a short-lived signed QR token and refreshes it shortly before expiry. */
export function QrPanel({ id, open }: { id: string; open: boolean }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ token: string; expiresAt: string }>(`/attendance/sessions/${id}/qr`);
      const url = `${window.location.origin}/attendance/check-in?token=${encodeURIComponent(r.token)}`;
      setSvg(await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#FFFFFF" } }));
      setExpiresAt(new Date(r.expiresAt).getTime());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);
  useEffect(() => {
    if (open && expiresAt && expiresAt - now < 3000) void refresh();
  }, [now, expiresAt, open, refresh]);

  const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return (
    <Card>
      <CardHeader><CardTitle>Check-in QR</CardTitle></CardHeader>
      <CardContent>
        {!open ? <p className="text-sm text-muted-foreground">Open the session to display a QR code.</p> : error ? <p className="text-sm text-destructive">{error}</p> : svg ? (
          <div className="space-y-2">
            <div className="mx-auto max-w-[280px] overflow-hidden rounded-md bg-white p-2" role="img" aria-label="Attendance QR code" dangerouslySetInnerHTML={{ __html: svg }} />
            <p className="text-center tabular-nums text-xs text-muted-foreground">Rotates in {remaining}s · signed, short-lived token</p>
          </div>
        ) : <p className="text-sm text-muted-foreground">Generating…</p>}
      </CardContent>
    </Card>
  );
}

export function ManualAdd({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const { run, pending } = useAction();
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => api<{ users: { id: string; name: string; email: string }[] }>(`/users/lookup?q=${encodeURIComponent(q)}`).then((r) => setUsers(r.users)).catch(() => setUsers([])), 250);
    return () => clearTimeout(t);
  }, [q, open]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><UserPlus /> Manual entry</Button></DialogTrigger>
      <DialogContent title="Add attendance manually" description="For participants who could not scan. Recorded as a correction with your name and reason.">
        <Input placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        <Select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Participant">
          <option value="">Choose a participant…</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
        </Select>
        <Field label="Reason" htmlFor="ma-reason"><Input id="ma-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending || !userId || !reason.trim()} onClick={async () => {
            const r = await run(() => api(`/attendance/sessions/${sessionId}/manual`, { body: { userId, reason } }), "Attendance added");
            if (r !== undefined) { setOpen(false); setReason(""); setUserId(""); }
          }}>Add</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CorrectRecord({ id, status }: { id: string; status: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, pending } = useAction();
  const target = status === "REVOKED" ? "PRESENT" : "REVOKED";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">{target === "REVOKED" ? "Revoke" : "Restore"}</Button></DialogTrigger>
      <DialogContent title={target === "REVOKED" ? "Revoke this check-in?" : "Restore this check-in?"} description="Corrections are kept in the audit log with your name and reason.">
        <Field label="Reason" htmlFor={`cr-${id}`}><Input id={`cr-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant={target === "REVOKED" ? "destructive" : "default"} disabled={pending || !reason.trim()} onClick={async () => {
            const r = await run(() => api(`/attendance/records/${id}`, { method: "PATCH", body: { status: target, reason } }), "Record corrected");
            if (r !== undefined) setOpen(false);
          }}>Confirm</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
