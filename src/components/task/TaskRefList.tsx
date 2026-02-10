import { useState } from "react";
import { Link2, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRIORITY_CONFIG } from "@/lib/constants";
import type { Task, RefType } from "@/types/board";

const REF_LABELS: Record<RefType, string> = {
  related: "Related to",
  blocks: "Blocks",
  "blocked-by": "Blocked by",
  parent: "Parent of",
  child: "Child of",
};

const REF_COLORS: Record<RefType, string> = {
  related: "text-blue-400",
  blocks: "text-amber-400",
  "blocked-by": "text-red-400",
  parent: "text-purple-400",
  child: "text-green-400",
};

interface TaskRefListProps {
  task: Task;
  allTasks: Task[];
  onAddRef: (targetId: string, type: RefType) => void;
  onRemoveRef: (targetId: string) => void;
}

export function TaskRefList({ task, allTasks, onAddRef, onRemoveRef }: TaskRefListProps) {
  const [adding, setAdding] = useState(false);
  const [selectedTask, setSelectedTask] = useState("");
  const [selectedType, setSelectedType] = useState<RefType>("related");

  const refs = task.refs ?? [];

  // Tasks available to link (exclude self and already-linked)
  const linkedIds = new Set(refs.map((r) => r.taskId));
  const linkable = allTasks.filter((t) => t.id !== task.id && !linkedIds.has(t.id));

  function handleAdd() {
    if (!selectedTask) return;
    onAddRef(selectedTask, selectedType);
    setSelectedTask("");
    setSelectedType("related");
    setAdding(false);
  }

  return (
    <div className="space-y-3">
      {refs.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground text-center py-6">
          No linked work items
        </p>
      )}

      {refs.map((ref) => {
        const target = allTasks.find((t) => t.id === ref.taskId);
        if (!target) return null;
        const priority = PRIORITY_CONFIG[target.priority];
        return (
          <div
            key={ref.taskId}
            className="flex items-start gap-2 rounded-md border p-2 bg-muted/20"
          >
            <Link2 className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <span className={`text-[10px] font-medium uppercase tracking-wider ${REF_COLORS[ref.type]}`}>
                {REF_LABELS[ref.type]}
              </span>
              <p className="text-sm truncate">{target.title}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="flex items-center gap-1">
                  <div className={`size-1.5 rounded-full ${priority.dotColor}`} />
                  <span className={`text-[10px] ${priority.color}`}>{priority.label}</span>
                </div>
                <Badge variant="outline" className="text-[10px] px-1 py-0">
                  {target.column}
                </Badge>
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="size-5 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => onRemoveRef(ref.taskId)}
            >
              <X className="size-3" />
            </Button>
          </div>
        );
      })}

      {adding ? (
        <div className="space-y-2 rounded-md border p-2 bg-muted/20">
          <Select value={selectedType} onValueChange={(v) => setSelectedType(v as RefType)}>
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(REF_LABELS) as [RefType, string][]).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedTask || "_none"} onValueChange={(v) => setSelectedTask(v === "_none" ? "" : v)}>
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue placeholder="Select a task..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none" disabled>Select a task...</SelectItem>
              {linkable.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  <span className="truncate">{t.title}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs flex-1" onClick={handleAdd} disabled={!selectedTask}>
              Link
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-8 text-xs gap-1"
          onClick={() => setAdding(true)}
          disabled={linkable.length === 0}
        >
          <Plus className="size-3" />
          Link work item
        </Button>
      )}
    </div>
  );
}
