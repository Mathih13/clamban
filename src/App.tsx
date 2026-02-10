import { useState, useCallback } from "react";
import { Toaster, toast } from "sonner";
import { useBoard } from "@/hooks/useBoard";
import { useTeam } from "@/hooks/useTeam";
import { Header } from "@/components/layout/Header";
import { Board } from "@/components/board/Board";
import { TaskForm } from "@/components/task/TaskForm";
import { TaskDetailSheet } from "@/components/task/TaskDetailSheet";
import { TeamPanel } from "@/components/team/TeamPanel";
import { TeamConnectDialog } from "@/components/team/TeamConnectDialog";
import type { Task, ColumnId, Priority, TaskType, FileContext, RefType } from "@/types/board";
import type { PendingRef } from "@/components/task/TaskForm";

function App() {
  const {
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
  } = useBoard();

  const {
    connected: teamConnected,
    running: teamRunning,
    config: teamConfig,
    state: teamState,
    memberNames: teamMemberNames,
    connect: connectTeam,
    disconnect: disconnectTeam,
    start: startTeam,
    stop: stopTeam,
  } = useTeam();

  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [teamPanelOpen, setTeamPanelOpen] = useState(false);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);

  const handleNewTask = useCallback(() => {
    setEditingTask(null);
    setFormOpen(true);
  }, []);

  const handleEditTask = useCallback((task: Task) => {
    setEditingTask(task);
    setFormOpen(true);
  }, []);

  const handleDeleteTask = useCallback(
    async (id: string) => {
      await deleteTask(id);
      toast.success("Task deleted");
      if (detailTask?.id === id) {
        setDetailOpen(false);
        setDetailTask(null);
      }
    },
    [deleteTask, detailTask]
  );

  const handleClickTask = useCallback((task: Task) => {
    setDetailTask(task);
    setDetailOpen(true);
  }, []);

  const handleFormSubmit = useCallback(
    async (data: {
      title: string;
      description: string;
      column: ColumnId;
      priority: Priority;
      type: TaskType;
      tags: string[];
      assignee?: string;
      pendingRefs?: PendingRef[];
    }) => {
      const { pendingRefs, ...taskData } = data;
      if (editingTask) {
        const updated = await updateTask(editingTask.id, taskData);
        // Add any new refs for edited tasks
        if (pendingRefs) {
          for (const ref of pendingRefs) {
            await addRef(editingTask.id, ref.taskId, ref.type);
          }
        }
        toast.success("Task updated");
        if (detailTask?.id === editingTask.id) {
          setDetailTask(updated);
        }
      } else {
        const created = await createTask(taskData);
        // Link refs after creation
        if (pendingRefs) {
          for (const ref of pendingRefs) {
            await addRef(created.id, ref.taskId, ref.type);
          }
        }
        toast.success("Task created");
      }
    },
    [editingTask, createTask, updateTask, addRef, detailTask]
  );

  const handleAddComment = useCallback(
    async (taskId: string, text: string) => {
      const comment = await addComment(taskId, { author: "User", text });
      if (detailTask?.id === taskId) {
        setDetailTask((prev) =>
          prev ? { ...prev, comments: [...prev.comments, comment] } : prev
        );
      }
      toast.success("Comment added");
    },
    [addComment, detailTask]
  );

  const handleUpdateContext = useCallback(
    async (taskId: string, files: FileContext[]) => {
      const updated = await updateTask(taskId, { context: files });
      if (detailTask?.id === taskId) {
        setDetailTask(updated);
      }
    },
    [updateTask, detailTask]
  );

  const handleAddRef = useCallback(
    async (taskId: string, targetId: string, type: RefType) => {
      const updated = await addRef(taskId, targetId, type);
      if (detailTask?.id === taskId) {
        setDetailTask(updated);
      }
      toast.success("Link added");
    },
    [addRef, detailTask]
  );

  const handleRemoveRef = useCallback(
    async (taskId: string, targetId: string) => {
      await removeRef(taskId, targetId);
      if (detailTask) {
        setDetailTask((prev) =>
          prev ? { ...prev, refs: prev.refs.filter((r) => r.taskId !== targetId) } : prev
        );
      }
      toast.success("Link removed");
    },
    [removeRef, detailTask]
  );

  const handleTeamClick = useCallback(() => {
    if (teamConnected) {
      setTeamPanelOpen((prev) => !prev);
    } else {
      setConnectDialogOpen(true);
    }
  }, [teamConnected]);

  const handleTeamConnect = useCallback(
    async (config: { teamName: string; projectDir: string; model?: string; maxTurns?: number }) => {
      await connectTeam(config);
      setTeamPanelOpen(true);
    },
    [connectTeam]
  );

  const handleTeamDisconnect = useCallback(async () => {
    await disconnectTeam();
    setTeamPanelOpen(false);
  }, [disconnectTeam]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center text-muted-foreground">
        Loading board...
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        onNewTask={handleNewTask}
        taskCount={board?.tasks.length ?? 0}
        teamConnected={teamConnected}
        teamRunning={teamRunning}
        teamName={teamConfig?.teamName}
        onTeamClick={handleTeamClick}
      />
      {teamConnected && teamConfig && teamPanelOpen && (
        <TeamPanel
          key={teamConfig.teamName}
          config={teamConfig}
          state={teamState}
          running={teamRunning}
          tasks={board?.tasks ?? []}
          onStart={startTeam}
          onStop={stopTeam}
          onDisconnect={handleTeamDisconnect}
        />
      )}
      <Board
        tasks={board?.tasks ?? []}
        getTasksByColumn={getTasksByColumn}
        moveTask={moveTask}
        onEditTask={handleEditTask}
        onDeleteTask={handleDeleteTask}
        onClickTask={handleClickTask}
      />
      <TaskForm
        open={formOpen}
        onOpenChange={setFormOpen}
        task={editingTask}
        allTasks={board?.tasks ?? []}
        onSubmit={handleFormSubmit}
        memberNames={teamMemberNames}
        key={editingTask?.id ?? "new"}
      />
      <TaskDetailSheet
        task={detailTask}
        allTasks={board?.tasks ?? []}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onAddComment={handleAddComment}
        onUpdateContext={handleUpdateContext}
        onAddRef={handleAddRef}
        onRemoveRef={handleRemoveRef}
        onDelete={handleDeleteTask}
      />
      <TeamConnectDialog
        open={connectDialogOpen}
        onOpenChange={setConnectDialogOpen}
        onConnect={handleTeamConnect}
      />
      <Toaster position="bottom-right" theme="dark" />
    </div>
  );
}

export default App;
