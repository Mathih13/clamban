import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { COLUMN_COLORS } from "@/lib/constants";
import { TaskCard } from "./TaskCard";
import type { Task, ColumnId } from "@/types/board";

interface ColumnProps {
  id: ColumnId;
  name: string;
  tasks: Task[];
  onEditTask: (task: Task) => void;
  onDeleteTask: (id: string) => void;
  onClickTask: (task: Task) => void;
}

export function Column({ id, name, tasks, onEditTask, onDeleteTask, onClickTask }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex flex-col min-w-[300px] w-[300px] shrink-0 h-full min-h-0">
      <div className="flex items-center gap-2 px-2 pb-3">
        <div className={`size-2.5 rounded-full ${COLUMN_COLORS[id]}`} />
        <h2 className="text-sm font-semibold">{name}</h2>
        <span className="text-xs text-muted-foreground ml-auto">
          {tasks.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-0 overflow-hidden rounded-lg p-2 transition-colors ${
          isOver ? "bg-accent/50" : "bg-muted/30"
        }`}
      >
        <ScrollArea className="h-full pr-1">
          <SortableContext
            items={tasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-2 min-h-[60px] pb-2">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onEdit={onEditTask}
                  onDelete={onDeleteTask}
                  onClick={onClickTask}
                />
              ))}
            </div>
          </SortableContext>
        </ScrollArea>
      </div>
    </div>
  );
}
