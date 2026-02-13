import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Board, Task } from "../src/types/board";

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

vi.mock("../src/server/team-manager", () => ({
  getTeamState: vi.fn(),
  startTeam: vi.fn(),
  stopTeam: vi.fn(),
  isTeamRunning: vi.fn(),
  listAvailableTeams: vi.fn(() => []),
  readLogTail: vi.fn(() => ""),
}));

// Import after mocks are set up
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
    column: overrides.column || "backlog",
    order: overrides.order || 0,
    priority: overrides.priority || "medium",
    type: overrides.type || "task",
    tags: overrides.tags || [],
    comments: overrides.comments || [],
    context: overrides.context || [],
    refs: overrides.refs || [],
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

describe("PATCH /api/tasks/:id — branch field", () => {
  beforeEach(() => {
    mockBoard.tasks = [];
    writeBoardSync.mockClear();
  });

  it("stores and returns branch when set via PATCH", async () => {
    mockBoard.tasks = [makeTask({ id: "t1", title: "Test task" })];

    const { req, res, raw } = createMockReqRes(
      "/api/tasks/t1",
      "PATCH",
      { branch: "feature/t1" }
    );
    await handleRoute(req, res);

    expect(raw.statusCode).toBe(200);
    const result = JSON.parse(raw.body);
    expect(result.branch).toBe("feature/t1");
    expect(writeBoardSync).toHaveBeenCalled();
  });

  it("preserves branch when updating other fields", async () => {
    mockBoard.tasks = [makeTask({ id: "t2", title: "Test", branch: "bug/t2" })];

    const { req, res, raw } = createMockReqRes(
      "/api/tasks/t2",
      "PATCH",
      { title: "Updated title" }
    );
    await handleRoute(req, res);

    expect(raw.statusCode).toBe(200);
    const result = JSON.parse(raw.body);
    expect(result.branch).toBe("bug/t2");
    expect(result.title).toBe("Updated title");
  });

  it("includes branch in GET /api/tasks?ids= response", async () => {
    mockBoard.tasks = [
      makeTask({ id: "t3", title: "With branch", branch: "chore/t3" }),
    ];

    const { req, res, raw } = createMockReqRes("/api/tasks?ids=t3");
    await handleRoute(req, res);

    expect(raw.statusCode).toBe(200);
    const results = JSON.parse(raw.body);
    expect(results).toHaveLength(1);
    expect(results[0].branch).toBe("chore/t3");
  });

  it("does not set branch by default on POST /api/tasks", async () => {
    const { req, res, raw } = createMockReqRes(
      "/api/tasks",
      "POST",
      { title: "New task", description: "No branch" }
    );
    await handleRoute(req, res);

    expect(raw.statusCode).toBe(201);
    const result = JSON.parse(raw.body);
    expect(result.branch).toBeUndefined();
  });
});
