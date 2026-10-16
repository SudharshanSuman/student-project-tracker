"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Bell, LogOut, UserRound } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ROLE_LABELS, type Role } from "@iic/shared";
import { api } from "@/lib/api-client";
import { initials } from "@/lib/utils";

function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const router = useRouter();
  const refresh = useCallback(() => {
    api<{ unread: number }>("/notifications/unread-count").then((r) => setUnread(r.unread)).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    // Real-time hint channel; REST stays the source of truth. Falls back to polling.
    let ws: WebSocket | null = null;
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (wsUrl) {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (e) => {
          const msg = JSON.parse(String(e.data)) as { type?: string };
          if (msg.type === "notification") refresh();
          if (msg.type === "board") router.refresh();
        };
      } catch {
        ws = null;
      }
    }
    const t = setInterval(refresh, 60_000);
    return () => {
      clearInterval(t);
      ws?.close();
    };
  }, [refresh, router]);

  return (
    <Link href="/notifications" className="relative rounded-md p-2 hover:bg-muted" aria-label={`Notifications, ${unread} unread`}>
      <Bell className="h-4 w-4" />
      {unread > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center border-2 border-foreground bg-destructive px-1 tabular-nums text-[10px] font-bold">{unread > 99 ? "99+" : unread}</span>
      ) : null}
    </Link>
  );
}

export function Topbar({ name, email, role }: { name: string; email: string; role: Role }) {
  const router = useRouter();
  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-end gap-2 border-b bg-background px-4">
      <NotificationBell />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="flex items-center gap-2 border border-foreground px-2 py-1 hover:bg-muted" aria-label="Account menu">
          <span className="grid h-7 w-7 place-items-center border-2 border-foreground bg-primary text-xs font-bold text-primary-foreground">{initials(name)}</span>
          <span className="hidden text-left sm:block">
            <span className="block text-xs font-medium leading-tight">{name}</span>
            <span className="block text-[11px] leading-tight text-muted-foreground">{ROLE_LABELS[role]}</span>
          </span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-md border bg-card p-1 text-sm">
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{email}</div>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item asChild className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-muted">
              <Link href="/profile">
                <UserRound className="h-4 w-4" /> Profile
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={logout} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-muted">
              <LogOut className="h-4 w-4" /> Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
  );
}
