import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { REPORT_TYPES } from "@iic/shared";
import { StatusBadge } from "@/components/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { serverApi } from "@/lib/api-server";
import { formatDate, formatDateTime, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };

interface Report { id: string; type: string; title: string; status: string; periodStart: string | null; periodEnd: string | null; attempts: number; error: string | null; createdAt: string; completedAt: string | null; requestedBy: { name: string }; project: { name: string } | null }

export default async function ReportsPage() {
  const { reports } = await serverApi<{ reports: Report[] }>("/reports");
  return (
    <>
      <PageHeader title="Reports" description="Institutional PDF reports generated from platform records." />
      <Card className="mb-4">
        <CardHeader><CardTitle>Report types</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p className="mb-2">{REPORT_TYPES.map((t) => humanize(t)).join(" · ")}</p>
          <p className="text-xs">The PDF engine (headless Chromium pool, background jobs, expiring downloads) is delivered in the reporting module. History below is read live from the database.</p>
        </CardContent>
      </Card>
      {reports.length === 0 ? <EmptyState icon={<FileText className="h-6 w-6" />} title="No reports generated yet" /> : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead><TR><TH>Report</TH><TH>Type</TH><TH>Period</TH><TH>Status</TH><TH>Requested</TH></TR></THead>
              <TBody>
                {reports.map((r) => (
                  <TR key={r.id}>
                    <TD>{r.title}{r.project ? <span className="block text-xs text-muted-foreground">{r.project.name}</span> : null}</TD>
                    <TD className="text-xs">{humanize(r.type)}</TD>
                    <TD className="font-mono text-xs">{formatDate(r.periodStart)} – {formatDate(r.periodEnd)}</TD>
                    <TD><StatusBadge status={r.status} />{r.error ? <span className="block text-[11px] text-red-400">{r.error}</span> : null}</TD>
                    <TD className="text-xs">{r.requestedBy.name} · {formatDateTime(r.createdAt)}</TD>
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
