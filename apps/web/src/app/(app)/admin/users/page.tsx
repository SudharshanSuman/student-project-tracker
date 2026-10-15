import type { Metadata } from "next";
import { ROLE_LABELS, ROLES, USER_STATUSES, type Role } from "@iic/shared";
import { QueryFilters } from "@/components/filters/query-filters";
import { StatusBadge } from "@/components/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Pagination } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { getMe, serverApi } from "@/lib/api-server";
import { formatDate, formatDateTime, humanize } from "@/lib/utils";
import { InviteDialog, RevokeInvitation, UserRowActions } from "./users-client";

export const metadata: Metadata = { title: "User management" };

interface UserRow { id: string; email: string; name: string; role: Role; status: string; department: string | null; lastLoginAt: string | null; createdAt: string; _count: { memberships: number } }
interface InvitationRow { id: string; email: string; role: Role; expiresAt: string; acceptedAt: string | null; revokedAt: string | null; createdAt: string; invitedBy: { name: string }; project: { name: string } | null }

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const me = await getMe();
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1]));
  const [users, invitations, cohorts, projects] = await Promise.all([
    serverApi<{ users: UserRow[]; total: number; page: number; pageSize: number }>(`/users?${qs}`),
    serverApi<{ invitations: InvitationRow[] }>("/users/invitations"),
    serverApi<{ cohorts: { id: string; name: string }[] }>("/cohorts"),
    serverApi<{ projects: { id: string; name: string }[] }>("/projects/options"),
  ]);
  const now = Date.now();
  const pending = invitations.invitations.filter((i) => !i.acceptedAt && !i.revokedAt && new Date(i.expiresAt).getTime() > now);
  return (
    <>
      <PageHeader title="User management" description="Accounts are created by invitation only. Role changes and deactivations are audited." actions={<InviteDialog cohorts={cohorts.cohorts} projects={projects.projects} />} />
      <QueryFilters filters={[
        { name: "q", label: "Search", type: "search" },
        { name: "role", label: "Role", type: "select", options: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })) },
        { name: "status", label: "Status", type: "select", options: USER_STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
      ]} />
      <Card>
        <CardContent className="p-0">
          {users.users.length === 0 ? <EmptyState className="m-4" title="No users match" /> : (
            <Table>
              <THead><TR><TH>Name</TH><TH>Role</TH><TH>Status</TH><TH>Projects</TH><TH>Last sign-in</TH><TH /></TR></THead>
              <TBody>
                {users.users.map((u) => (
                  <TR key={u.id}>
                    <TD><span className="block">{u.name}</span><span className="text-xs text-muted-foreground">{u.email}</span></TD>
                    <TD className="text-xs">{ROLE_LABELS[u.role]}</TD>
                    <TD><StatusBadge status={u.status} /></TD>
                    <TD className="font-mono text-xs">{u._count.memberships}</TD>
                    <TD className="font-mono text-xs">{formatDateTime(u.lastLoginAt)}</TD>
                    <TD>{u.id === me.id ? <span className="text-xs text-muted-foreground">You</span> : <UserRowActions user={{ id: u.id, name: u.name, role: u.role, status: u.status }} />}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Pagination page={users.page} pageSize={users.pageSize} total={users.total} hrefFor={(p) => { const n = new URLSearchParams(qs); n.set("page", String(p)); return `/admin/users?${n}`; }} />
      <Card className="mt-6">
        <CardHeader><CardTitle>Pending invitations ({pending.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {pending.length === 0 ? <p className="px-4 pb-4 text-xs text-muted-foreground">No pending invitations.</p> : (
            <Table>
              <THead><TR><TH>Email</TH><TH>Role</TH><TH>Project</TH><TH>Invited by</TH><TH>Expires</TH><TH /></TR></THead>
              <TBody>
                {pending.map((i) => (
                  <TR key={i.id}>
                    <TD>{i.email}</TD><TD className="text-xs">{ROLE_LABELS[i.role]}</TD><TD className="text-xs">{i.project?.name ?? "—"}</TD>
                    <TD className="text-xs">{i.invitedBy.name}</TD><TD className="font-mono text-xs">{formatDate(i.expiresAt)}</TD>
                    <TD><RevokeInvitation id={i.id} email={i.email} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
