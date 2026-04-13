import type { IncomingMessage, ServerResponse } from "http";
import { execSync } from "child_process";
import path from "path";
import { readBoard, writeBoardSync, setActiveTeam, getActiveTeam } from "./board-store";
import type { Task, Comment, Question, TeamConfig, RefType } from "../types/board";
import {
  getTeamState,
  startTeam,
  stopTeam,
  isTeamRunning,
  listAvailableTeams,
  readLogTail,
  listWorkerLogs,
  readWorkerLogTail,
  spawnWorker,
  killWorker,
  listRunningWorkers,
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
        reject(new Error(`Invalid JSON in ${req.method} ${req.url}: ${data.slice(0, 200)}`));
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

export async function handleRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url || "";
  const method = req.method || "GET";

  // GET /api/board
  const parsedUrl = new URL(url, "http://localhost");
  if (method === "GET" && parsedUrl.pathname === "/api/board") {
    const board = readBoard();

    if (parsedUrl.searchParams.get("excludeDone") === "true") {
      const nonDoneTasks = board.tasks.filter((t) => t.column !== "done");
      const referencedIds = new Set<string>();
      for (const t of nonDoneTasks) {
        for (const ref of t.refs ?? []) {
          referencedIds.add(ref.taskId);
        }
      }
      board.tasks = board.tasks.filter((t) => t.column !== "done" || referencedIds.has(t.id));
    }

    json(res, 200, board);
    return true;
  }

  // GET /api/tasks/search
  if (method === "GET" && parsedUrl.pathname === "/api/tasks/search") {
    const q = parsedUrl.searchParams.get("q");
    if (!q) {
      json(res, 400, { error: "q parameter is required" });
      return true;
    }

    const column = parsedUrl.searchParams.get("column");
    const rawLimit = parseInt(parsedUrl.searchParams.get("limit") || "20", 10);
    const limit = Math.max(0, Math.min(Number.isNaN(rawLimit) ? 20 : rawLimit, 100));

    const board = readBoard();
    const needle = q.toLowerCase();

    const results = board.tasks.filter((t) => {
      if (column && t.column !== column) return false;
      return (
        t.title.toLowerCase().includes(needle) ||
        (t.description ?? "").toLowerCase().includes(needle) ||
        (t.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))
      );
    });

    json(res, 200, results.slice(0, limit));
    return true;
  }

  // GET /api/tasks?ids=id1,id2,id3
  if (method === "GET" && parsedUrl.pathname === "/api/tasks") {
    const idsParam = parsedUrl.searchParams.get("ids");
    if (!idsParam) {
      json(res, 400, { error: "ids parameter is required" });
      return true;
    }
    const ids = idsParam.split(",").filter(Boolean);
    const board = readBoard();
    const idSet = new Set(ids);
    const results = board.tasks.filter((t) => idSet.has(t.id));
    json(res, 200, results);
    return true;
  }

  // POST /api/tasks
  if (method === "POST" && url === "/api/tasks") {
    const body = await parseBody(req);
    const board = readBoard();
    const now = new Date().toISOString();

    const columnTasks = board.tasks.filter((t) => t.column === (body.column || "backlog"));
    const maxOrder = columnTasks.length > 0 ? Math.max(...columnTasks.map((t) => t.order)) : 0;

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
      questions: [],
      budget: (body.budget as Task["budget"]) || undefined,
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
      "branch",
      "budget",
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
      json(res, 400, {
        error: "Absolute paths are not allowed; use a path relative to projectDir",
      });
      return true;
    }

    if (!projectDir) {
      json(res, 400, { error: "No projectDir configured; connect a team first" });
      return true;
    }

    // Resolve and verify the path stays within projectDir
    const filePath = path.resolve(projectDir, rawPath);
    if (
      !filePath.startsWith(path.resolve(projectDir) + path.sep) &&
      filePath !== path.resolve(projectDir)
    ) {
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
      related: "related",
      blocks: "blocked-by",
      "blocked-by": "blocks",
      parent: "child",
      child: "parent",
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
          related: "related",
          blocks: "blocked-by",
          "blocked-by": "blocks",
          parent: "child",
          child: "parent",
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

  // POST /api/tasks/:id/questions
  const questionAddMatch = url.match(/^\/api\/tasks\/([^/]+)\/questions$/);
  if (method === "POST" && questionAddMatch) {
    const id = questionAddMatch[1];
    const body = await parseBody(req);
    const board = readBoard();
    const task = board.tasks.find((t) => t.id === id);
    if (!task) {
      json(res, 404, { error: "Task not found" });
      return true;
    }

    const question: Question = {
      id: generateId(),
      author: (body.author as string) || "Worker",
      text: (body.text as string) || "",
      details: (body.details as string) || undefined,
      options: body.options as Question["options"],
      multiSelect: (body.multiSelect as boolean) || undefined,
      askedAt: new Date().toISOString(),
    };

    if (!task.questions) task.questions = [];
    task.questions.push(question);
    task.updatedAt = new Date().toISOString();
    writeBoardSync(board);
    json(res, 201, question);
    return true;
  }

  // PATCH /api/tasks/:id/questions/:questionId
  const questionPatchMatch = url.match(/^\/api\/tasks\/([^/]+)\/questions\/([^/]+)$/);
  if (method === "PATCH" && questionPatchMatch) {
    const id = questionPatchMatch[1];
    const qid = questionPatchMatch[2];
    const body = await parseBody(req);
    const board = readBoard();
    const task = board.tasks.find((t) => t.id === id);
    if (!task) {
      json(res, 404, { error: "Task not found" });
      return true;
    }

    const question = (task.questions ?? []).find((q) => q.id === qid);
    if (!question) {
      json(res, 404, { error: "Question not found" });
      return true;
    }

    question.answer = body.answer as string;
    question.answeredAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    writeBoardSync(board);
    json(res, 200, question);
    return true;
  }

  // GET /api/tasks/:id/questions/:questionId — fetch a single question
  const questionGetMatch = parsedUrl.pathname.match(/^\/api\/tasks\/([^/]+)\/questions\/([^/]+)$/);
  if (method === "GET" && questionGetMatch) {
    const id = questionGetMatch[1];
    const qid = questionGetMatch[2];
    const board = readBoard();
    const task = board.tasks.find((t) => t.id === id);
    if (!task) {
      json(res, 404, { error: "Task not found" });
      return true;
    }

    const question = (task.questions ?? []).find((q) => q.id === qid);
    if (!question) {
      json(res, 404, { error: "Question not found" });
      return true;
    }

    json(res, 200, question);
    return true;
  }

  // GET /api/questions/pending — all unanswered questions across tasks
  if (method === "GET" && parsedUrl.pathname === "/api/questions/pending") {
    const board = readBoard();
    const pending: Array<{
      taskId: string;
      taskTitle: string;
      question: Question;
    }> = [];
    for (const task of board.tasks) {
      for (const q of task.questions ?? []) {
        if (!q.answer) {
          pending.push({ taskId: task.id, taskTitle: task.title, question: q });
        }
      }
    }
    json(res, 200, pending);
    return true;
  }

  // --- Worker routes ---

  // POST /api/workers/spawn
  if (method === "POST" && url === "/api/workers/spawn") {
    const body = await parseBody(req);
    const board = readBoard();
    if (!board.meta.team) {
      json(res, 400, { error: "No team connected" });
      return true;
    }
    const workerName = body.name as string;
    const taskId = body.taskId as string;
    const mode = (body.mode as "plan" | "build") || "plan";
    if (!workerName || !taskId) {
      json(res, 400, { error: "name and taskId are required" });
      return true;
    }
    if (mode !== "plan" && mode !== "build") {
      json(res, 400, { error: 'mode must be "plan" or "build"' });
      return true;
    }
    try {
      const result = spawnWorker(board.meta.team, workerName, taskId, serverPort, mode);
      json(res, 201, { ok: true, ...result });
    } catch (err) {
      json(res, 409, {
        error: err instanceof Error ? err.message : "Failed to spawn worker",
      });
    }
    return true;
  }

  // POST /api/workers/:name/kill
  const workerKillMatch = url.match(/^\/api\/workers\/([^/]+)\/kill$/);
  if (method === "POST" && workerKillMatch) {
    const workerName = decodeURIComponent(workerKillMatch[1]);
    try {
      killWorker(workerName);
      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 409, {
        error: err instanceof Error ? err.message : "Failed to kill worker",
      });
    }
    return true;
  }

  // GET /api/workers
  if (method === "GET" && url === "/api/workers") {
    json(res, 200, { workers: listRunningWorkers() });
    return true;
  }

  // --- Review routes ---

  // GET /api/tasks/:id/diff
  const diffMatch = parsedUrl.pathname.match(/^\/api\/tasks\/([^/]+)\/diff$/);
  if (method === "GET" && diffMatch) {
    const id = diffMatch[1];
    const board = readBoard();
    const task = board.tasks.find((t) => t.id === id);
    if (!task) {
      json(res, 404, { error: "Task not found" });
      return true;
    }
    if (!task.branch) {
      json(res, 404, { error: "Task has no branch" });
      return true;
    }
    const projectDir = board.meta.team?.projectDir;
    if (!projectDir) {
      json(res, 400, { error: "No team connected" });
      return true;
    }

    try {
      const diff = execSync(`git diff main...${task.branch}`, {
        cwd: projectDir,
        stdio: "pipe",
        maxBuffer: 50 * 1024 * 1024,
      }).toString();

      const statOutput = execSync(`git diff --stat main...${task.branch}`, {
        cwd: projectDir,
        stdio: "pipe",
      }).toString();

      // Parse stats from the summary line: " 3 files changed, 42 insertions(+), 18 deletions(-)"
      const statMatch = statOutput.match(
        /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/
      );
      const stats = {
        files: statMatch ? parseInt(statMatch[1], 10) : 0,
        additions: statMatch && statMatch[2] ? parseInt(statMatch[2], 10) : 0,
        deletions: statMatch && statMatch[3] ? parseInt(statMatch[3], 10) : 0,
      };

      json(res, 200, { diff, stats });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      json(res, 500, { error: `Failed to get diff: ${msg.slice(0, 200)}` });
    }
    return true;
  }

  // POST /api/tasks/:id/merge
  const mergeMatch = parsedUrl.pathname.match(/^\/api\/tasks\/([^/]+)\/merge$/);
  if (method === "POST" && mergeMatch) {
    const id = mergeMatch[1];
    const board = readBoard();
    const task = board.tasks.find((t) => t.id === id);
    if (!task) {
      json(res, 404, { error: "Task not found" });
      return true;
    }
    if (!task.branch) {
      json(res, 400, { error: "Task has no branch" });
      return true;
    }
    const projectDir = board.meta.team?.projectDir;
    if (!projectDir) {
      json(res, 400, { error: "No team connected" });
      return true;
    }

    try {
      execSync(`git merge ${task.branch} --no-edit`, {
        cwd: projectDir,
        stdio: "pipe",
      });

      // Clean up worktree and branch (best-effort)
      try {
        const worktreePath = path.join(projectDir, ".clamban-worktrees");
        const entries = require("fs")
          .readdirSync(worktreePath)
          .filter((e: string) => e.includes(task.branch!.split("/").pop()!));
        for (const entry of entries) {
          const fullPath = path.join(worktreePath, entry);
          try {
            execSync(`git worktree remove --force "${fullPath}"`, {
              cwd: projectDir,
              stdio: "pipe",
            });
          } catch {}
        }
      } catch {}
      try {
        execSync(`git branch -D "${task.branch}"`, { cwd: projectDir, stdio: "pipe" });
      } catch {}

      // Update board: move to done + add comment
      const freshBoard = readBoard();
      const freshTask = freshBoard.tasks.find((t) => t.id === id);
      if (freshTask) {
        freshTask.column = "done";
        freshTask.updatedAt = new Date().toISOString();
        freshTask.comments.push({
          id: generateId(),
          author: "Human Pilot",
          text: "Reviewed and merged by human pilot.",
          timestamp: new Date().toISOString(),
        });
        writeBoardSync(freshBoard);
      }

      json(res, 200, { ok: true });
    } catch (err) {
      const e = err as { stderr?: Buffer; stdout?: Buffer };
      const output = (e.stderr?.toString() ?? "") + (e.stdout?.toString() ?? "");
      json(res, 409, {
        error: "Merge conflict",
        output: output.slice(0, 2000),
      });
    }
    return true;
  }

  // POST /api/tasks/:id/request-changes
  const reqChangesMatch = parsedUrl.pathname.match(/^\/api\/tasks\/([^/]+)\/request-changes$/);
  if (method === "POST" && reqChangesMatch) {
    const id = reqChangesMatch[1];
    const body = await parseBody(req);
    const feedback = (body.feedback as string) || "";
    if (!feedback.trim()) {
      json(res, 400, { error: "feedback is required" });
      return true;
    }

    const board = readBoard();
    const task = board.tasks.find((t) => t.id === id);
    if (!task) {
      json(res, 404, { error: "Task not found" });
      return true;
    }

    task.column = "in-progress";
    task.updatedAt = new Date().toISOString();
    task.comments.push({
      id: generateId(),
      author: "Human Pilot",
      text: `[CHANGES_REQUESTED] ${feedback.trim()}`,
      timestamp: new Date().toISOString(),
    });
    writeBoardSync(board);
    json(res, 200, { ok: true });
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
      workerModel: (body.workerModel as string) || "sonnet",
      maxTurns: (body.maxTurns as number) || 1000,
      defaultBudget: (body.defaultBudget as TeamConfig["defaultBudget"]) || undefined,
      validation: (body.validation as TeamConfig["validation"]) || undefined,
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

  // GET /api/team/worker-logs — list available worker logs
  if (method === "GET" && parsedUrl.pathname === "/api/team/worker-logs") {
    const teamName = getActiveTeam();
    if (!teamName) {
      json(res, 200, { workers: [] });
      return true;
    }
    json(res, 200, { workers: listWorkerLogs(teamName) });
    return true;
  }

  // GET /api/team/worker-logs/:name — read a specific worker's log
  const workerLogMatch = parsedUrl.pathname.match(/^\/api\/team\/worker-logs\/([^/]+)$/);
  if (method === "GET" && workerLogMatch) {
    const teamName = getActiveTeam();
    if (!teamName) {
      json(res, 200, { content: "" });
      return true;
    }
    const workerName = decodeURIComponent(workerLogMatch[1]);
    const lines = parseInt(parsedUrl.searchParams.get("lines") || "200", 10);
    const content = readWorkerLogTail(teamName, workerName, Math.min(lines, 2000));
    json(res, 200, { content });
    return true;
  }

  // GET /api/team/logs
  if (method === "GET" && parsedUrl.pathname === "/api/team/logs") {
    const teamName = getActiveTeam();
    if (!teamName) {
      json(res, 200, { content: "" });
      return true;
    }
    const lines = parseInt(parsedUrl.searchParams.get("lines") || "200", 10);
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
