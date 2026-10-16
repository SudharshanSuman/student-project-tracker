import type { Metadata } from "next";
import Link from "next/link";
import { Medal, Trophy } from "lucide-react";
import { COMPETITION_OUTCOMES } from "@iic/shared";
import { QueryFilters } from "@/components/filters/query-filters";
import { StatusBadge } from "@/components/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { serverApi } from "@/lib/api-server";
import { formatDate, humanize } from "@/lib/utils";
import { CompetitionForm } from "./competition-form";

export const metadata: Metadata = { title: "Competition hub" };

interface Comp {
  id: string; name: string; organizer: string; description: string | null; startDate: string | null; endDate: string | null; submissionDeadline: string | null;
  registrations: { id: string; status: string; outcome: string; outcomeVerifiedAt: string | null; project: { id: string; name: string } }[];
  _count: { registrations: number };
}
interface Row { rank: number; projectId: string; projectName: string; cohort: string | null; points: number; winners: number; finalists: number; participations: number; unverified: number }

export default async function CompetitionsPage({ searchParams }: { searchParams: Promise<{ q?: string; when?: string; outcome?: string }> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => !!v) as [string, string][]).toString();
  const [{ competitions, canCreate }, { leaderboard }] = await Promise.all([
    serverApi<{ competitions: Comp[]; canCreate: boolean }>(`/competitions${qs ? `?${qs}` : ""}`),
    serverApi<{ leaderboard: Row[] }>("/competitions/leaderboard"),
  ]);
  return (
    <>
      <PageHeader
        title="Competition hub"
        description="Hackathons and challenges, your projects' registrations, and outcomes verified by mentors."
        actions={canCreate ? <CompetitionForm /> : null}
      />
      <QueryFilters
        filters={[
          { name: "q", label: "Search", type: "search" },
          { name: "when", label: "When", type: "select", options: [{ value: "upcoming", label: "Upcoming / open" }, { value: "past", label: "Past" }] },
          { name: "outcome", label: "Your outcome", type: "select", options: COMPETITION_OUTCOMES.map((o) => ({ value: o, label: humanize(o) })) },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        {competitions.length === 0 ? (
          <EmptyState icon={<Trophy className="h-6 w-6" />} title="No competitions match" description={canCreate ? "Add a competition to start tracking registrations." : "Staff add competitions; check back later."} />
        ) : (
          <div className="grid content-start gap-3 md:grid-cols-2">
            {competitions.map((c) => (
              <Link key={c.id} href={`/competitions/${c.id}`} className="group">
                <Card className="h-full space-y-2 p-4 transition-colors group-hover:border-foreground">
                  <div className="flex items-start justify-between gap-2">
                    <div><h2 className="font-semibold">{c.name}</h2><p className="text-xs text-muted-foreground">{c.organizer}</p></div>
                    <span className="whitespace-nowrap tabular-nums text-xs text-muted-foreground">{c.submissionDeadline ? `due ${formatDate(c.submissionDeadline)}` : formatDate(c.endDate)}</span>
                  </div>
                  {c.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{c.description}</p> : null}
                  <div className="space-y-1 border-t pt-2 text-xs">
                    {c.registrations.length === 0 ? <span className="text-muted-foreground">{c._count.registrations} registered · none from your projects</span> : c.registrations.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2">
                        <span>{r.project.name}</span>
                        <span className="flex items-center gap-1">
                          <StatusBadge status={r.outcome === "PENDING" ? r.status : r.outcome} />
                          {r.outcome !== "PENDING" && !r.outcomeVerifiedAt ? <span className="text-[10px] text-muted-foreground">unverified</span> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
        <Card className="h-fit">
          <CardHeader><CardTitle className="flex items-center gap-2"><Medal className="h-4 w-4 text-link" /> Leaderboard</CardTitle></CardHeader>
          <CardContent className="p-0">
            {leaderboard.length === 0 ? <p className="px-4 pb-4 text-sm text-muted-foreground">No verified results yet.</p> : (
              <Table>
                <THead><TR><TH>#</TH><TH>Project</TH><TH className="text-right">W / F / P</TH><TH className="text-right">Pts</TH></TR></THead>
                <TBody>
                  {leaderboard.slice(0, 15).map((r) => (
                    <TR key={r.projectId}>
                      <TD className="tabular-nums text-xs">{r.rank}</TD>
                      <TD>{r.projectName}{r.cohort ? <span className="block text-[11px] text-muted-foreground">{r.cohort}</span> : null}</TD>
                      <TD className="text-right tabular-nums text-xs">{r.winners} / {r.finalists} / {r.participations}</TD>
                      <TD className="text-right tabular-nums font-semibold">{r.points}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            <p className="px-4 py-3 text-[11px] text-muted-foreground">Verified outcomes only. Winner 5 · Finalist 3 · Participant 1.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
