import { useState, useEffect, useCallback, useRef } from "react";
import type { Board, Task, Comment, ColumnId, RefType } from "@/types/board";
import { api } from "@/lib/api-client";
import { toast } from "sonner";

export function useBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const eventSourceRef = useRef<EventSource | null>(null);
  // Track whether we just wrote to prevent double-reloads from our own SSE
  const justWroteRef = useRef(false);

  const fetchBoard = useCallback(async () => {
    try {
      const data = await api.getBoard();
      setBoard(data);
    } catch (err) {
      console.error("Failed to fetch board:", err);
      toast.error("Failed to load board");
    } finally {
      setLoading(false);
    }
  }, []);

  // SSE subscription
  useEffect(() => {
    const es = new EventSource("/api/events");
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "board-changed") {
        if (justWroteRef.current) {
          justWroteRef.current = false;
          return;
        }
        toast.info("Board updated externally");
        fetchBoard();
      }
      if (data.type === "team-changed") {
        fetchBoard();
      }
    };

    es.onerror = () => {
      console.warn("SSE connection lost, reconnecting...");
    };

    return () => {
      es.close();
    };
  }, [fetchBoard]);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  const createTask = useCallback(
    async (task: Partial<Task>) => {
      justWroteRef.current = true;
      const created = await api.createTask(task);
      setBoard((prev) =>
        prev ? { ...prev, tasks: [...prev.tasks, created] } : prev
      );
      return created;
    },
    []
  );

  const updateTask = useCallback(
    async (id: string, updates: Partial<Task>) => {
      justWroteRef.current = true;
      const updated = await api.updateTask(id, updates);
      setBoard((prev) =>
        prev
          ? {
              ...prev,
              tasks: prev.tasks.map((t) => (t.id === id ? updated : t)),
            }
          : prev
      );
      return updated;
    },
    []
  );

  const deleteTask = useCallback(async (id: string) => {
    justWroteRef.current = true;
    await api.deleteTask(id);
    setBoard((prev) =>
      prev ? { ...prev, tasks: prev.tasks.filter((t) => t.id !== id) } : prev
    );
  }, []);

  const moveTask = useCallback(
    async (id: string, column: ColumnId, order: number) => {
      justWroteRef.current = true;
      const updated = await api.updateTask(id, { column, order });
      setBoard((prev) =>
        prev
          ? {
              ...prev,
              tasks: prev.tasks.map((t) => (t.id === id ? updated : t)),
            }
          : prev
      );
    },
    []
  );

  const addComment = useCallback(
    async (taskId: string, comment: Omit<Comment, "id" | "timestamp">) => {
      justWroteRef.current = true;
      const created = await api.addComment(taskId, comment);
      setBoard((prev) =>
        prev
          ? {
              ...prev,
              tasks: prev.tasks.map((t) =>
                t.id === taskId
                  ? { ...t, comments: [...t.comments, created] }
                  : t
              ),
            }
          : prev
      );
      return created;
    },
    []
  );

  const addRef = useCallback(
    async (taskId: string, targetId: string, type: RefType) => {
      justWroteRef.current = true;
      const updated = await api.addRef(taskId, targetId, type);
      // Refetch entire board since inverse ref updates the target task too
      await fetchBoard();
      return updated;
    },
    [fetchBoard]
  );

  const removeRef = useCallback(
    async (taskId: string, targetId: string) => {
      justWroteRef.current = true;
      await api.removeRef(taskId, targetId);
      await fetchBoard();
    },
    [fetchBoard]
  );

  const getTasksByColumn = useCallback(
    (columnId: ColumnId): Task[] => {
      if (!board) return [];
      const tasks = board.tasks.filter((t) => t.column === columnId);
      if (columnId === "done") {
        return tasks.sort((a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      }
      return tasks.sort((a, b) => a.order - b.order);
    },
    [board]
  );

  return {
    board,
    loading,
    createTask,
    updateTask,
    deleteTask,
    moveTask,
    addComment,
    addRef,
    removeRef,
    getTasksByColumn,
    refetch: fetchBoard,
  };
}
