import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { REPORT_TYPE_LABELS, type ReportType } from "@iic/shared";
import { StatusBadge } from "@/components/status";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { serverApi } from "@/lib/api-server";
import { formatDate, formatDateTime } from "@/lib/utils";
import { AutoRefresh, GenerateReport, ReportActions } from "./reports-client";

export const metadata: Metadata = { title: "Reports" };

interface Report {
  id: string; type: ReportType; title: string; status: string; periodStart: string | null; periodEnd: string | null; attempts: number; error: string | null;
  createdAt: string; completedAt: string | null; expiresAt: string | null; sizeBytes: number | null; downloadable: boolean; expired: boolean;
  requestedBy: { name: string }; project: { name: string } | null;
}
interface Data { reports: Report[]; projects: { id: string; name: string }[]; cohorts: { id: string; name: string; term: string }[]; isAdmin: boolean }

export default async function ReportsPage() {
  const d = await serverApi<Data>("/reports");
  const active = d.reports.some((r) => r.status === "QUEUED" || r.status === "RUNNING");
  return (
    <>
      <PageHeader title="Reports" description="Institutional A4 PDF reports generated in the background from live platform records." />
      <GenerateReport projects={d.projects} cohorts={d.cohorts} isAdmin={d.isAdmin} />
      <AutoRefresh active={active} />
      {d.reports.length === 0 ? <EmptyState icon={<FileText className="h-6 w-6" />} title="No reports generated yet" description="Generated PDFs are kept for a limited time and can be downloaded only by you (and admins)." /> : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <THead><TR><TH>Report</TH><TH>Type</TH><TH>Period</TH><TH>Status</TH><TH>Requested</TH><TH className="text-right">Actions</TH></TR></THead>
              <TBody>
                {d.reports.map((r) => (
                  <TR key={r.id}>
                    <TD className="max-w-[280px]">{r.title}</TD>
                    <TD className="text-xs">{REPORT_TYPE_LABELS[r.type]}</TD>
                    <TD className="whitespace-nowrap tabular-nums text-xs">{r.periodStart ? `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}` : "To date"}</TD>
                    <TD>
                      <StatusBadge status={r.expired ? "EXPIRED" : r.status} />
                      {r.status === "QUEUED" && r.attempts > 0 ? <span className="block text-[11px] text-muted-foreground">retry {r.attempts + 1}</span> : null}
                      {r.error && r.status !== "COMPLETED" ? <span className="block max-w-[220px] text-[11px] bg-destructive px-1 text-foreground">{r.error}</span> : null}
                      {r.downloadable && r.expiresAt ? <span className="block text-[11px] text-muted-foreground">until {formatDate(r.expiresAt)}</span> : null}
                    </TD>
                    <TD className="text-xs">{r.requestedBy.name}<span className="block text-muted-foreground">{formatDateTime(r.createdAt)}</span></TD>
                    <TD><ReportActions id={r.id} status={r.status} downloadable={r.downloadable} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
