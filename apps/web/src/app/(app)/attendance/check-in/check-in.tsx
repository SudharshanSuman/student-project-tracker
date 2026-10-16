"use client";
import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, MapPin, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/api-client";

type Result = { ok: true; session: string; at: string } | { ok: false; message: string };

export function CheckIn({ token }: { token: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareLocation, setShareLocation] = useState(false);

  async function getLocation(): Promise<{ latitude: number; longitude: number } | undefined> {
    if (!shareLocation || !("geolocation" in navigator)) return undefined;
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
        () => resolve(undefined),
        { timeout: 8000, maximumAge: 60_000 },
      );
    });
  }

  async function submit() {
    setBusy(true);
    try {
      const location = await getLocation();
      const r = await api<{ record: { checkedInAt: string }; session: { name: string } }>("/attendance/check-in", { body: { token, location } });
      setResult({ ok: true, session: r.session.name, at: r.record.checkedInAt });
    } catch (e) {
      setResult({ ok: false, message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attendance check-in</CardTitle>
          <CardDescription>Confirm your attendance for the session whose QR code you scanned.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!token ? <p className="text-sm text-muted-foreground">No QR token found. Scan the code displayed at the session.</p> : result ? (
            result.ok ? (
              <div className="flex items-start gap-3 text-sm"><CheckCircle2 className="h-5 w-5 bg-success px-1 text-foreground" /><div><p className="font-medium">Checked in to {result.session}</p><p className="text-muted-foreground">{new Date(result.at).toLocaleString()}</p></div></div>
            ) : (
              <div className="flex items-start gap-3 text-sm"><XCircle className="h-5 w-5 bg-destructive px-1 text-foreground" /><p>{result.message}</p></div>
            )
          ) : (
            <>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 accent-primary" checked={shareLocation} onChange={(e) => setShareLocation(e.target.checked)} />
                <span><span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> Share my location for this check-in (optional)</span><span className="block text-xs text-muted-foreground">Used only as a supporting signal if the session asks for it. Never used to identify you.</span></span>
              </label>
              <Button className="w-full" disabled={busy} onClick={submit}>{busy ? "Checking in…" : "Check in"}</Button>
            </>
          )}
          <Link href="/attendance" className="block text-center text-xs text-muted-foreground hover:text-foreground">My attendance →</Link>
        </CardContent>
      </Card>
    </div>
  );
}
