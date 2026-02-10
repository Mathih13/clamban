import { useState } from "react";
import { Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COLUMNS, PRIORITY_CONFIG, TASK_TYPE_CONFIG } from "@/lib/constants";
import type { Task, ColumnId, Priority, TaskType, RefType } from "@/types/board";

const REF_LABELS: Record<RefType, string> = {
  related: "Related to",
  blocks: "Blocks",
  "blocked-by": "Blocked by",
  parent: "Parent of",
  child: "Child of",
};

export interface PendingRef {
  taskId: string;
  type: RefType;
}

interface TaskFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  allTasks?: Task[];
  memberNames?: string[];
  onSubmit: (data: {
    title: string;
    description: string;
    column: ColumnId;
    priority: Priority;
    type: TaskType;
    tags: string[];
    assignee?: string;
    pendingRefs?: PendingRef[];
  }) => void;
}

export function TaskForm({ open, onOpenChange, task, allTasks, memberNames, onSubmit }: TaskFormProps) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [column, setColumn] = useState<ColumnId>(task?.column ?? "backlog");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "medium");
  const [type, setType] = useState<TaskType>(task?.type ?? "task");
  const [tagsInput, setTagsInput] = useState(task?.tags.join(", ") ?? "");
  const [assignee, setAssignee] = useState(task?.assignee ?? "");
  const [refs, setRefs] = useState<PendingRef[]>([]);
  const [refTarget, setRefTarget] = useState("");
  const [refType, setRefType] = useState<RefType>("related");

  const isEdit = !!task;

  // Tasks available to link (exclude self when editing, exclude already-added)
  const linkedIds = new Set(refs.map((r) => r.taskId));
  const linkable = (allTasks ?? []).filter(
    (t) => t.id !== task?.id && !linkedIds.has(t.id)
  );

  function handleAddRef() {
    if (!refTarget) return;
    setRefs((prev) => [...prev, { taskId: refTarget, type: refType }]);
    setRefTarget("");
    setRefType("related");
  }

  function handleRemoveRef(taskId: string) {
    setRefs((prev) => prev.filter((r) => r.taskId !== taskId));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    onSubmit({
      title: title.trim(),
      description,
      column,
      priority,
      type,
      tags,
      assignee: assignee.trim() || undefined,
      pendingRefs: refs.length > 0 ? refs : undefined,
    });
    onOpenChange(false);
    if (!isEdit) {
      setTitle("");
      setDescription("");
      setColumn("backlog");
      setPriority("medium");
      setType("task");
      setTagsInput("");
      setAssignee("");
      setRefs([]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Task" : "New Task"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update the task details below."
                : "Fill in the details for your new task."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Task title..."
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the task..."
                rows={3}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label>Column</Label>
                <Select value={column} onValueChange={(v) => setColumn(v as ColumnId)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLUMNS.map((col) => (
                      <SelectItem key={col.id} value={col.id}>
                        {col.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(PRIORITY_CONFIG) as [Priority, typeof PRIORITY_CONFIG[Priority]][]).map(
                      ([key, cfg]) => (
                        <SelectItem key={key} value={key}>
                          {cfg.label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as TaskType)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(TASK_TYPE_CONFIG) as [TaskType, typeof TASK_TYPE_CONFIG[TaskType]][]).map(
                      ([key, cfg]) => (
                        <SelectItem key={key} value={key}>
                          {cfg.label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="tags">Tags (comma-separated)</Label>
                <Input
                  id="tags"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="bug, frontend, urgent"
                />
              </div>
              <div className="grid gap-2">
                <Label>Assignee</Label>
                {memberNames && memberNames.length > 0 ? (
                  <Select value={assignee || "_none"} onValueChange={(v) => setAssignee(v === "_none" ? "" : v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Unassigned</SelectItem>
                      {memberNames.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="assignee"
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                    placeholder="No team connected"
                  />
                )}
              </div>
            </div>
            {linkable.length > 0 && (
              <div className="grid gap-2">
                <Label>Linked Tasks</Label>
                {refs.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {refs.map((ref) => {
                      const target = (allTasks ?? []).find((t) => t.id === ref.taskId);
                      return (
                        <div key={ref.taskId} className="flex items-center gap-1.5 text-xs rounded bg-muted/50 px-2 py-1">
                          <Link2 className="size-3 shrink-0 text-muted-foreground" />
                          <span className="text-muted-foreground">{REF_LABELS[ref.type]}</span>
                          <span className="truncate flex-1">{target?.title ?? ref.taskId}</span>
                          <button type="button" onClick={() => handleRemoveRef(ref.taskId)} className="shrink-0 text-muted-foreground hover:text-destructive">
                            <X className="size-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex gap-2">
                  <Select value={refType} onValueChange={(v) => setRefType(v as RefType)}>
                    <SelectTrigger className="w-[130px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(REF_LABELS) as [RefType, string][]).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={refTarget || "_none"} onValueChange={(v) => setRefTarget(v === "_none" ? "" : v)}>
                    <SelectTrigger className="flex-1 h-8 text-xs">
                      <SelectValue placeholder="Select task..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none" disabled>Select task...</SelectItem>
                      {linkable.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          <span className="truncate">{t.title}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" variant="outline" className="h-8 text-xs px-2" onClick={handleAddRef} disabled={!refTarget}>
                    <Link2 className="size-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!title.trim()}>
              {isEdit ? "Save Changes" : "Create Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
