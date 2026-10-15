import type { Metadata } from "next";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { StatusBadge } from "@/components/status";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { serverApi } from "@/lib/api-server";
import { formatDate, formatMoney, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Funding ledger" };

interface Data {
  awards: { id: string; title: string; source: string; amount: string; currency: string; verification: string; awardedAt: string | null; verifiedAt: string | null; notes: string | null; project: { id: string; name: string }; verifiedBy: { name: string } | null; registration: { competition: { name: string } } | null }[];
  totals: { currency: string; verification: string; amount: string; count: number }[];
}

export default async function FundingPage() {
  const d = await serverApi<Data>("/funding");
  const by = (v: string) => d.totals.filter((t) => t.verification === v);
  return (
    <>
      <PageHeader title="Funding ledger" description="Prize money and grants with explicit currency. Verified and estimated amounts are never mixed." />
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Stat label="Verified" tone="success" value={by("VERIFIED").length ? by("VERIFIED").map((t) => formatMoney(t.amount, t.currency)).join(" + ") : "—"} hint={`${by("VERIFIED").reduce((s, t) => s + t.count, 0)} awards`} />
        <Stat label="Estimated (unverified)" tone="warning" value={by("ESTIMATED").length ? by("ESTIMATED").map((t) => formatMoney(t.amount, t.currency)).join(" + ") : "—"} hint={`${by("ESTIMATED").reduce((s, t) => s + t.count, 0)} awards`} />
      </div>
      {d.awards.length === 0 ? <EmptyState icon={<Landmark className="h-6 w-6" />} title="No funding recorded" /> : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead><TR><TH>Award</TH><TH>Project</TH><TH>Source</TH><TH className="text-right">Amount</TH><TH>Verification</TH><TH>Awarded</TH></TR></THead>
              <TBody>
                {d.awards.map((a) => (
                  <TR key={a.id}>
                    <TD>{a.title}{a.registration ? <span className="block text-xs text-muted-foreground">{a.registration.competition.name}</span> : null}</TD>
                    <TD><Link href={`/projects/${a.project.id}`} className="hover:text-primary">{a.project.name}</Link></TD>
                    <TD className="text-xs">{humanize(a.source)}</TD>
                    <TD className="text-right font-mono">{formatMoney(a.amount, a.currency)}</TD>
                    <TD><StatusBadge status={a.verification} />{a.verifiedBy ? <span className="block text-[11px] text-muted-foreground">{a.verifiedBy.name}</span> : null}</TD>
                    <TD className="font-mono text-xs">{formatDate(a.awardedAt)}</TD>
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
