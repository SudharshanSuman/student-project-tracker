import type { Metadata } from "next";
import { QueryFilters } from "@/components/filters/query-filters";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader, Pagination } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { serverApi } from "@/lib/api-server";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit logs" };

interface Data {
  entries: { id: string; action: string; entityType: string; entityId: string | null; metadata: unknown; ip: string | null; createdAt: string; actor: { name: string; email: string } | null; project: { name: string } | null }[];
  total: number; page: number; pageSize: number; entityTypes: string[];
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1]));
  const data = await serverApi<Data>(`/audit-logs?${qs}`);
  return (
    <>
      <PageHeader title="Audit logs" description="Append-only record of significant and administrative actions." />
      <QueryFilters filters={[{ name: "action", label: "Action contains", type: "search" }, { name: "entityType", label: "Entity", type: "select", options: data.entityTypes.map((e) => ({ value: e, label: e })) }]} />
      <Card>
        <CardContent className="p-0">
          {data.entries.length === 0 ? <EmptyState className="m-4" title="No audit entries match" /> : (
            <Table>
              <THead><TR><TH>When</TH><TH>Actor</TH><TH>Action</TH><TH>Entity</TH><TH>Project</TH><TH>Details</TH></TR></THead>
              <TBody>
                {data.entries.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap font-mono text-xs">{formatDateTime(e.createdAt)}</TD>
                    <TD className="text-xs">{e.actor?.name ?? "System"}</TD>
                    <TD className="font-mono text-xs">{e.action}</TD>
                    <TD className="text-xs">{e.entityType}{e.entityId ? <span className="block font-mono text-[10px] text-muted-foreground">{e.entityId.slice(0, 8)}…</span> : null}</TD>
                    <TD className="text-xs">{e.project?.name ?? "—"}</TD>
                    <TD className="max-w-xs truncate font-mono text-[11px] text-muted-foreground" title={e.metadata ? JSON.stringify(e.metadata) : undefined}>{e.metadata ? JSON.stringify(e.metadata) : "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={(p) => { const n = new URLSearchParams(qs); n.set("page", String(p)); return `/admin/audit?${n}`; }} />
    </>
  );
}
