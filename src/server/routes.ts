import type { IncomingMessage, ServerResponse } from "http";
import path from "path";
import { readBoard, writeBoardSync, setActiveTeam, getActiveTeam } from "./board-store";
import type { Task, Comment, TeamConfig, RefType } from "../types/board";
import {
  getTeamState,
  startTeam,
  stopTeam,
  isTeamRunning,
  listAvailableTeams,
  readLogTail,
} from "./team-manager";

let serverPort = 5173; // default, updated by api-plugin

export function setServerPort(port: number) {
  serverPort = port;
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString()));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Callback to notify SSE clients about team changes
let teamChangedCallback: (() => void) | null = null;
export function onTeamChanged(cb: () => void) {
  teamChangedCallback = cb;
}

export async function handleRoute(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = req.url || "";
  const method = req.method || "GET";

  // GET /api/board
  if (method === "GET" && url === "/api/board") {
    const board = readBoard();
    json(res, 200, board);
    return true;
  }

  // POST /api/tasks
  if (method === "POST" && url === "/api/tasks") {
    const body = await parseBody(req);
    const board = readBoard();
    const now = new Date().toISOString();

    const columnTasks = board.tasks.filter(
      (t) => t.column === (body.column || "backlog")
    );
    const maxOrder =
      columnTasks.length > 0
        ? Math.max(...columnTasks.map((t) => t.order))
        : 0;

    const task: Task = {
      id: generateId(),
      title: (body.title as string) || "Untitled",
      description: (body.description as string) || "",
      column: (body.column as Task["column"]) || "backlog",
      order: maxOrder + 1,
      priority: (body.priority as Task["priority"]) || "medium",
      type: (body.type as Task["type"]) || "task",
      tags: (body.tags as string[]) || [],
      comments: [],
      context: [],
      refs: [],
      createdAt: now,
      updatedAt: now,
    };

    board.tasks.push(task);
    writeBoardSync(board);
    json(res, 201, task);
    return true;
  }

  // PATCH /api/tasks/:id
  const patchMatch = url.match(/^\/api\/tasks\/([^/]+)$/);
  if (method === "PATCH" && patchMatch) {
    const id = patchMatch[1];
    const body = await parseBody(req);
    const board = readBoard();
    const idx = board.tasks.findIndex((t) => t.id === id);
    if (idx === -1) {
      json(res, 404, { error: "Task not found" });
      return true;
    }

    const task = board.tasks[idx];
    const updatable = [
      "title",
      "description",
      "column",
      "order",
      "priority",
      "type",
      "tags",
      "context",
      "assignee",
    ] as const;
    for (const key of updatable) {
      if (key in body) {
        (task as unknown as Record<string, unknown>)[key] = body[key];
      }
    }
    task.updatedAt = new Date().toISOString();

    board.tasks[idx] = task;
    writeBoardSync(board);
    json(res, 200, task);
    return true;
  }

  // DELETE /api/tasks/:id
  const deleteMatch = url.match(/^\/api\/tasks\/([^/]+)$/);
  if (method === "DELETE" && deleteMatch) {
    const id = deleteMatch[1];
    const board = readBoard();
    const idx = board.tasks.findIndex((t) => t.id === id);
    if (idx === -1) {
      json(res, 404, { error: "Task not found" });
      return true;
    }
    board.tasks.splice(idx, 1);
    writeBoardSync(board);
    json(res, 200, { ok: true });
    return true;
  }

  // POST /api/tasks/:id/comments
  const commentMatch = url.match(/^\/api\/tasks\/([^/]+)\/comments$/);
  if (method === "POST" && commentMatch) {
    const id = commentMatch[1];
    const body = await parseBody(req);
    const board = readBoard();
    const task = board.tasks.find((t) => t.id === id);
    if (!task) {
      json(res, 404, { error: "Task not found" });
      return true;
    }

    const comment: Comment = {
      id: generateId(),
      author: (body.author as string) || "User",
      text: (body.text as string) || "",
      timestamp: new Date().toISOString(),
    };

    task.comments.push(comment);
    task.updatedAt = new Date().toISOString();
    writeBoardSync(board);
    json(res, 201, comment);
    return true;
  }

  // POST /api/tasks/:id/context — append a file to the task's file context
  const ctxAddMatch = url.match(/^\/api\/tasks\/([^/]+)\/context$/);
  if (method === "POST" && ctxAddMatch) {
    const id = ctxAddMatch[1];
    const body = await parseBody(req);
    const board = readBoard();
    const task = board.tasks.find((t) => t.id === id);
    if (!task) {
      json(res, 404, { error: "Task not found" });
      return true;
    }

    const rawPath = body.path as string;
    if (!rawPath) {
      json(res, 400, { error: "path is required" });
      return true;
    }

    const projectDir = board.meta.team?.projectDir;

    // Reject absolute paths — all paths must be relative to projectDir
    if (path.isAbsolute(rawPath)) {
      json(res, 400, { error: "Absolute paths are not allowed; use a path relative to projectDir" });
      return true;
    }

    if (!projectDir) {
      json(res, 400, { error: "No projectDir configured; connect a team first" });
      return true;
    }

    // Resolve and verify the path stays within projectDir
    const filePath = path.resolve(projectDir, rawPath);
    if (!filePath.startsWith(path.resolve(projectDir) + path.sep) && filePath !== path.resolve(projectDir)) {
      json(res, 400, { error: "Path escapes projectDir" });
      return true;
    }

    if (!task.context) task.context = [];
    // Avoid duplicates by path
    if (!task.context.some((f) => f.path === filePath)) {
      task.context.push({ path: filePath, note: (body.note as string) || undefined });
      task.updatedAt = new Date().toISOString();
      writeBoardSync(board);
    }

    json(res, 201, task);
    return true;
  }

  // POST /api/tasks/:id/refs
  const refAddMatch = url.match(/^\/api\/tasks\/([^/]+)\/refs$/);
  if (method === "POST" && refAddMatch) {
    const id = refAddMatch[1];
    const body = await parseBody(req);
    const board = readBoard();
    const task = board.tasks.find((t) => t.id === id);
    if (!task) {
      json(res, 404, { error: "Task not found" });
      return true;
    }

    const targetId = body.taskId as string;
    const refType = body.type as RefType;
    if (!targetId || !refType) {
      json(res, 400, { error: "taskId and type are required" });
      return true;
    }

    const target = board.tasks.find((t) => t.id === targetId);
    if (!target) {
      json(res, 404, { error: "Referenced task not found" });
      return true;
    }

    if (!task.refs) task.refs = [];
    if (!target.refs) target.refs = [];

    // Avoid duplicates
    if (task.refs.some((r) => r.taskId === targetId && r.type === refType)) {
      json(res, 200, task);
      return true;
    }

    // Add ref to source task
    task.refs.push({ taskId: targetId, type: refType });
    task.updatedAt = new Date().toISOString();

    // Add inverse ref to target task
    const inverseType: Record<RefType, RefType> = {
      "related": "related",
      "blocks": "blocked-by",
      "blocked-by": "blocks",
      "parent": "child",
      "child": "parent",
    };
    const inverse = inverseType[refType];
    if (!target.refs.some((r) => r.taskId === id && r.type === inverse)) {
      target.refs.push({ taskId: id, type: inverse });
      target.updatedAt = new Date().toISOString();
    }

    writeBoardSync(board);
    json(res, 201, task);
    return true;
  }

  // DELETE /api/tasks/:id/refs/:targetId
  const refDeleteMatch = url.match(/^\/api\/tasks\/([^/]+)\/refs\/([^/]+)$/);
  if (method === "DELETE" && refDeleteMatch) {
    const id = refDeleteMatch[1];
    const targetId = refDeleteMatch[2];
    const board = readBoard();
    const task = board.tasks.find((t) => t.id === id);
    if (!task) {
      json(res, 404, { error: "Task not found" });
      return true;
    }

    if (!task.refs) task.refs = [];
    const refIdx = task.refs.findIndex((r) => r.taskId === targetId);
    const removedType = refIdx >= 0 ? task.refs[refIdx].type : null;
    if (refIdx >= 0) task.refs.splice(refIdx, 1);
    task.updatedAt = new Date().toISOString();

    // Remove inverse ref from target
    if (removedType) {
      const target = board.tasks.find((t) => t.id === targetId);
      if (target && target.refs) {
        const inverseType: Record<RefType, RefType> = {
          "related": "related",
          "blocks": "blocked-by",
          "blocked-by": "blocks",
          "parent": "child",
          "child": "parent",
        };
        const inv = inverseType[removedType];
        const invIdx = target.refs.findIndex((r) => r.taskId === id && r.type === inv);
        if (invIdx >= 0) target.refs.splice(invIdx, 1);
        target.updatedAt = new Date().toISOString();
      }
    }

    writeBoardSync(board);
    json(res, 200, task);
    return true;
  }

  // --- Team routes ---

  // GET /api/team
  if (method === "GET" && url === "/api/team") {
    const board = readBoard();
    if (!board.meta.team) {
      json(res, 200, { connected: false });
      return true;
    }
    const state = getTeamState(board.meta.team.teamName);
    json(res, 200, { connected: true, config: board.meta.team, state });
    return true;
  }

  // POST /api/team/connect
  if (method === "POST" && url === "/api/team/connect") {
    const body = await parseBody(req);

    const teamConfig: TeamConfig = {
      teamName: (body.teamName as string) || "",
      projectDir: (body.projectDir as string) || "",
      model: (body.model as string) || "sonnet",
      maxTurns: (body.maxTurns as number) || 200,
    };

    if (!teamConfig.teamName || !teamConfig.projectDir) {
      json(res, 400, { error: "teamName and projectDir are required" });
      return true;
    }

    // Switch to the per-team board file before reading/writing
    setActiveTeam(teamConfig.teamName);
    const board = readBoard();

    board.meta.team = teamConfig;
    writeBoardSync(board);
    teamChangedCallback?.();
    json(res, 200, { ok: true, config: teamConfig });
    return true;
  }

  // POST /api/team/disconnect
  if (method === "POST" && url === "/api/team/disconnect") {
    const board = readBoard();
    const teamName = board.meta.team?.teamName;

    // Stop team if running
    if (teamName && isTeamRunning(teamName)) {
      stopTeam(teamName);
    }

    delete board.meta.team;
    writeBoardSync(board);
    setActiveTeam(null);
    teamChangedCallback?.();
    json(res, 200, { ok: true });
    return true;
  }

  // POST /api/team/start
  if (method === "POST" && url === "/api/team/start") {
    const board = readBoard();
    if (!board.meta.team) {
      json(res, 400, { error: "No team connected" });
      return true;
    }

    try {
      const result = startTeam(board.meta.team, serverPort, () => {
        teamChangedCallback?.();
      });
      teamChangedCallback?.();
      json(res, 200, { ok: true, pid: result.pid });
    } catch (err) {
      json(res, 409, { error: err instanceof Error ? err.message : "Failed to start team" });
    }
    return true;
  }

  // POST /api/team/stop
  if (method === "POST" && url === "/api/team/stop") {
    const board = readBoard();
    const teamName = board.meta.team?.teamName;
    if (teamName) {
      stopTeam(teamName);
    }
    teamChangedCallback?.();
    json(res, 200, { ok: true });
    return true;
  }

  // GET /api/team/logs
  if (method === "GET" && url.startsWith("/api/team/logs")) {
    const teamName = getActiveTeam();
    if (!teamName) {
      json(res, 200, { content: "" });
      return true;
    }
    const params = new URL(url, "http://localhost").searchParams;
    const lines = parseInt(params.get("lines") || "200", 10);
    const content = readLogTail(teamName, Math.min(lines, 2000));
    json(res, 200, { content });
    return true;
  }

  // GET /api/teams/available
  if (method === "GET" && url === "/api/teams/available") {
    const teams = listAvailableTeams();
    json(res, 200, { teams });
    return true;
  }

  return false;
}
