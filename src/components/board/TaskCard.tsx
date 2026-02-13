import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GitBranch, GripVertical, MoreHorizontal, Pencil, Trash2, MessageSquare, FileCode2, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PRIORITY_CONFIG, TASK_TYPE_CONFIG } from "@/lib/constants";
import type { Task } from "@/types/board";

interface TaskCardProps {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onClick: (task: Task) => void;
}

export function TaskCard({ task, onEdit, onDelete, onClick }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const priority = PRIORITY_CONFIG[task.priority];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group rounded-lg border bg-card p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer ${
        isDragging ? "opacity-50 shadow-lg" : ""
      }`}
      onClick={() => onClick(task)}
    >
      <div className="flex items-start gap-2">
        <button
          className="mt-0.5 shrink-0 cursor-grab opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity touch-none"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="size-4 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium leading-tight truncate">
              {task.title}
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity rounded p-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="size-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(task);
                  }}
                >
                  <Pencil />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(task.id);
                  }}
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {task.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {task.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {task.type && task.type !== "task" && (
              <span className={`text-xs font-medium ${TASK_TYPE_CONFIG[task.type]?.color ?? "text-zinc-400"}`}>
                {TASK_TYPE_CONFIG[task.type]?.label ?? task.type}
              </span>
            )}
            <div className="flex items-center gap-1">
              <div className={`size-2 rounded-full ${priority.dotColor}`} />
              <span className={`text-xs ${priority.color}`}>
                {priority.label}
              </span>
            </div>
            {task.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                {tag}
              </Badge>
            ))}
          </div>
          {(task.comments.length > 0 || task.context.length > 0 || (task.refs ?? []).length > 0 || task.assignee || task.branch) && (
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              {task.assignee && (
                <span className="flex items-center gap-1">
                  <span className="size-3 rounded-full bg-primary/20 flex items-center justify-center text-[8px] font-bold text-primary">
                    {task.assignee[0]?.toUpperCase()}
                  </span>
                  <span className="truncate max-w-[80px]">{task.assignee}</span>
                </span>
              )}
              {task.comments.length > 0 && (
                <span className="flex items-center gap-1">
                  <MessageSquare className="size-3" />
                  {task.comments.length}
                </span>
              )}
              {(task.refs ?? []).length > 0 && (
                <span className="flex items-center gap-1">
                  <Link2 className="size-3" />
                  {task.refs.length}
                </span>
              )}
              {task.context.length > 0 && (
                <span className="flex items-center gap-1">
                  <FileCode2 className="size-3" />
                  {task.context.length}
                </span>
              )}
              {task.branch && (
                <span className="flex items-center gap-1">
                  <GitBranch className="size-3" />
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
