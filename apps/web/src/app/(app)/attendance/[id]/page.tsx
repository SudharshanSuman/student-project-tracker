import type { Metadata } from "next";
import { StatusBadge } from "@/components/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { serverApi } from "@/lib/api-server";
import { formatDateTime, humanize } from "@/lib/utils";
import { CorrectRecord, ManualAdd, QrPanel, SessionStatusActions } from "./session-detail-client";

export const metadata: Metadata = { title: "Attendance session" };

interface Detail {
  session: {
    id: string; name: string; description: string | null; location: string | null; startsAt: string; endsAt: string; status: string;
    eligibility: string; qrPolicy: string; qrTtlSeconds: number; locationCheck: boolean;
    event: { title: string } | null; cohort: { name: string } | null; project: { name: string } | null;
    records: {
      id: string; method: string; status: string; checkedInAt: string; locationVerified: boolean | null; correctionReason: string | null;
      user: { id: string; name: string; email: string }; correctedBy: { name: string } | null;
    }[];
  };
  eligibleCount: number;
}

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session: s, eligibleCount } = await serverApi<Detail>(`/attendance/sessions/${id}`);
  const present = s.records.filter((r) => r.status !== "REVOKED").length;
  return (
    <>
      <PageHeader
        title={s.name}
        description={`${formatDateTime(s.startsAt)} – ${formatDateTime(s.endsAt)}${s.location ? ` · ${s.location}` : ""} · ${humanize(s.eligibility)}${s.cohort ? ` (${s.cohort.name})` : ""}${s.project ? ` (${s.project.name})` : ""}`}
        actions={<SessionStatusActions id={s.id} status={s.status} />}
      />
      <div className="mb-4 flex items-center gap-2"><StatusBadge status={s.status} /><span className="text-xs text-muted-foreground">QR {humanize(s.qrPolicy)} · {s.qrTtlSeconds}s lifetime{s.locationCheck ? " · optional location check" : ""}</span></div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <QrPanel id={s.id} open={s.status === "OPEN"} />
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Present" value={present} />
            <Stat label="Eligible" value={eligibleCount} hint={eligibleCount ? `${Math.round((present / eligibleCount) * 100)}% turnout` : undefined} />
          </div>
        </div>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="flex items-center justify-between">Records <ManualAdd sessionId={s.id} /></CardTitle></CardHeader>
          <CardContent className="p-0">
            {s.records.length === 0 ? <EmptyState className="m-4" title="No check-ins yet" description="Open the session and display the QR code." /> : (
              <Table>
                <THead><TR><TH>Participant</TH><TH>Checked in</TH><TH>Method</TH><TH>Status</TH><TH>Location</TH><TH /></TR></THead>
                <TBody>
                  {s.records.map((r) => (
                    <TR key={r.id}>
                      <TD><span className="block">{r.user.name}</span><span className="text-xs text-muted-foreground">{r.user.email}</span></TD>
                      <TD className="font-mono text-xs">{formatDateTime(r.checkedInAt)}</TD>
                      <TD className="text-xs">{r.method}</TD>
                      <TD><StatusBadge status={r.status} />{r.correctionReason ? <span className="block text-[11px] text-muted-foreground" title={r.correctionReason}>{r.correctedBy?.name}: {r.correctionReason}</span> : null}</TD>
                      <TD className="text-xs text-muted-foreground">{r.locationVerified === null ? "—" : r.locationVerified ? "within radius" : "outside radius"}</TD>
                      <TD><CorrectRecord id={r.id} status={r.status} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
