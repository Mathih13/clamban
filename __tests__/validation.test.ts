import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Board, Task } from "../src/types/board";

// ---------------------------------------------------------------------------
// Mock board-store so we can control what readBoard() returns and capture writes
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

// ---------------------------------------------------------------------------
// Mock child_process so runValidationCommand doesn't actually run subprocesses
// ---------------------------------------------------------------------------

const execSyncMock = vi.fn();

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process");
  return {
    ...actual,
    execSync: (...args: Parameters<typeof actual.execSync>) => execSyncMock(...args),
    spawn: vi.fn(),
  };
});

// Import after mocks
const { handleRoute } = await import("../src/server/routes");
const { runTaskValidation, applyValidationResults } = await import("../src/server/team-manager");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task>): Task {
  const now = new Date().toISOString();
  return {
    id: overrides.id || "t-" + Math.random().toString(36).slice(2, 6),
    title: overrides.title || "Untitled",
    description: overrides.description || "",
    column: overrides.column || "review",
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

// A minimal log stream stand-in that captures writes for assertions
function makeLogStream() {
  const written: string[] = [];
  return {
    write: (s: string) => {
      written.push(s);
      return true;
    },
    end: vi.fn(),
    written,
  };
}

// ---------------------------------------------------------------------------
// runTaskValidation tests
// ---------------------------------------------------------------------------

describe("runTaskValidation", () => {
  beforeEach(() => {
    execSyncMock.mockReset();
  });

  it("returns null when validation is undefined", () => {
    const result = runTaskValidation(undefined, "/tmp/cwd");
    expect(result).toBeNull();
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("returns empty array when validation has no commands", () => {
    const result = runTaskValidation({}, "/tmp/cwd");
    expect(result).toEqual([]);
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("skips empty/whitespace-only command strings", () => {
    const result = runTaskValidation({ build: "  ", test: "" }, "/tmp/cwd");
    expect(result).toEqual([]);
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("runs all configured commands in order build → test → typecheck → lint", () => {
    execSyncMock.mockReturnValue(Buffer.from(""));
    const result = runTaskValidation(
      {
        build: "echo build",
        test: "echo test",
        typecheck: "echo typecheck",
        lint: "echo lint",
      },
      "/tmp/cwd"
    );
    expect(result).toHaveLength(4);
    expect(result![0].name).toBe("build");
    expect(result![1].name).toBe("test");
    expect(result![2].name).toBe("typecheck");
    expect(result![3].name).toBe("lint");
    expect(result!.every((r) => r.ok)).toBe(true);
    expect(execSyncMock).toHaveBeenCalledTimes(4);
  });

  it("aborts on first failure (later commands not run)", () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === "echo test") {
        const err = new Error("test failed") as Error & {
          status: number;
          stdout: Buffer;
          stderr: Buffer;
        };
        err.status = 1;
        err.stdout = Buffer.from("test stdout");
        err.stderr = Buffer.from("test stderr");
        throw err;
      }
      return Buffer.from("");
    });

    const result = runTaskValidation(
      {
        build: "echo build",
        test: "echo test",
        typecheck: "echo typecheck",
      },
      "/tmp/cwd"
    );
    expect(result).toHaveLength(2);
    expect(result![0].name).toBe("build");
    expect(result![0].ok).toBe(true);
    expect(result![1].name).toBe("test");
    expect(result![1].ok).toBe(false);
    expect(result![1].output).toContain("test stdout");
    expect(result![1].output).toContain("test stderr");
    expect(result![1].exitCode).toBe(1);
    // typecheck never ran
    expect(execSyncMock).toHaveBeenCalledTimes(2);
  });

  it("captures timeouts as failures with timedOut=true", () => {
    execSyncMock.mockImplementation(() => {
      const err = new Error("timed out") as Error & {
        status: null;
        signal: string;
        stdout: Buffer;
        stderr: Buffer;
      };
      err.status = null;
      err.signal = "SIGTERM";
      err.stdout = Buffer.from("");
      err.stderr = Buffer.from("");
      throw err;
    });

    const result = runTaskValidation({ build: "sleep 600" }, "/tmp/cwd");
    expect(result).toHaveLength(1);
    expect(result![0].ok).toBe(false);
    expect(result![0].timedOut).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyValidationResults tests
// ---------------------------------------------------------------------------

describe("applyValidationResults", () => {
  beforeEach(() => {
    mockBoard.tasks = [];
    writeBoardSync.mockReset();
  });

  it("posts [VALIDATION_PASSED] comment when all results pass and leaves column unchanged", () => {
    const task = makeTask({
      id: "t1",
      column: "review",
      assignee: "frontend-dev",
      branch: "worker/frontend-dev-abc",
    });
    mockBoard.tasks = [task];

    const logStream = makeLogStream();
    applyValidationResults(
      "t1",
      [
        {
          name: "build",
          command: "echo build",
          ok: true,
          durationMs: 1000,
          output: "",
          exitCode: 0,
          timedOut: false,
        },
        {
          name: "test",
          command: "echo test",
          ok: true,
          durationMs: 2000,
          output: "",
          exitCode: 0,
          timedOut: false,
        },
      ],
      logStream as unknown as import("fs").WriteStream
    );

    // Column unchanged, assignee preserved
    expect(mockBoard.tasks[0].column).toBe("review");
    expect(mockBoard.tasks[0].assignee).toBe("frontend-dev");
    expect(mockBoard.tasks[0].branch).toBe("worker/frontend-dev-abc");

    // Comment posted with PASSED marker
    expect(mockBoard.tasks[0].comments).toHaveLength(1);
    expect(mockBoard.tasks[0].comments[0].text).toContain("[VALIDATION_PASSED]");
    expect(mockBoard.tasks[0].comments[0].text).toContain("build");
    expect(mockBoard.tasks[0].comments[0].text).toContain("test");
    expect(mockBoard.tasks[0].comments[0].author).toBe("Team Lead");
  });

  it("posts [VALIDATION_FAILED] and reverts column to in-progress (preserving assignee/branch)", () => {
    const task = makeTask({
      id: "t1",
      column: "review",
      assignee: "frontend-dev",
      branch: "worker/frontend-dev-abc",
    });
    mockBoard.tasks = [task];

    const logStream = makeLogStream();
    applyValidationResults(
      "t1",
      [
        {
          name: "build",
          command: "echo build",
          ok: true,
          durationMs: 1000,
          output: "",
          exitCode: 0,
          timedOut: false,
        },
        {
          name: "test",
          command: "echo test",
          ok: false,
          durationMs: 5000,
          output: "FAIL: assertion failed in test/foo.test.ts",
          exitCode: 1,
          timedOut: false,
        },
      ],
      logStream as unknown as import("fs").WriteStream
    );

    // Column reverted to in-progress
    expect(mockBoard.tasks[0].column).toBe("in-progress");
    // Assignee and branch preserved (key requirement!)
    expect(mockBoard.tasks[0].assignee).toBe("frontend-dev");
    expect(mockBoard.tasks[0].branch).toBe("worker/frontend-dev-abc");

    // Comment posted with FAILED marker and the failure output
    expect(mockBoard.tasks[0].comments).toHaveLength(1);
    expect(mockBoard.tasks[0].comments[0].text).toContain("[VALIDATION_FAILED]");
    expect(mockBoard.tasks[0].comments[0].text).toContain("test failed");
    expect(mockBoard.tasks[0].comments[0].text).toContain(
      "FAIL: assertion failed in test/foo.test.ts"
    );
  });

  it("does nothing when results array is empty", () => {
    const task = makeTask({ id: "t1", column: "review" });
    mockBoard.tasks = [task];

    const logStream = makeLogStream();
    applyValidationResults("t1", [], logStream as unknown as import("fs").WriteStream);

    expect(mockBoard.tasks[0].column).toBe("review");
    expect(mockBoard.tasks[0].comments).toHaveLength(0);
    expect(writeBoardSync).not.toHaveBeenCalled();
  });

  it("includes timeout marker in failure comment when command timed out", () => {
    const task = makeTask({ id: "t1", column: "review" });
    mockBoard.tasks = [task];

    const logStream = makeLogStream();
    applyValidationResults(
      "t1",
      [
        {
          name: "build",
          command: "next build",
          ok: false,
          durationMs: 300_000,
          output: "",
          exitCode: null,
          timedOut: true,
        },
      ],
      logStream as unknown as import("fs").WriteStream
    );

    expect(mockBoard.tasks[0].comments[0].text).toContain("[VALIDATION_FAILED]");
    expect(mockBoard.tasks[0].comments[0].text).toContain("timed out");
  });
});

// ---------------------------------------------------------------------------
// Team connect — validation persistence
// ---------------------------------------------------------------------------

describe("POST /api/team/connect — validation persistence", () => {
  beforeEach(() => {
    mockBoard.tasks = [];
    mockBoard.meta.team = undefined;
    writeBoardSync.mockReset();
  });

  it("persists validation commands on the team config", async () => {
    const { req, res, raw } = createMockReqRes("/api/team/connect", "POST", {
      teamName: "test-team",
      projectDir: "/tmp/test",
      validation: {
        build: "bun run build",
        test: "bun test",
        typecheck: "bunx tsc --noEmit",
        lint: "bun run lint",
      },
    });
    await handleRoute(req, res);

    expect(raw.statusCode).toBe(200);
    expect(mockBoard.meta.team?.validation).toEqual({
      build: "bun run build",
      test: "bun test",
      typecheck: "bunx tsc --noEmit",
      lint: "bun run lint",
    });
  });

  it("persists partial validation (only some commands)", async () => {
    const { req, res, raw } = createMockReqRes("/api/team/connect", "POST", {
      teamName: "test-team",
      projectDir: "/tmp/test",
      validation: { build: "bun run build" },
    });
    await handleRoute(req, res);

    expect(raw.statusCode).toBe(200);
    expect(mockBoard.meta.team?.validation).toEqual({ build: "bun run build" });
  });

  it("persists no validation when omitted", async () => {
    const { req, res, raw } = createMockReqRes("/api/team/connect", "POST", {
      teamName: "test-team",
      projectDir: "/tmp/test",
    });
    await handleRoute(req, res);

    expect(raw.statusCode).toBe(200);
    expect(mockBoard.meta.team?.validation).toBeUndefined();
  });
});
