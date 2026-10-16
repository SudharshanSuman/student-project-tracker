import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Github } from "lucide-react";
import { StatusBadge } from "@/components/status";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { serverApi } from "@/lib/api-server";
import { formatDateTime } from "@/lib/utils";
import { LinkGitHubDialog, SyncGitHubButton } from "../admin/integrations/integration-actions";

export const metadata: Metadata = { title: "GitHub integration" };

interface Data {
  configured: boolean;
  projects: {
    id: string;
    name: string;
    repoUrl: string | null;
    github: {
      owner: string;
      repo: string;
      status: string;
      defaultBranch: string | null;
      latestCommitAt: string | null;
      lastSyncedAt: string | null;
      lastError: string | null;
      activity: { commitCount: number; prOpened?: number; prMerged?: number }[];
    } | null;
  }[];
}

export default async function GithubPage() {
  const d = await serverApi<Data>("/github");
  const unlinkedProjects = d.projects.filter((p) => !p.github);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <PageHeader
          title="GitHub integration"
          description="Repository links and synced activity. Commit counts are supporting context, never a full measure of contribution."
        />
        {unlinkedProjects.length > 0 && (
          <div>
            <LinkGitHubDialog projects={unlinkedProjects} />
          </div>
        )}
      </div>

      {!d.configured ? (
        <div className="mb-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">GitHub sync is not configured globally</p>
          <p className="mt-1">
            An admin can set <span className="font-mono">GITHUB_TOKEN</span> (read-only, fine-grained) in the environment, or link individual repositories with scoped tokens. Repository links below are shown as entered; no activity is synced or estimated until configured.{" "}
            <Link href="/admin/integrations" className="text-primary hover:underline">
              Setup →
            </Link>
          </p>
        </div>
      ) : null}

      {d.projects.length === 0 ? (
        <EmptyState icon={<Github className="h-6 w-6" />} title="No projects in scope" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Project</TH>
                  <TH>Repository</TH>
                  <TH>Sync</TH>
                  <TH>Latest commit</TH>
                  <TH>Commits (30d)</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {d.projects.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <Link href={`/projects/${p.id}`} className="hover:text-primary font-medium">
                        {p.name}
                      </Link>
                    </TD>
                    <TD className="text-xs">
                      {p.github ? (
                        <span className="font-mono">
                          {p.github.owner}/{p.github.repo}
                        </span>
                      ) : p.repoUrl ? (
                        <a
                          href={p.repoUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          link <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">No repository</span>
                      )}
                    </TD>
                    <TD>
                      {p.github ? (
                        <StatusBadge status={p.github.status} />
                      ) : (
                        <span className="text-xs text-muted-foreground">Not linked</span>
                      )}
                    </TD>
                    <TD className="font-mono text-xs">{formatDateTime(p.github?.latestCommitAt)}</TD>
                    <TD className="font-mono text-xs">
                      {p.github ? p.github.activity.reduce((s, a) => s + a.commitCount, 0) : "—"}
                    </TD>
                    <TD className="text-right">
                      {p.github ? (
                        <SyncGitHubButton projectId={p.id} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TD>
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
