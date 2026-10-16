import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/states";
import { serverApi } from "@/lib/api-server";
import { cn, formatDateTime, humanize } from "@/lib/utils";
import { DeleteEventButton, NewEventDialog } from "./event-client";

export const metadata: Metadata = { title: "Events" };

interface EventRow {
  id: string; title: string; description: string | null; type: string; location: string | null; startsAt: string; endsAt: string;
  cohort: { name: string } | null; createdBy: { name: string }; _count: { sessions: number };
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ when?: string }> }) {
  const { when: raw } = await searchParams;
  const when = raw === "past" || raw === "all" ? raw : "upcoming";
  const [{ events, canManage }, cohorts] = await Promise.all([
    serverApi<{ events: EventRow[]; canManage: boolean }>(`/events?when=${when}`),
    serverApi<{ cohorts: { id: string; name: string }[] }>("/cohorts"),
  ]);
  return (
    <>
      <PageHeader title="Event management" description="Workshops, mentoring sessions, demo days and hackathons." actions={canManage ? <NewEventDialog cohorts={cohorts.cohorts} /> : null} />
      <nav className="mb-4 flex gap-1" aria-label="Event period">
        {(["upcoming", "past", "all"] as const).map((w) => (
          <Link key={w} href={`/events?when=${w}`} aria-current={when === w ? "page" : undefined} className={cn("rounded-md border px-3 py-1 text-xs capitalize", when === w ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>{w}</Link>
        ))}
      </nav>
      {events.length === 0 ? (
        <EmptyState icon={<CalendarDays className="h-6 w-6" />} title={`No ${when === "all" ? "" : when} events`} description={canManage ? "Create an event, then attach an attendance session to it." : undefined} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {events.map((e) => (
            <Card key={e.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{e.title}</h2>
                  <p className="tabular-nums text-xs text-muted-foreground">{formatDateTime(e.startsAt)} – {formatDateTime(e.endsAt)}</p>
                </div>
                <Badge variant="default">{humanize(e.type)}</Badge>
              </div>
              {e.description ? <p className="text-sm text-muted-foreground">{e.description}</p> : null}
              <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{e.location ?? "No location"}{e.cohort ? ` · ${e.cohort.name}` : ""}</span>
                <span className="flex items-center gap-2">
                  <Link href="/attendance" className="text-link">{e._count.sessions} attendance session{e._count.sessions === 1 ? "" : "s"}</Link>
                  {canManage ? <DeleteEventButton id={e.id} title={e.title} /> : null}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
