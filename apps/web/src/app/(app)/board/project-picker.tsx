"use client";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/input";

export function ProjectPicker({ projects, value }: { projects: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  return (
    <Select aria-label="Project" value={value} onChange={(e) => router.push(`/board?project=${e.target.value}`)} className="w-64">
      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </Select>
  );
}
