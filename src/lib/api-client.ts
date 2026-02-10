import type { Board, Task, Comment, TeamConfig, RefType } from "@/types/board";
import type { TeamState } from "@/types/team";

const BASE = "/api";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

export interface TeamResponse {
  connected: boolean;
  config?: TeamConfig;
  state?: TeamState;
}

export const api = {
  getBoard: () => request<Board>("/board"),

  createTask: (task: Partial<Task>) =>
    request<Task>("/tasks", {
      method: "POST",
      body: JSON.stringify(task),
    }),

  updateTask: (id: string, updates: Partial<Task>) =>
    request<Task>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    }),

  deleteTask: (id: string) =>
    request<void>(`/tasks/${id}`, { method: "DELETE" }),

  addComment: (taskId: string, comment: Omit<Comment, "id" | "timestamp">) =>
    request<Comment>(`/tasks/${taskId}/comments`, {
      method: "POST",
      body: JSON.stringify(comment),
    }),

  addRef: (taskId: string, targetId: string, type: RefType) =>
    request<Task>(`/tasks/${taskId}/refs`, {
      method: "POST",
      body: JSON.stringify({ taskId: targetId, type }),
    }),

  removeRef: (taskId: string, targetId: string) =>
    request<Task>(`/tasks/${taskId}/refs/${targetId}`, {
      method: "DELETE",
    }),

  // Team APIs
  getTeam: () => request<TeamResponse>("/team"),

  connectTeam: (config: { teamName: string; projectDir: string; model?: string; maxTurns?: number }) =>
    request<{ ok: boolean; config: TeamConfig }>("/team/connect", {
      method: "POST",
      body: JSON.stringify(config),
    }),

  disconnectTeam: () =>
    request<{ ok: boolean }>("/team/disconnect", { method: "POST" }),

  startTeam: () =>
    request<{ ok: boolean; pid: number }>("/team/start", { method: "POST" }),

  stopTeam: () =>
    request<{ ok: boolean }>("/team/stop", { method: "POST" }),

  getAvailableTeams: () =>
    request<{ teams: string[] }>("/teams/available"),

  getTeamLogs: (lines = 200) =>
    request<{ content: string }>(`/team/logs?lines=${lines}`),
};
