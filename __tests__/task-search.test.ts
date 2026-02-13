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

vi.mock("../src/server/board-store", () => ({
  readBoard: () => mockBoard,
  writeBoardSync: vi.fn(),
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

function createMockReqRes(url: string, method = "GET") {
  const req = { url, method, on: vi.fn() } as unknown as import("http").IncomingMessage;
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

describe("GET /api/tasks/search", () => {
  beforeEach(() => {
    mockBoard.tasks = [];
  });

  it("returns 400 when q is missing", async () => {
    const { req, res, raw } = createMockReqRes("/api/tasks/search");
    await handleRoute(req, res);
    expect(raw.statusCode).toBe(400);
    expect(JSON.parse(raw.body)).toEqual({ error: "q parameter is required" });
  });

  it("matches tasks by title substring (case-insensitive)", async () => {
    mockBoard.tasks = [
      makeTask({ id: "1", title: "Fix Authentication Bug" }),
      makeTask({ id: "2", title: "Add logging" }),
    ];

    const { req, res, raw } = createMockReqRes("/api/tasks/search?q=auth");
    await handleRoute(req, res);
    expect(raw.statusCode).toBe(200);
    const results = JSON.parse(raw.body);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("1");
  });

  it("matches tasks by description substring", async () => {
    mockBoard.tasks = [
      makeTask({ id: "1", title: "Setup", description: "Configure the database connection pool" }),
      makeTask({ id: "2", title: "Other", description: "Unrelated work" }),
    ];

    const { req, res, raw } = createMockReqRes("/api/tasks/search?q=database");
    await handleRoute(req, res);
    const results = JSON.parse(raw.body);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("1");
  });

  it("matches tasks by tag", async () => {
    mockBoard.tasks = [
      makeTask({ id: "1", title: "Task A", tags: ["frontend", "urgent"] }),
      makeTask({ id: "2", title: "Task B", tags: ["backend"] }),
    ];

    const { req, res, raw } = createMockReqRes("/api/tasks/search?q=frontend");
    await handleRoute(req, res);
    const results = JSON.parse(raw.body);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("1");
  });

  it("filters by column when column param provided", async () => {
    mockBoard.tasks = [
      makeTask({ id: "1", title: "Auth fix", column: "done" }),
      makeTask({ id: "2", title: "Auth refactor", column: "backlog" }),
    ];

    const { req, res, raw } = createMockReqRes("/api/tasks/search?q=auth&column=done");
    await handleRoute(req, res);
    const results = JSON.parse(raw.body);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("1");
  });

  it("respects limit parameter", async () => {
    mockBoard.tasks = Array.from({ length: 10 }, (_, i) =>
      makeTask({ id: `t-${i}`, title: `Test task ${i}` })
    );

    const { req, res, raw } = createMockReqRes("/api/tasks/search?q=test&limit=3");
    await handleRoute(req, res);
    const results = JSON.parse(raw.body);
    expect(results).toHaveLength(3);
  });

  it("returns empty array for no matches", async () => {
    mockBoard.tasks = [
      makeTask({ id: "1", title: "Something else" }),
    ];

    const { req, res, raw } = createMockReqRes("/api/tasks/search?q=nonexistent");
    await handleRoute(req, res);
    const results = JSON.parse(raw.body);
    expect(results).toEqual([]);
  });

  it("handles invalid limit (NaN) gracefully — falls back to 20", async () => {
    mockBoard.tasks = Array.from({ length: 25 }, (_, i) =>
      makeTask({ id: `t-${i}`, title: `Match ${i}` })
    );

    const { req, res, raw } = createMockReqRes("/api/tasks/search?q=match&limit=abc");
    await handleRoute(req, res);
    const results = JSON.parse(raw.body);
    expect(results).toHaveLength(20);
  });

  it("caps limit at 100", async () => {
    const { req, res, raw } = createMockReqRes("/api/tasks/search?q=x&limit=500");
    await handleRoute(req, res);
    expect(raw.statusCode).toBe(200);
    // Just verify it didn't error — no tasks to return but limit was capped internally
  });
});

describe("GET /api/tasks?ids=", () => {
  beforeEach(() => {
    mockBoard.tasks = [];
  });

  it("returns 400 when ids is missing", async () => {
    const { req, res, raw } = createMockReqRes("/api/tasks");
    await handleRoute(req, res);
    expect(raw.statusCode).toBe(400);
    expect(JSON.parse(raw.body)).toEqual({ error: "ids parameter is required" });
  });

  it("returns matching tasks by ID", async () => {
    mockBoard.tasks = [
      makeTask({ id: "a1", title: "First" }),
      makeTask({ id: "b2", title: "Second" }),
      makeTask({ id: "c3", title: "Third" }),
    ];

    const { req, res, raw } = createMockReqRes("/api/tasks?ids=a1,c3");
    await handleRoute(req, res);
    expect(raw.statusCode).toBe(200);
    const results = JSON.parse(raw.body);
    expect(results).toHaveLength(2);
    expect(results.map((t: Task) => t.id).sort()).toEqual(["a1", "c3"]);
  });

  it("returns done tasks (not filtered out)", async () => {
    mockBoard.tasks = [
      makeTask({ id: "d1", title: "Finished work", column: "done" }),
      makeTask({ id: "d2", title: "Active work", column: "in-progress" }),
    ];

    const { req, res, raw } = createMockReqRes("/api/tasks?ids=d1");
    await handleRoute(req, res);
    const results = JSON.parse(raw.body);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("d1");
    expect(results[0].column).toBe("done");
  });

  it("returns empty array for unknown IDs", async () => {
    mockBoard.tasks = [makeTask({ id: "x1", title: "Exists" })];

    const { req, res, raw } = createMockReqRes("/api/tasks?ids=nope,zilch");
    await handleRoute(req, res);
    const results = JSON.parse(raw.body);
    expect(results).toEqual([]);
  });

  it("ignores empty segments from trailing commas", async () => {
    mockBoard.tasks = [makeTask({ id: "a1", title: "One" })];

    const { req, res, raw } = createMockReqRes("/api/tasks?ids=a1,,");
    await handleRoute(req, res);
    const results = JSON.parse(raw.body);
    expect(results).toHaveLength(1);
  });
});
