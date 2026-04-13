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

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  id: string;
  author: string;
  text: string;
  details?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  answer?: string;
  askedAt: string;
  answeredAt?: string;
}

export interface Budget {
  turns?: number;
  wallClockMinutes?: number;
}

export interface Validation {
  build?: string;
  test?: string;
  typecheck?: string;
  lint?: string;
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
  questions: Question[];
  budget?: Budget;
  assignee?: string;
  branch?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamConfig {
  teamName: string;
  projectDir: string;
  model?: string;
  workerModel?: string;
  maxTurns?: number;
  defaultBudget?: Budget;
  validation?: Validation;
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
