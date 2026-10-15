"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

export interface FilterDef {
  name: string;
  label: string;
  type: "select" | "search" | "date";
  options?: { value: string; label: string }[];
}

/** URL-driven filter bar: every filter is a query param, so views are shareable and server-rendered. */
export function QueryFilters({ filters }: { filters: FilterDef[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function set(name: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`));
  }

  const active = filters.some((f) => params.get(f.name));
  return (
    <div className="mb-4 flex flex-wrap items-end gap-2" aria-busy={pending}>
      {filters.map((f) => (
        <label key={f.name} className="flex min-w-[140px] flex-col gap-1 text-xs text-muted-foreground">
          {f.label}
          {f.type === "select" ? (
            <Select value={params.get(f.name) ?? ""} onChange={(e) => set(f.name, e.target.value)} className="h-8 text-xs">
              <option value="">All</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : f.type === "date" ? (
            <Input type="date" className="h-8 text-xs" value={params.get(f.name) ?? ""} onChange={(e) => set(f.name, e.target.value)} />
          ) : (
            <Input
              type="search"
              className="h-8 text-xs"
              placeholder="Search…"
              defaultValue={params.get(f.name) ?? ""}
              onKeyDown={(e) => {
                if (e.key === "Enter") set(f.name, (e.target as HTMLInputElement).value.trim());
              }}
              onBlur={(e) => {
                if (e.target.value.trim() !== (params.get(f.name) ?? "")) set(f.name, e.target.value.trim());
              }}
            />
          )}
        </label>
      ))}
      {active ? (
        <Button variant="ghost" size="sm" onClick={() => start(() => router.replace(pathname))}>
          <X /> Clear
        </Button>
      ) : null}
    </div>
  );
}
