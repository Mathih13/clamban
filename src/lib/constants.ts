import type { ColumnDef, ColumnId, Priority, TaskType } from "@/types/board";

export const COLUMNS: ColumnDef[] = [
  { id: "backlog", name: "Backlog" },
  { id: "ready", name: "Ready" },
  { id: "in-progress", name: "In Progress" },
  { id: "review", name: "Review" },
  { id: "done", name: "Done" },
];

export const COLUMN_COLORS: Record<ColumnId, string> = {
  backlog: "bg-zinc-500",
  ready: "bg-blue-500",
  "in-progress": "bg-amber-500",
  review: "bg-purple-500",
  done: "bg-green-500",
};

export const PRIORITY_CONFIG: Record<
  Priority,
  { label: string; color: string; dotColor: string }
> = {
  low: { label: "Low", color: "text-zinc-400", dotColor: "bg-zinc-400" },
  medium: {
    label: "Medium",
    color: "text-blue-400",
    dotColor: "bg-blue-400",
  },
  high: {
    label: "High",
    color: "text-amber-400",
    dotColor: "bg-amber-400",
  },
  critical: {
    label: "Critical",
    color: "text-red-400",
    dotColor: "bg-red-400",
  },
};

export const TASK_TYPE_CONFIG: Record<
  TaskType,
  { label: string; color: string; icon: string }
> = {
  task: { label: "Task", color: "text-zinc-400", icon: "check-square" },
  bug: { label: "Bug", color: "text-red-400", icon: "bug" },
  feature: { label: "Feature", color: "text-green-400", icon: "sparkles" },
  chore: { label: "Chore", color: "text-zinc-400", icon: "wrench" },
};
