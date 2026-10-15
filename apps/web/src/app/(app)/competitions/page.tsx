import type { Metadata } from "next";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { QueryFilters } from "@/components/filters/query-filters";
import { StatusBadge } from "@/components/status";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/states";
import { serverApi } from "@/lib/api-server";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Competition hub" };

interface Comp {
  id: string; name: string; organizer: string; description: string | null; registrationUrl: string | null; startDate: string | null; endDate: string | null; submissionDeadline: string | null;
  registrations: { id: string; status: string; outcome: string; project: { id: string; name: string } }[];
  _count: { registrations: number };
}

export default async function CompetitionsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { competitions } = await serverApi<{ competitions: Comp[] }>(`/competitions${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return (
    <>
      <PageHeader title="Competition hub" description="Hackathons and challenges with your projects' registrations and verified outcomes." />
      <QueryFilters filters={[{ name: "q", label: "Search", type: "search" }]} />
      {competitions.length === 0 ? <EmptyState icon={<Trophy className="h-6 w-6" />} title="No competitions recorded" description="Competition records and registrations are added by staff (full management arrives with the competitions module)." /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {competitions.map((c) => (
            <Card key={c.id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div><h2 className="font-semibold">{c.name}</h2><p className="text-xs text-muted-foreground">{c.organizer}</p></div>
                <span className="font-mono text-xs text-muted-foreground">deadline {formatDate(c.submissionDeadline)}</span>
              </div>
              {c.description ? <p className="text-sm text-muted-foreground">{c.description}</p> : null}
              <div className="border-t pt-2 text-xs">
                {c.registrations.length === 0 ? <span className="text-muted-foreground">{c._count.registrations} registrations (none from your projects)</span> : c.registrations.map((r) => (
                  <div key={r.id} className="flex items-center justify-between"><Link href={`/projects/${r.project.id}`} className="hover:text-primary">{r.project.name}</Link><StatusBadge status={r.outcome === "PENDING" ? r.status : r.outcome} /></div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
