"use client";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { STAGE_LABELS, TASK_STATUS_LABELS, type ProjectStage, type TaskStatus } from "@iic/shared";

// Brutalist palette (see globals.css): raw primaries, black outlines.
const AXIS = { stroke: "#000000", fontSize: 11, fontWeight: 700 };
const TOOLTIP = {
  contentStyle: { background: "#FFFFFF", border: "3px solid #000000", borderRadius: 0, fontSize: 12 },
  labelStyle: { color: "#000000" },
  itemStyle: { color: "#000000" },
  cursor: { fill: "#FFFF00" },
};

export function StageChart({ data }: { data: { stage: ProjectStage; count: number }[] }) {
  const rows = data.map((d) => ({ name: STAGE_LABELS[d.stage].replace("Pre-Incubation Launch", "Pre-Incub."), count: d.count }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid stroke="#000000" vertical={false} />
        <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} interval={0} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip {...TOOLTIP} />
        <Bar dataKey="count" name="Projects" fill="#0000FF" stroke="#000000" strokeWidth={3} radius={0} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const STATUS_COLORS: Record<TaskStatus, string> = { TODO: "#FFFFFF", IN_PROGRESS: "#0000FF", REVIEW: "#FF00FF", DONE: "#00FF00" };

export function TaskStatusChart({ data }: { data: { status: TaskStatus; count: number }[] }) {
  const rows = data.map((d) => ({ name: TASK_STATUS_LABELS[d.status], value: d.count, status: d.status }));
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={140} height={140}>
        <PieChart>
          <Pie data={rows} dataKey="value" nameKey="name" innerRadius={42} outerRadius={64} stroke="#000000" strokeWidth={3}>
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
            <span className="h-3 w-3 border-2 border-foreground" style={{ background: STATUS_COLORS[r.status] }} />
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
        <CartesianGrid stroke="#000000" vertical={false} />
        <XAxis dataKey="week" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip {...TOOLTIP} />
        <Bar dataKey="completed" name="Tasks completed" fill="#00FF00" stroke="#000000" strokeWidth={3} radius={0} />
      </BarChart>
    </ResponsiveContainer>
  );
}
