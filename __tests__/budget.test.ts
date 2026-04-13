import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Board, Task, TeamConfig } from "../src/types/board";

// ---------------------------------------------------------------------------
// Mock board-store so we can control what readBoard() returns
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

vi.mock("../src/server/team-manager", async () => {
  // Re-export the real resolveBudget so we can test it directly,
  // but mock anything that touches process spawning or filesystem.
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
const { resolveBudget } = await import("../src/server/team-manager");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task>): Task {
  const now = new Date().toISOString();
  return {
    id: overrides.id || "t-" + Math.random().toString(36).slice(2, 6),
    title: overrides.title || "Untitled",
    description: overrides.description || "",
    column: overrides.column || "backlog",
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
  return { req, res: res as unknown as import("http").ServerResponse, raw: res };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveBudget precedence", () => {
  it("uses task budget when set", () => {
    const task = makeTask({ budget: { turns: 100, wallClockMinutes: 60 } });
    const config: TeamConfig = {
      teamName: "t",
      projectDir: "/x",
      defaultBudget: { turns: 200, wallClockMinutes: 120 },
    };
    const result = resolveBudget(task, config);
    expect(result.turns).toBe(100);
    expect(result.wallClockMinutes).toBe(60);
  });

  it("falls back to team default when task has no budget", () => {
    const task = makeTask({});
    const config: TeamConfig = {
      teamName: "t",
      projectDir: "/x",
      defaultBudget: { turns: 200, wallClockMinutes: 120 },
    };
    const result = resolveBudget(task, config);
    expect(result.turns).toBe(200);
    expect(result.wallClockMinutes).toBe(120);
  });

  it("falls back to hardcoded defaults when neither task nor team set", () => {
    const task = makeTask({});
    const config: TeamConfig = { teamName: "t", projectDir: "/x" };
    const result = resolveBudget(task, config);
    expect(result.turns).toBe(50);
    expect(result.wallClockMinutes).toBe(30);
  });

  it("partial task budget overrides individually", () => {
    const task = makeTask({ budget: { turns: 75 } });
    const config: TeamConfig = {
      teamName: "t",
      projectDir: "/x",
      defaultBudget: { turns: 200, wallClockMinutes: 120 },
    };
    const result = resolveBudget(task, config);
    expect(result.turns).toBe(75); // from task
    expect(result.wallClockMinutes).toBe(120); // from team default
  });

  it("returns hardcoded defaults when task and config are undefined", () => {
    const result = resolveBudget(undefined, undefined);
    expect(result.turns).toBe(50);
    expect(result.wallClockMinutes).toBe(30);
  });
});

describe("POST /api/tasks — budget persistence", () => {
  beforeEach(() => {
    mockBoard.tasks = [];
    writeBoardSync.mockClear();
  });

  it("creates a task with a budget", async () => {
    const { req, res, raw } = createMockReqRes("/api/tasks", "POST", {
      title: "Budget task",
      budget: { turns: 80, wallClockMinutes: 45 },
    });
    await handleRoute(req, res);

    expect(raw.statusCode).toBe(201);
    const task = JSON.parse(raw.body);
    expect(task.budget).toEqual({ turns: 80, wallClockMinutes: 45 });
    expect(mockBoard.tasks[0].budget).toEqual({ turns: 80, wallClockMinutes: 45 });
  });

  it("creates a task without a budget when none provided", async () => {
    const { req, res, raw } = createMockReqRes("/api/tasks", "POST", {
      title: "No budget task",
    });
    await handleRoute(req, res);

    expect(raw.statusCode).toBe(201);
    const task = JSON.parse(raw.body);
    expect(task.budget).toBeUndefined();
  });
});

describe("PATCH /api/tasks/:id — budget update", () => {
  beforeEach(() => {
    mockBoard.tasks = [];
    writeBoardSync.mockClear();
  });

  it("updates a task's budget via PATCH", async () => {
    mockBoard.tasks = [makeTask({ id: "t1", title: "Existing" })];

    const { req, res, raw } = createMockReqRes("/api/tasks/t1", "PATCH", {
      budget: { turns: 25, wallClockMinutes: 15 },
    });
    await handleRoute(req, res);

    expect(raw.statusCode).toBe(200);
    const task = JSON.parse(raw.body);
    expect(task.budget).toEqual({ turns: 25, wallClockMinutes: 15 });
    expect(mockBoard.tasks[0].budget).toEqual({ turns: 25, wallClockMinutes: 15 });
  });

  it("replaces the existing budget on PATCH", async () => {
    mockBoard.tasks = [
      makeTask({
        id: "t1",
        budget: { turns: 100, wallClockMinutes: 60 },
      }),
    ];

    const { req, res, raw } = createMockReqRes("/api/tasks/t1", "PATCH", {
      budget: { turns: 10, wallClockMinutes: 5 },
    });
    await handleRoute(req, res);

    expect(raw.statusCode).toBe(200);
    expect(mockBoard.tasks[0].budget).toEqual({ turns: 10, wallClockMinutes: 5 });
  });
});

describe("POST /api/team/connect — defaultBudget persistence", () => {
  beforeEach(() => {
    mockBoard.tasks = [];
    mockBoard.meta.team = undefined;
    writeBoardSync.mockClear();
  });

  it("persists defaultBudget on the team config", async () => {
    const { req, res, raw } = createMockReqRes("/api/team/connect", "POST", {
      teamName: "test-team",
      projectDir: "/tmp/test",
      defaultBudget: { turns: 200, wallClockMinutes: 90 },
    });
    await handleRoute(req, res);

    expect(raw.statusCode).toBe(200);
    expect(mockBoard.meta.team?.defaultBudget).toEqual({
      turns: 200,
      wallClockMinutes: 90,
    });
  });

  it("works without defaultBudget (omitted)", async () => {
    const { req, res, raw } = createMockReqRes("/api/team/connect", "POST", {
      teamName: "test-team",
      projectDir: "/tmp/test",
    });
    await handleRoute(req, res);

    expect(raw.statusCode).toBe(200);
    expect(mockBoard.meta.team?.defaultBudget).toBeUndefined();
  });
});
