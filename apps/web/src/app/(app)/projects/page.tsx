import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban, Users } from "lucide-react";
import { PROJECT_STAGES, PROJECT_STATUSES, STAGE_LABELS, type ProjectStage } from "@iic/shared";
import { QueryFilters } from "@/components/filters/query-filters";
import { HealthBadge, StageBadge, StatusBadge } from "@/components/status";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Pagination } from "@/components/ui/states";
import { getMe, serverApi } from "@/lib/api-server";
import { humanize, relativeTime } from "@/lib/utils";
import { NewProjectDialog } from "./new-project-dialog";

export const metadata: Metadata = { title: "Projects" };

interface ProjectRow {
  id: string; name: string; description: string; category: string; stage: ProjectStage; status: string; lastActivityAt: string;
  cohort: { name: string } | null; mentor: { name: string } | null; lead: { name: string } | null;
  _count: { memberships: number; tasks: number; milestones: number };
  health?: string; openTasks?: number; overdueTasks?: number;
}

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const me = await getMe();
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1]));
  const [data, cohorts, mentors, leads] = await Promise.all([
    serverApi<{ projects: ProjectRow[]; total: number; page: number; pageSize: number }>(`/projects?${qs.toString()}`),
    serverApi<{ cohorts: { id: string; name: string }[] }>("/cohorts"),
    me.role === "ADMIN" ? serverApi<{ users: { id: string; name: string }[] }>("/users/lookup?role=MENTOR") : Promise.resolve({ users: [] }),
    me.role === "ADMIN" ? serverApi<{ users: { id: string; name: string }[] }>("/users/lookup?role=PROJECT_LEAD") : Promise.resolve({ users: [] }),
  ]);
  const canCreate = me.role === "ADMIN" || me.role === "PROJECT_LEAD";

  return (
    <>
      <PageHeader
        title="Project directory"
        description={me.role === "ADMIN" ? "All incubation projects" : me.role === "MENTOR" ? "Projects you mentor" : "Projects you belong to"}
        actions={canCreate ? <NewProjectDialog isAdmin={me.role === "ADMIN"} cohorts={cohorts.cohorts} mentors={mentors.users} leads={leads.users} /> : null}
      />
      <QueryFilters
        filters={[
          { name: "q", label: "Search", type: "search" },
          { name: "stage", label: "Stage", type: "select", options: PROJECT_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] })) },
          { name: "status", label: "Status", type: "select", options: PROJECT_STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
          { name: "cohortId", label: "Cohort", type: "select", options: cohorts.cohorts.map((c) => ({ value: c.id, label: c.name })) },
          {
            name: "sort", label: "Sort", type: "select",
            options: [{ value: "name", label: "Name" }, { value: "createdAt", label: "Created" }, { value: "stage", label: "Stage" }],
          },
        ]}
      />
      {data.projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="h-6 w-6" />}
          title="No projects match"
          description={canCreate ? "Create a project or clear the filters." : "You will see projects here once you are added to a team."}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="group">
              <Card className="flex h-full flex-col gap-3 p-4 transition-colors group-hover:border-primary/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{p.name}</h2>
                    <p className="text-xs text-muted-foreground">{p.category}{p.cohort ? ` · ${p.cohort.name}` : ""}</p>
                  </div>
                  <HealthBadge health={p.health} />
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <StageBadge stage={p.stage} />
                  {p.status !== "ACTIVE" ? <StatusBadge status={p.status} /> : null}
                </div>
                <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {p._count.memberships} · lead {p.lead?.name ?? "—"}</span>
                  <span className="font-mono">{p.openTasks ?? 0} open · {p.overdueTasks ?? 0} late</span>
                </div>
                <p className="text-[11px] text-muted-foreground">Mentor {p.mentor?.name ?? "unassigned"} · active {relativeTime(p.lastActivityAt)}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <Pagination
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        hrefFor={(page) => {
          const n = new URLSearchParams(qs);
          n.set("page", String(page));
          return `/projects?${n.toString()}`;
        }}
      />
    </>
  );
}
