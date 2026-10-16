import { headers } from "next/headers";
import { canSeeRoute } from "@iic/shared";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { Forbidden } from "@/components/ui/states";
import { getMe } from "@/lib/api-server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  const pathname = (await headers()).get("x-pathname") ?? "";
  // Page-level role gate (the API still enforces every request independently).
  const allowed = !pathname || canSeeRoute(me.role, pathname);
  return (
    <div className="flex min-h-screen">
      <Sidebar role={me.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar name={me.name} email={me.email} role={me.role} />
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6">{allowed ? children : <Forbidden />}</main>
      </div>
    </div>
  );
}
