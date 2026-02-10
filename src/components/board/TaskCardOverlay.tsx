import { Badge } from "@/components/ui/badge";
import { PRIORITY_CONFIG } from "@/lib/constants";
import type { Task } from "@/types/board";

interface TaskCardOverlayProps {
  task: Task;
}

export function TaskCardOverlay({ task }: TaskCardOverlayProps) {
  const priority = PRIORITY_CONFIG[task.priority];

  return (
    <div className="rounded-lg border bg-card p-3 shadow-xl rotate-2 w-64">
      <p className="text-sm font-medium leading-tight truncate">{task.title}</p>
      {task.description && (
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
          {task.description}
        </p>
      )}
      <div className="flex items-center gap-2 mt-2">
        <div className="flex items-center gap-1">
          <div className={`size-2 rounded-full ${priority.dotColor}`} />
          <span className={`text-xs ${priority.color}`}>{priority.label}</span>
        </div>
        {task.tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
            {tag}
          </Badge>
        ))}
      </div>
    </div>
  );
}
