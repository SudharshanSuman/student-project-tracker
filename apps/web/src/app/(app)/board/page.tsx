import type { Metadata } from "next";
import { Columns3 } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui/states";
import { serverApi } from "@/lib/api-server";
import { Board, type BoardData } from "./board";
import { ProjectPicker } from "./project-picker";

export const metadata: Metadata = { title: "Kanban board" };

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ project?: string; task?: string }> }) {
  const sp = await searchParams;
  const { projects } = await serverApi<{ projects: { id: string; name: string }[] }>("/projects/options");
  if (projects.length === 0) {
    return (
      <>
        <PageHeader title="Kanban board" />
        <EmptyState icon={<Columns3 className="h-6 w-6" />} title="No projects available" description="Boards appear once you belong to (or mentor) an active project." />
      </>
    );
  }
  const projectId = projects.some((p) => p.id === sp.project) ? sp.project! : projects[0]!.id;
  const data = await serverApi<BoardData>(`/projects/${projectId}/tasks`);
  return (
    <>
      <PageHeader
        title="Kanban board"
        description="Drag cards between columns. Dependencies must be done before work starts; only the lead accepts work into Done."
        actions={<ProjectPicker projects={projects} value={projectId} />}
      />
      <Board key={projectId} data={data} openTaskId={sp.task} />
    </>
  );
}
