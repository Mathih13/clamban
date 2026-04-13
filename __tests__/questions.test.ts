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

vi.mock("../src/server/team-manager", () => ({
  getTeamState: vi.fn(),
  startTeam: vi.fn(),
  stopTeam: vi.fn(),
  isTeamRunning: vi.fn(),
  listAvailableTeams: vi.fn(() => []),
  readLogTail: vi.fn(() => ""),
  listWorkerLogs: vi.fn(() => []),
  readWorkerLogTail: vi.fn(() => ""),
}));

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
    order: overrides.order || 0,
    priority: overrides.priority || "medium",
    type: overrides.type || "task",
    tags: overrides.tags || [],
    comments: overrides.comments || [],
    context: overrides.context || [],
    refs: overrides.refs || [],
    questions: overrides.questions || [],
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

describe("Question API endpoints", () => {
  beforeEach(() => {
    mockBoard.tasks = [];
    writeBoardSync.mockClear();
  });

  describe("POST /api/tasks/:id/questions", () => {
    it("creates a question on a task", async () => {
      mockBoard.tasks = [makeTask({ id: "t1", title: "Test task" })];

      const { req, res, raw } = createMockReqRes("/api/tasks/t1/questions", "POST", {
        author: "worker-1",
        text: "What database should we use?",
      });
      await handleRoute(req, res);

      expect(raw.statusCode).toBe(201);
      const question = JSON.parse(raw.body);
      expect(question.author).toBe("worker-1");
      expect(question.text).toBe("What database should we use?");
      expect(question.id).toBeTruthy();
      expect(question.askedAt).toBeTruthy();
      expect(question.answer).toBeUndefined();

      expect(mockBoard.tasks[0].questions).toHaveLength(1);
      expect(writeBoardSync).toHaveBeenCalled();
    });

    it("creates a question with details (plan content)", async () => {
      mockBoard.tasks = [makeTask({ id: "t1" })];

      const planContent = "Goal: Build feature X\nApproach: ...\nFiles:\n- a.ts\n- b.ts";
      const { req, res, raw } = createMockReqRes("/api/tasks/t1/questions", "POST", {
        author: "planner-1",
        text: "Approve this plan?",
        details: planContent,
        options: [
          { label: "Approve", description: "Looks good" },
          { label: "Reject", description: "Needs changes" },
        ],
      });
      await handleRoute(req, res);

      expect(raw.statusCode).toBe(201);
      const question = JSON.parse(raw.body);
      expect(question.details).toBe(planContent);
      expect(question.text).toBe("Approve this plan?");
      expect(question.options).toHaveLength(2);

      // Verify it's persisted on the task
      expect(mockBoard.tasks[0].questions).toHaveLength(1);
      expect(mockBoard.tasks[0].questions[0].details).toBe(planContent);
    });

    it("creates a question with options", async () => {
      mockBoard.tasks = [makeTask({ id: "t1" })];

      const { req, res, raw } = createMockReqRes("/api/tasks/t1/questions", "POST", {
        author: "worker-1",
        text: "Which approach?",
        options: [
          { label: "REST", description: "Simple and familiar" },
          { label: "GraphQL", description: "More flexible" },
        ],
        multiSelect: false,
      });
      await handleRoute(req, res);

      expect(raw.statusCode).toBe(201);
      const question = JSON.parse(raw.body);
      expect(question.options).toHaveLength(2);
      expect(question.options[0].label).toBe("REST");
      expect(question.multiSelect).toBeUndefined(); // false becomes undefined
    });

    it("returns 404 for missing task", async () => {
      const { req, res, raw } = createMockReqRes("/api/tasks/nonexistent/questions", "POST", {
        author: "worker-1",
        text: "Hello?",
      });
      await handleRoute(req, res);

      expect(raw.statusCode).toBe(404);
    });
  });

  describe("PATCH /api/tasks/:id/questions/:questionId", () => {
    it("answers a question", async () => {
      const task = makeTask({
        id: "t1",
        questions: [
          {
            id: "q1",
            author: "worker-1",
            text: "Which DB?",
            askedAt: new Date().toISOString(),
          },
        ],
      });
      mockBoard.tasks = [task];

      const { req, res, raw } = createMockReqRes("/api/tasks/t1/questions/q1", "PATCH", {
        answer: "PostgreSQL",
      });
      await handleRoute(req, res);

      expect(raw.statusCode).toBe(200);
      const question = JSON.parse(raw.body);
      expect(question.answer).toBe("PostgreSQL");
      expect(question.answeredAt).toBeTruthy();
      expect(writeBoardSync).toHaveBeenCalled();
    });

    it("returns 404 for missing question", async () => {
      mockBoard.tasks = [makeTask({ id: "t1" })];

      const { req, res, raw } = createMockReqRes("/api/tasks/t1/questions/nonexistent", "PATCH", {
        answer: "test",
      });
      await handleRoute(req, res);

      expect(raw.statusCode).toBe(404);
    });
  });

  describe("GET /api/tasks/:id/questions/:questionId", () => {
    it("returns a single question", async () => {
      const task = makeTask({
        id: "t1",
        questions: [
          {
            id: "q1",
            author: "worker-1",
            text: "Which DB?",
            askedAt: new Date().toISOString(),
          },
        ],
      });
      mockBoard.tasks = [task];

      const { req, res, raw } = createMockReqRes("/api/tasks/t1/questions/q1", "GET");
      await handleRoute(req, res);

      expect(raw.statusCode).toBe(200);
      const question = JSON.parse(raw.body);
      expect(question.id).toBe("q1");
      expect(question.text).toBe("Which DB?");
    });
  });

  describe("GET /api/questions/pending", () => {
    it("returns unanswered questions across tasks", async () => {
      mockBoard.tasks = [
        makeTask({
          id: "t1",
          title: "Task 1",
          questions: [
            {
              id: "q1",
              author: "worker-1",
              text: "Unanswered",
              askedAt: new Date().toISOString(),
            },
            {
              id: "q2",
              author: "worker-1",
              text: "Already answered",
              answer: "Yes",
              askedAt: new Date().toISOString(),
              answeredAt: new Date().toISOString(),
            },
          ],
        }),
        makeTask({
          id: "t2",
          title: "Task 2",
          questions: [
            {
              id: "q3",
              author: "worker-2",
              text: "Also unanswered",
              askedAt: new Date().toISOString(),
            },
          ],
        }),
        makeTask({ id: "t3", title: "No questions" }),
      ];

      const { req, res, raw } = createMockReqRes("/api/questions/pending", "GET");
      await handleRoute(req, res);

      expect(raw.statusCode).toBe(200);
      const pending = JSON.parse(raw.body);
      expect(pending).toHaveLength(2);
      expect(pending[0].taskId).toBe("t1");
      expect(pending[0].taskTitle).toBe("Task 1");
      expect(pending[0].question.id).toBe("q1");
      expect(pending[1].taskId).toBe("t2");
      expect(pending[1].question.id).toBe("q3");
    });

    it("returns empty array when no pending questions", async () => {
      mockBoard.tasks = [makeTask({ id: "t1" })];

      const { req, res, raw } = createMockReqRes("/api/questions/pending", "GET");
      await handleRoute(req, res);

      expect(raw.statusCode).toBe(200);
      expect(JSON.parse(raw.body)).toEqual([]);
    });
  });

  describe("POST /api/tasks — new tasks include questions array", () => {
    it("creates a task with empty questions array", async () => {
      const { req, res, raw } = createMockReqRes("/api/tasks", "POST", {
        title: "New task",
        description: "Test",
      });
      await handleRoute(req, res);

      expect(raw.statusCode).toBe(201);
      const task = JSON.parse(raw.body);
      expect(task.questions).toEqual([]);
    });
  });
});
