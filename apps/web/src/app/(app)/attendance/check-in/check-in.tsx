"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, MapPin, ScanLine, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/api-client";
import { canScanNatively, scanQrCode, tokenFromQr } from "@/lib/native-scan";

type Result = { ok: true; session: string; at: string } | { ok: false; message: string };

export function CheckIn({ token: initialToken }: { token: string }) {
  const [token, setToken] = useState(initialToken);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareLocation, setShareLocation] = useState(false);
  // Only the Android app can open the camera; checked after mount to keep hydration stable.
  const [nativeScan, setNativeScan] = useState(false);
  useEffect(() => setNativeScan(canScanNatively()), []);

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

  async function submit(checkInToken = token) {
    setBusy(true);
    try {
      const location = await getLocation();
      const r = await api<{ record: { checkedInAt: string }; session: { name: string } }>("/attendance/check-in", { body: { token: checkInToken, location } });
      setResult({ ok: true, session: r.session.name, at: r.record.checkedInAt });
    } catch (e) {
      setResult({ ok: false, message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    setResult(null);
    try {
      const raw = await scanQrCode();
      if (raw === null) return;
      const scanned = tokenFromQr(raw);
      if (!scanned) {
        setResult({ ok: false, message: "That is not an IIC attendance QR code. Scan the code shown at the session." });
        return;
      }
      setToken(scanned);
      await submit(scanned);
    } catch (e) {
      setResult({ ok: false, message: errorMessage(e) });
    }
  }

  const scanButton = nativeScan ? (
    <Button variant={token ? "outline" : "default"} className="w-full" disabled={busy} onClick={scan}>
      <ScanLine className="h-4 w-4" /> {busy ? "Checking in…" : "Scan QR code"}
    </Button>
  ) : null;

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attendance check-in</CardTitle>
          <CardDescription>Confirm your attendance for the session whose QR code you scanned.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {result ? (
            result.ok ? (
              <div className="flex items-start gap-3 text-sm"><CheckCircle2 className="h-5 w-5 text-success" /><div><p className="font-medium">Checked in to {result.session}</p><p className="text-muted-foreground">{new Date(result.at).toLocaleString()}</p></div></div>
            ) : (
              <>
                <div className="flex items-start gap-3 text-sm"><XCircle className="h-5 w-5 text-destructive" /><p>{result.message}</p></div>
                {scanButton}
              </>
            )
          ) : !token ? (
            <>
              <p className="text-sm text-muted-foreground">{nativeScan ? "Scan the QR code displayed at the session to check in." : "No QR token found. Scan the code displayed at the session."}</p>
              {scanButton}
            </>
          ) : (
            <>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 accent-primary" checked={shareLocation} onChange={(e) => setShareLocation(e.target.checked)} />
                <span><span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> Share my location for this check-in (optional)</span><span className="block text-xs text-muted-foreground">Used only as a supporting signal if the session asks for it. Never used to identify you.</span></span>
              </label>
              <Button className="w-full" disabled={busy} onClick={() => submit()}>{busy ? "Checking in…" : "Check in"}</Button>
            </>
          )}
          <Link href="/attendance" className="block text-center text-xs text-muted-foreground hover:text-foreground">My attendance →</Link>
        </CardContent>
      </Card>
    </div>
  );
}
