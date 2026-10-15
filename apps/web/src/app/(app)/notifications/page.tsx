import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader, Pagination } from "@/components/ui/states";
import { serverApi } from "@/lib/api-server";
import { cn, formatDateTime } from "@/lib/utils";
import { MarkAllRead, MarkRead, Preferences } from "./notifications-client";

export const metadata: Metadata = { title: "Notifications" };

interface Data {
  notifications: { id: string; type: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }[];
  total: number; unread: number; page: number; pageSize: number;
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ page?: string; unread?: string }> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ page: sp.page ?? "1", ...(sp.unread === "true" ? { unread: "true" } : {}) });
  const [data, prefs] = await Promise.all([
    serverApi<Data>(`/notifications?${qs}`),
    serverApi<{ preferences: { type: string; inApp: boolean }[] }>("/notifications/preferences"),
  ]);
  return (
    <>
      <PageHeader title="Notifications" description={`${data.unread} unread`} actions={<>{data.unread ? <MarkAllRead /> : null}<Preferences preferences={prefs.preferences} /></>} />
      <nav className="mb-4 flex gap-1">
        <Link href="/notifications" className={cn("rounded-md border px-3 py-1 text-xs", sp.unread !== "true" && "border-primary/60 bg-primary/15")}>All</Link>
        <Link href="/notifications?unread=true" className={cn("rounded-md border px-3 py-1 text-xs", sp.unread === "true" && "border-primary/60 bg-primary/15")}>Unread</Link>
      </nav>
      {data.notifications.length === 0 ? <EmptyState icon={<Bell className="h-6 w-6" />} title="Nothing here" description="Task assignments, reviews, deadlines and event reminders appear here." /> : (
        <Card>
          <CardContent className="divide-y p-0">
            {data.notifications.map((n) => (
              <div key={n.id} className={cn("flex items-start justify-between gap-3 px-4 py-3", !n.readAt && "bg-primary/5")}>
                <div className="min-w-0">
                  <p className="text-sm">{!n.readAt ? <span className="mr-2 inline-block h-2 w-2 rounded-full bg-primary" aria-label="Unread" /> : null}{n.link ? <Link href={n.link} className="hover:text-primary">{n.title}</Link> : n.title}</p>
                  {n.body ? <p className="truncate text-xs text-muted-foreground">{n.body}</p> : null}
                  <p className="font-mono text-[11px] text-muted-foreground">{formatDateTime(n.createdAt)} · {n.type}</p>
                </div>
                {!n.readAt ? <MarkRead id={n.id} /> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={(p) => `/notifications?page=${p}${sp.unread === "true" ? "&unread=true" : ""}`} />
    </>
  );
}
