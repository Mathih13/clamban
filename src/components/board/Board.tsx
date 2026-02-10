import { DndContext, DragOverlay, closestCorners } from "@dnd-kit/core";
import { COLUMNS } from "@/lib/constants";
import { useDragAndDrop } from "@/hooks/useDragAndDrop";
import { Column } from "./Column";
import { TaskCardOverlay } from "./TaskCardOverlay";
import type { Task, ColumnId } from "@/types/board";

interface BoardProps {
  tasks: Task[];
  getTasksByColumn: (columnId: ColumnId) => Task[];
  moveTask: (id: string, column: ColumnId, order: number) => Promise<void>;
  onEditTask: (task: Task) => void;
  onDeleteTask: (id: string) => void;
  onClickTask: (task: Task) => void;
}

export function Board({
  tasks,
  getTasksByColumn,
  moveTask,
  onEditTask,
  onDeleteTask,
  onClickTask,
}: BoardProps) {
  const { sensors, activeTask, handleDragStart, handleDragOver, handleDragEnd } =
    useDragAndDrop({ tasks, getTasksByColumn, moveTask });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 p-6 overflow-x-auto overflow-y-hidden flex-1 min-h-0">
        {COLUMNS.map((col) => (
          <Column
            key={col.id}
            id={col.id}
            name={col.name}
            tasks={getTasksByColumn(col.id)}
            onEditTask={onEditTask}
            onDeleteTask={onDeleteTask}
            onClickTask={onClickTask}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <TaskCardOverlay task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
