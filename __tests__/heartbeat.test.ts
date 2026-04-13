import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Board, Task } from "../src/types/board";

// ---------------------------------------------------------------------------
// Mock board-store
// ---------------------------------------------------------------------------

const mockBoard: Board = {
  meta: { name: "test", createdAt: "2025-01-01T00:00:00Z", version: 1 },
  columns: [
    { id: "backlog", name: "Backlog" },
    { id: "ready", name: "Ready" },
    { id: "in-progress", name: "In Progress" },
    { id: "review", name: "Review" },
    { id: "done", name: "Done" },
  ],
  tasks: [],
};

const writeBoardSync = vi.fn();

vi.mock("../src/server/board-store", () => ({
  readBoard: () => mockBoard,
  writeBoardSync: (...args: unknown[]) => writeBoardSync(...args),
  setActiveTeam: vi.fn(),
  getActiveTeam: vi.fn(),
}));

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process");
  return { ...actual, execSync: vi.fn(), spawn: vi.fn() };
});

vi.mock("../src/server/team-manager", async () => {
  const actual = await vi.importActual<typeof import("../src/server/team-manager")>(
    "../src/server/team-manager"
  );
  return {
    ...actual,
    getTeamState: vi.fn(),
    startTeam: vi.fn(),
    stopTeam: vi.fn(),
    isTeamRunning: vi.fn(),
    listAvailableTeams: vi.fn(() => []),
    readLogTail: vi.fn(() => ""),
    listWorkerLogs: vi.fn(() => []),
    readWorkerLogTail: vi.fn(() => ""),
    spawnWorker: vi.fn(),
    killWorker: vi.fn(),
    listRunningWorkers: vi.fn(() => []),
  };
});

const { handleRoute } = await import("../src/server/routes");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task>): Task {
  const now = new Date().toISOString();
  return {
    id: overrides.id || "t-" + Math.random().toString(36).slice(2, 6),
    title: overrides.title || "Untitled",
    description: overrides.description || "",
    column: overrides.column || "in-progress",
    order: overrides.order ?? 0,
    priority: overrides.priority || "medium",
    type: overrides.type || "task",
    tags: overrides.tags || [],
    comments: overrides.comments || [],
    context: overrides.context || [],
    refs: overrides.refs || [],
    questions: overrides.questions || [],
    budget: overrides.budget,
    assignee: overrides.assignee,
    branch: overrides.branch,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  writeHead(status: number, headers: Record<string, string>): void;
  end(body: string): void;
}

function createMockReqRes(url: string, method = "GET", body?: Record<string, unknown>) {
  const bodyStr = body ? JSON.stringify(body) : "";
  const req = {
    url,
    method,
    on: vi.fn((event: string, cb: (chunk?: Buffer) => void) => {
      if (event === "data" && bodyStr) cb(Buffer.from(bodyStr));
      if (event === "end") cb();
    }),
  } as unknown as import("http").IncomingMessage;
  const res: MockResponse = {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(status: number, headers: Record<string, string>) {
      res.statusCode = status;
      res.headers = headers;
    },
    end(body: string) {
      res.body = body;
    },
  };
  return {
    req,
    res: res as unknown as import("http").ServerResponse,
    raw: res,
  };
}

// ---------------------------------------------------------------------------
// Tests: WorkerProcess.lastEventAt in team connect + task creation still work
// (ensuring the new field didn't break existing behavior)
// ---------------------------------------------------------------------------

describe("Heartbeat-related: existing routes still work", () => {
  beforeEach(() => {
    mockBoard.tasks = [];
    mockBoard.meta.team = undefined;
    writeBoardSync.mockReset();
  });

  it("POST /api/tasks still creates tasks with all fields", async () => {
    const { req, res, raw } = createMockReqRes("/api/tasks", "POST", {
      title: "Heartbeat task",
      budget: { turns: 30, wallClockMinutes: 15 },
    });
    await handleRoute(req, res);

    expect(raw.statusCode).toBe(201);
    const task = JSON.parse(raw.body);
    expect(task.title).toBe("Heartbeat task");
    expect(task.budget).toEqual({ turns: 30, wallClockMinutes: 15 });
  });

  it("GET /api/workers returns empty list", async () => {
    const { req, res, raw } = createMockReqRes("/api/workers", "GET");
    await handleRoute(req, res);

    expect(raw.statusCode).toBe(200);
    expect(JSON.parse(raw.body)).toEqual({ workers: [] });
  });
});
