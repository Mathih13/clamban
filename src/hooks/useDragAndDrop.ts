import { useState, useCallback } from "react";
import {
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Task, ColumnId } from "@/types/board";

interface UseDragAndDropOptions {
  tasks: Task[];
  getTasksByColumn: (columnId: ColumnId) => Task[];
  moveTask: (id: string, column: ColumnId, order: number) => Promise<void>;
}

export function useDragAndDrop({
  tasks,
  getTasksByColumn,
  moveTask,
}: UseDragAndDropOptions) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id);
      if (task) setActiveTask(task);
    },
    [tasks]
  );

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    // We handle everything in onDragEnd for simplicity
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveTask(null);
      const { active, over } = event;
      if (!over || !activeTask) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      // Determine target column
      let targetColumn: ColumnId;
      let targetTasks: Task[];

      // Check if dropping on a column droppable
      const columnIds: ColumnId[] = [
        "backlog",
        "ready",
        "in-progress",
        "review",
        "done",
      ];
      if (columnIds.includes(overId as ColumnId)) {
        targetColumn = overId as ColumnId;
        targetTasks = getTasksByColumn(targetColumn);
      } else {
        // Dropping on another task
        const overTask = tasks.find((t) => t.id === overId);
        if (!overTask) return;
        targetColumn = overTask.column;
        targetTasks = getTasksByColumn(targetColumn);
      }

      // Calculate new order
      let newOrder: number;
      const filteredTasks = targetTasks.filter((t) => t.id !== activeId);

      if (columnIds.includes(overId as ColumnId)) {
        // Dropped on empty column area — put at end
        newOrder =
          filteredTasks.length > 0
            ? Math.max(...filteredTasks.map((t) => t.order)) + 1
            : 1;
      } else {
        // Dropped on a specific task
        const overIndex = filteredTasks.findIndex((t) => t.id === overId);
        if (overIndex === -1) {
          newOrder = 1;
        } else if (overIndex === 0) {
          newOrder = filteredTasks[0].order / 2;
        } else {
          const before = filteredTasks[overIndex - 1].order;
          const at = filteredTasks[overIndex].order;
          newOrder = (before + at) / 2;
        }
      }

      if (activeTask.column === targetColumn && activeTask.order === newOrder) {
        return;
      }

      await moveTask(activeId, targetColumn, newOrder);
    },
    [activeTask, tasks, getTasksByColumn, moveTask]
  );

  return {
    sensors,
    activeTask,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  };
}
