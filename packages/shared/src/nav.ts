import type { Role } from "./constants";

export interface NavItem {
  href: string;
  label: string;
  /** lucide-react icon name, resolved in the web app */
  icon: string;
  roles: readonly Role[];
  group: "Workspace" | "Operations" | "Insights" | "Admin" | "Account";
}

const ALL: readonly Role[] = ["ADMIN", "MENTOR", "PROJECT_LEAD", "PROJECT_MEMBER"];
const STAFF: readonly Role[] = ["ADMIN", "MENTOR"];

/**
 * Navigation map. The API enforces the same role rules server-side
 * (see apps/api/src/lib/access.ts); this list only decides what to show.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", roles: ALL, group: "Workspace" },
  { href: "/projects", label: "Projects", icon: "FolderKanban", roles: ALL, group: "Workspace" },
  { href: "/board", label: "Kanban board", icon: "Columns3", roles: ALL, group: "Workspace" },
  { href: "/milestones", label: "Milestones", icon: "Flag", roles: ALL, group: "Workspace" },
  { href: "/events", label: "Events", icon: "CalendarDays", roles: ALL, group: "Operations" },
  { href: "/attendance", label: "Attendance", icon: "QrCode", roles: ALL, group: "Operations" },
  { href: "/competitions", label: "Competitions", icon: "Trophy", roles: ALL, group: "Operations" },
  { href: "/funding", label: "Funding ledger", icon: "Landmark", roles: ["ADMIN", "MENTOR", "PROJECT_LEAD"], group: "Operations" },
  { href: "/discord", label: "Discord analytics", icon: "Headphones", roles: ["ADMIN", "MENTOR", "PROJECT_LEAD"], group: "Insights" },
  { href: "/github", label: "GitHub", icon: "Github", roles: ALL, group: "Insights" },
  { href: "/reports", label: "Reports", icon: "FileText", roles: STAFF, group: "Insights" },
  { href: "/admin/users", label: "Users", icon: "Users", roles: ["ADMIN"], group: "Admin" },
  { href: "/admin/integrations", label: "Integrations", icon: "PlugZap", roles: ["ADMIN"], group: "Admin" },
  { href: "/admin/audit", label: "Audit logs", icon: "ScrollText", roles: ["ADMIN"], group: "Admin" },
  { href: "/notifications", label: "Notifications", icon: "Bell", roles: ALL, group: "Account" },
  { href: "/profile", label: "Profile", icon: "UserRound", roles: ALL, group: "Account" },
];

export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((i) => i.roles.includes(role));
}

export function canSeeRoute(role: Role, pathname: string): boolean {
  const match = [...NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  return match ? match.roles.includes(role) : true;
}
