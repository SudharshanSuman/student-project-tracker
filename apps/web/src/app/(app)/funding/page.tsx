import type { Metadata } from "next";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { StatusBadge } from "@/components/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { serverApi } from "@/lib/api-server";
import { formatDate, formatMoney, humanize } from "@/lib/utils";
import { AwardActions, RecordAwardDialog, ReviewChange, type Award, type ProjectOption } from "./funding-client";

export const metadata: Metadata = { title: "Funding ledger" };

interface Data {
  awards: (Award & { awardedAt: string | null; verifiedAt: string | null; notes: string | null; project: { id: string; name: string }; createdBy: { name: string }; verifiedBy: { name: string } | null; registration: { competition: { name: string } } | null })[];
  totals: { currency: string; verification: string; amount: string; count: number }[];
  pendingRequests: { id: string; reason: string; proposed: { amount?: string; currency?: string; source?: string; awardedAt?: string }; createdAt: string; canReview: boolean; requestedBy: { name: string }; award: { title: string; project: { name: string } } }[];
  projects: ProjectOption[];
}

export default async function FundingPage() {
  const d = await serverApi<Data>("/funding");
  const by = (v: string) => d.totals.filter((t) => t.verification === v);
  const sum = (v: string) => (by(v).length ? by(v).map((t) => formatMoney(t.amount, t.currency)).join(" + ") : "—");
  const count = (v: string) => by(v).reduce((s, t) => s + t.count, 0);
  return (
    <>
      <PageHeader title="Funding ledger" description="Prize money and grants in their original currency. Verified and estimated amounts are never mixed or converted." actions={<RecordAwardDialog projects={d.projects} />} />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Verified" tone="success" value={sum("VERIFIED")} hint={`${count("VERIFIED")} awards`} />
        <Stat label="Estimated (unverified)" tone="warning" value={sum("ESTIMATED")} hint={`${count("ESTIMATED")} awaiting review`} />
        <Stat label="Rejected" value={String(count("REJECTED"))} hint="Excluded from all totals" />
      </div>
      {d.pendingRequests.length ? (
        <Card className="mb-4">
          <CardHeader><CardTitle>Change requests awaiting review</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {d.pendingRequests.map((r) => (
              <div key={r.id} className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
                <div className="text-sm">
                  <p className="font-medium">{r.award.title} <span className="text-xs text-muted-foreground">· {r.award.project.name}</span></p>
                  <p className="text-xs text-muted-foreground">
                    Proposed: {[r.proposed.amount && `amount ${r.proposed.amount}`, r.proposed.currency && `currency ${r.proposed.currency}`, r.proposed.source && `source ${humanize(r.proposed.source)}`, r.proposed.awardedAt && `date ${formatDate(r.proposed.awardedAt)}`].filter(Boolean).join(", ")} · by {r.requestedBy.name}
                  </p>
                  <p className="text-xs">{r.reason}</p>
                </div>
                <ReviewChange id={r.id} canReview={r.canReview} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      {d.awards.length === 0 ? <EmptyState icon={<Landmark className="h-6 w-6" />} title="No funding recorded" description="Record prize money or grants as they are announced; a mentor or admin verifies them." /> : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <THead><TR><TH>Award</TH><TH>Project</TH><TH>Source</TH><TH className="text-right">Amount</TH><TH>Verification</TH><TH>Awarded</TH><TH className="text-right">Actions</TH></TR></THead>
              <TBody>
                {d.awards.map((a) => (
                  <TR key={a.id}>
                    <TD>{a.title}<span className="block text-xs text-muted-foreground">{a.registration ? `${a.registration.competition.name} · ` : ""}recorded by {a.createdBy.name}</span></TD>
                    <TD><Link href={`/projects/${a.project.id}`} className="hover:text-primary">{a.project.name}</Link></TD>
                    <TD className="text-xs">{humanize(a.source)}</TD>
                    <TD className="text-right font-mono">{formatMoney(a.amount, a.currency)}</TD>
                    <TD><StatusBadge status={a.verification} />{a.verifiedBy ? <span className="block text-[11px] text-muted-foreground">{a.verifiedBy.name} · {formatDate(a.verifiedAt)}</span> : null}</TD>
                    <TD className="font-mono text-xs">{formatDate(a.awardedAt)}</TD>
                    <TD><AwardActions a={a} /></TD>
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
