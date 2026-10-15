"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell, CalendarDays, Columns3, FileText, Flag, FolderKanban, Github, Headphones, Landmark, LayoutDashboard,
  Menu, PlugZap, QrCode, ScrollText, Trophy, UserRound, Users, X, type LucideIcon,
} from "lucide-react";
import { navForRole, type Role } from "@iic/shared";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  Bell, CalendarDays, Columns3, FileText, Flag, FolderKanban, Github, Headphones, Landmark, LayoutDashboard,
  PlugZap, QrCode, ScrollText, Trophy, UserRound, Users,
};

function NavList({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  const items = navForRole(role);
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 py-4">
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{g}</p>
          <ul className="space-y-0.5">
            {items
              .filter((i) => i.group === g)
              .map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                        active && "bg-primary/15 text-foreground",
                      )}
                    >
                      <Icon className={cn("h-4 w-4", active && "text-primary")} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-5 py-4">
      <span className="grid h-7 w-7 place-items-center rounded-md bg-primary font-mono text-xs font-bold">IIC</span>
      <span className="text-sm font-semibold">Innovation Cell</span>
    </Link>
  );
}

export function Sidebar({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r bg-card/40 lg:block">
        <Brand />
        <NavList role={role} />
      </aside>
      <button
        type="button"
        className="fixed left-3 top-3 z-40 rounded-md border bg-card p-2 lg:hidden"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Menu className="h-4 w-4" />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 overflow-y-auto border-r bg-card">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <NavList role={role} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
