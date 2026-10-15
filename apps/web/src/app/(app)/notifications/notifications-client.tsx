"use client";
import { useState } from "react";
import { CheckCheck, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { humanize } from "@/lib/utils";
import { useAction } from "@/lib/use-action";

export function MarkRead({ id }: { id: string }) {
  const { run, pending } = useAction();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => api(`/notifications/${id}/read`, { method: "POST" }))}>Mark read</Button>;
}

export function MarkAllRead() {
  const { run, pending } = useAction();
  return <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => api("/notifications/read-all", { method: "POST" }), "All marked read")}><CheckCheck /> Mark all read</Button>;
}

export function Preferences({ preferences }: { preferences: { type: string; inApp: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(preferences);
  const { run, pending } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Settings2 /> Preferences</Button></DialogTrigger>
      <DialogContent title="Notification preferences" description="Choose which in-app notifications you receive.">
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {prefs.map((p) => (
            <li key={p.type}>
              <label className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                {humanize(p.type)}
                <input type="checkbox" className="accent-primary" checked={p.inApp} onChange={(e) => setPrefs((ps) => ps.map((x) => (x.type === p.type ? { ...x, inApp: e.target.checked } : x)))} />
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending} onClick={async () => { const r = await run(() => api("/notifications/preferences", { method: "PUT", body: { preferences: prefs } }), "Preferences saved"); if (r !== undefined) setOpen(false); }}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
