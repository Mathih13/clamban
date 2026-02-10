export type ColumnId = "backlog" | "ready" | "in-progress" | "review" | "done";
export type Priority = "low" | "medium" | "high" | "critical";
export type TaskType = "task" | "bug" | "feature" | "chore";

export interface Comment {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

export interface FileContext {
  path: string;
  note?: string;
}

export type RefType = "related" | "blocks" | "blocked-by" | "parent" | "child";

export interface TaskRef {
  taskId: string;
  type: RefType;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  column: ColumnId;
  order: number;
  priority: Priority;
  type: TaskType;
  tags: string[];
  comments: Comment[];
  context: FileContext[];
  refs: TaskRef[];
  assignee?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamConfig {
  teamName: string;
  projectDir: string;
  model?: string;
  maxTurns?: number;
}

export interface BoardMeta {
  name: string;
  createdAt: string;
  version: number;
  team?: TeamConfig;
}

export interface ColumnDef {
  id: ColumnId;
  name: string;
}

export interface Board {
  meta: BoardMeta;
  columns: ColumnDef[];
  tasks: Task[];
}
