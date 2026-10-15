import type { Metadata } from "next";
import Link from "next/link";
import { QrCode } from "lucide-react";
import { StatusBadge } from "@/components/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { serverApi } from "@/lib/api-server";
import { formatDateTime, humanize } from "@/lib/utils";
import { NewSessionDialog } from "./session-client";

export const metadata: Metadata = { title: "Attendance" };

interface SessionRow {
  id: string; name: string; location: string | null; startsAt: string; endsAt: string; status: string; eligibility: string; qrPolicy: string;
  event: { title: string } | null; cohort: { name: string } | null; project: { name: string } | null;
  _count: { records: number };
  myRecord: { status: string; checkedInAt: string; method: string } | null;
}

export default async function AttendancePage() {
  const [{ sessions, canManage }, mine, events, cohorts, projects] = await Promise.all([
    serverApi<{ sessions: SessionRow[]; canManage: boolean }>("/attendance/sessions"),
    serverApi<{ records: unknown[]; verifiedHours: number }>("/attendance/me"),
    serverApi<{ events: { id: string; title: string; startsAt: string; endsAt: string; location: string | null }[] }>("/events?when=upcoming"),
    serverApi<{ cohorts: { id: string; name: string }[] }>("/cohorts"),
    serverApi<{ projects: { id: string; name: string }[] }>("/projects/options"),
  ]);
  return (
    <>
      <PageHeader
        title="Attendance"
        description={canManage ? "Create sessions, display rotating QR codes, and correct records with an audit trail." : "Scan the QR code shown at a session with your phone camera to check in."}
        actions={canManage ? <NewSessionDialog events={events.events} cohorts={cohorts.cohorts} projects={projects.projects} /> : null}
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="My verified hours" value={`${mine.verifiedHours} h`} icon={<QrCode className="h-4 w-4" />} hint={`${mine.records.length} check-ins`} />
        <Stat label="Open sessions" value={sessions.filter((s) => s.status === "OPEN").length} />
        <Stat label="Sessions listed" value={sessions.length} />
      </div>
      <Card>
        <CardHeader><CardTitle>{canManage ? "All sessions" : "Sessions you are eligible for"}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {sessions.length === 0 ? (
            <EmptyState className="m-4" title="No attendance sessions yet" />
          ) : (
            <Table>
              <THead><TR><TH>Session</TH><TH>When</TH><TH>Eligibility</TH><TH>Status</TH><TH>{canManage ? "Check-ins" : "My attendance"}</TH></TR></THead>
              <TBody>
                {sessions.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      {canManage ? <Link className="font-medium hover:text-primary" href={`/attendance/${s.id}`}>{s.name}</Link> : <span className="font-medium">{s.name}</span>}
                      <span className="block text-xs text-muted-foreground">{s.event?.title ?? "Standalone"}{s.location ? ` · ${s.location}` : ""}</span>
                    </TD>
                    <TD className="font-mono text-xs">{formatDateTime(s.startsAt)}</TD>
                    <TD className="text-xs text-muted-foreground">{humanize(s.eligibility)}{s.cohort ? ` · ${s.cohort.name}` : ""}{s.project ? ` · ${s.project.name}` : ""}</TD>
                    <TD><StatusBadge status={s.status} /></TD>
                    <TD>{canManage ? <span className="font-mono">{s._count.records}</span> : s.myRecord ? <StatusBadge status={s.myRecord.status} /> : <span className="text-xs text-muted-foreground">Not checked in</span>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Attendance records presence at a session only. Location, when a session asks for it, is optional, requested with your permission, and never used as proof of identity.
      </p>
    </>
  );
}
