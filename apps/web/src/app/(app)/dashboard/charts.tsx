"use client";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { STAGE_LABELS, TASK_STATUS_LABELS, type ProjectStage, type TaskStatus } from "@iic/shared";

// Swiss palette (see globals.css): ink, rule, accent, olive/ochre/rust semantics.
const AXIS = { stroke: "#6E6E6E", fontSize: 11 };
const TOOLTIP = {
  contentStyle: { background: "#FFFFFF", border: "1px solid #000000", borderRadius: 0, fontSize: 12 },
  labelStyle: { color: "#000000" },
  itemStyle: { color: "#000000" },
  cursor: { fill: "rgba(179,139,109,0.12)" },
};

export function StageChart({ data }: { data: { stage: ProjectStage; count: number }[] }) {
  const rows = data.map((d) => ({ name: STAGE_LABELS[d.stage].replace("Pre-Incubation Launch", "Pre-Incub."), count: d.count }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid stroke="#DDD8CF" vertical={false} />
        <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} interval={0} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip {...TOOLTIP} />
        <Bar dataKey="count" name="Projects" fill="#000000" radius={0} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const STATUS_COLORS: Record<TaskStatus, string> = { TODO: "#C9C3B6", IN_PROGRESS: "#B38B6D", REVIEW: "#8C5F0F", DONE: "#5C6B30" };

export function TaskStatusChart({ data }: { data: { status: TaskStatus; count: number }[] }) {
  const rows = data.map((d) => ({ name: TASK_STATUS_LABELS[d.status], value: d.count, status: d.status }));
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={140} height={140}>
        <PieChart>
          <Pie data={rows} dataKey="value" nameKey="name" innerRadius={42} outerRadius={64} stroke="none">
            {rows.map((r) => (
              <Cell key={r.status} fill={STATUS_COLORS[r.status]} />
            ))}
          </Pie>
          <Tooltip {...TOOLTIP} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="space-y-1 text-xs">
        {rows.map((r) => (
          <li key={r.status} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[r.status] }} />
            <span className="text-muted-foreground">{r.name}</span>
            <span className="tabular-nums">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CompletedChart({ data }: { data: { week: string; completed: number }[] }) {
  const rows = data.map((d) => ({ week: new Date(d.week).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), completed: d.completed }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid stroke="#DDD8CF" vertical={false} />
        <XAxis dataKey="week" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip {...TOOLTIP} />
        <Bar dataKey="completed" name="Tasks completed" fill="#5C6B30" radius={0} />
      </BarChart>
    </ResponsiveContainer>
  );
}
