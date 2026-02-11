import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import type { TeamState, TeamMember } from "../types/team.ts";
import type { TeamConfig } from "../types/board.ts";
import { readBoard } from "./board-store.ts";

const HOME = process.env.HOME || process.env.USERPROFILE || "~";
const CLAMBAN_DIR = path.join(HOME, ".clamban");
const LOGS_DIR = path.join(CLAMBAN_DIR, "logs");
const STATE_DIR = path.join(CLAMBAN_DIR, "state");
const CLAUDE_TEAMS_DIR = path.join(HOME, ".claude", "teams");

function getStatePath(teamName: string): string {
  return path.join(STATE_DIR, `${teamName}.json`);
}

function getLogFilePath(teamName: string): string {
  return path.join(LOGS_DIR, `${teamName}.log`);
}

// --- Event-driven state machine ---
// STOPPED: teamActive=false, no process, ignore board events
// IDLE:    teamActive=true, no process, listening for board changes
// RUNNING: teamActive=true, process active
let leadProcess: ChildProcess | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let teamActive = false;
let pendingBoardChange = false;
let lastSpawnTime = 0;
let totalTurnsUsed = 0;
let currentConfig: TeamConfig | null = null;
let currentPort = 0;
let currentOnExit: (() => void) | undefined;

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = just check existence
    return true;
  } catch {
    return false;
  }
}

function getPersistedPid(teamName: string): number | undefined {
  const state = readPersistedState(teamName);
  return state.leadPid as number | undefined;
}

/** Team is active if teamActive flag is set, or a process is still alive after HMR */
function checkRunning(teamName: string): boolean {
  if (teamActive) return true;
  // Fallback for HMR: check persisted PID
  const pid = getPersistedPid(teamName);
  return pid !== undefined && isPidAlive(pid);
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readPersistedState(teamName: string): Partial<TeamState> {
  try {
    const statePath = getStatePath(teamName);
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, "utf-8"));
    }
  } catch {}
  return {};
}

function persistState(teamName: string, state: Partial<TeamState>) {
  ensureDir(STATE_DIR);
  fs.writeFileSync(getStatePath(teamName), JSON.stringify(state, null, 2), "utf-8");
}

function readTeamConfig(teamName: string): { members: Array<{ name: string; agentId: string; agentType: string }> } | null {
  const configPath = path.join(CLAUDE_TEAMS_DIR, teamName, "config.json");
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch {}
  return null;
}

export function getTeamState(teamName: string): TeamState {
  const persisted = readPersistedState(teamName);
  const board = readBoard();
  const running = checkRunning(teamName);

  // Derive workers from board task assignees — this reflects who the lead
  // has actually spawned, not static config entries
  const workerMap = new Map<string, TeamMember>();

  for (const task of board.tasks) {
    if (!task.assignee) continue;
    const name = task.assignee;
    const isActive = task.column === "in-progress" || task.column === "review";

    if (!workerMap.has(name)) {
      workerMap.set(name, {
        name,
        agentId: "",
        agentType: "worker",
        model: "sonnet",
        status: isActive && running ? "busy" : running ? "idle" : "offline",
        currentTask: isActive ? task.id : undefined,
        joinedAt: Date.now(),
      });
    } else if (isActive) {
      // Upgrade to busy if this worker has an active task
      const member = workerMap.get(name)!;
      member.status = running ? "busy" : "offline";
      member.currentTask = task.id;
    }
  }

  const members = Array.from(workerMap.values());

  return {
    name: teamName,
    leadPid: persisted.leadPid,
    members,
    startedAt: persisted.startedAt,
    stoppedAt: running ? undefined : persisted.stoppedAt,
    running,
  };
}

export function buildLeadPrompt(teamName: string, projectDir: string, port: number): string {
  // Merge members from team config + board assignees
  const teamConfig = readTeamConfig(teamName);
  const configNames = new Set(teamConfig?.members?.map((m) => m.name).filter((n) => n !== "team-lead") ?? []);
  const board = readBoard();
  for (const task of board.tasks) {
    if (task.assignee) configNames.add(task.assignee);
  }
  const memberNames = Array.from(configNames);
  const memberList = memberNames.length > 0
    ? memberNames.map((n) => `  - "${n}"`).join("\n")
    : '  (no members yet — spawn workers via the Task tool and name them)';

  return `You are the team lead for team "${teamName}". You manage a kanban board via HTTP API at http://localhost:${port}.

Your job is to process the board and manage tasks through their lifecycle. You work autonomously.

## Team Members
These are the workers on your team. ALWAYS assign tasks to one of these names:
${memberList}

Do NOT invent new worker names. Use the exact names listed above when setting the "assignee" field and when spawning workers via the Task tool (use the member name as the Task "name" parameter).

## API Reference

Fetch board:
  curl -s 'http://localhost:${port}/api/board?excludeDone=true'

Move task from backlog to ready:
  curl -s -X PATCH http://localhost:${port}/api/tasks/TASK_ID -H 'Content-Type: application/json' -d '{"column":"ready"}'

Move task to in-progress AND set assignee (ALWAYS include BOTH fields together):
  curl -s -X PATCH http://localhost:${port}/api/tasks/TASK_ID -H 'Content-Type: application/json' -d '{"column":"in-progress","assignee":"${memberNames[0] || "worker-1"}"}'

Move task to review:
  curl -s -X PATCH http://localhost:${port}/api/tasks/TASK_ID -H 'Content-Type: application/json' -d '{"column":"review"}'

Move task to done:
  curl -s -X PATCH http://localhost:${port}/api/tasks/TASK_ID -H 'Content-Type: application/json' -d '{"column":"done"}'

Add comment:
  curl -s -X POST http://localhost:${port}/api/tasks/TASK_ID/comments -H 'Content-Type: application/json' -d '{"author":"Team Lead","text":"Your comment here"}'

Create a new task (returns the created task with its ID):
  curl -s -X POST http://localhost:${port}/api/tasks -H 'Content-Type: application/json' -d '{"title":"Task title","description":"Details...","column":"backlog","priority":"medium","type":"task","tags":[]}'

Link two tasks (type: "related", "blocks", "blocked-by", "parent", "child"):
  curl -s -X POST http://localhost:${port}/api/tasks/TASK_ID/refs -H 'Content-Type: application/json' -d '{"taskId":"OTHER_TASK_ID","type":"related"}'

## Task Lifecycle

When you notice tasks that are related (e.g. similar area of code, one depends on another, or a bug was discovered while working on a feature), link them using the refs API. This helps future teams understand relationships between work items.

### Ready column — Pick up and assign
For each task with column "ready", sorted by priority (critical > high > medium > low):
1. Pick the most suitable team member from the list above (or the least busy one)
2. IMMEDIATELY update the board: PATCH with BOTH column="in-progress" AND assignee="{member-name}" in the SAME request
3. Add a comment: "Assigned to {member-name}"
4. THEN send work to that member via the Task tool (use their name as the "name" parameter)

CRITICAL: The PATCH to move a task to in-progress MUST always include the "assignee" field. Never PATCH column without also setting assignee. Use ONLY names from the Team Members list above.

### In Progress column — Monitor workers
Monitor your spawned workers. When a worker reports back with results:
1. Add a comment with the worker's summary of changes
2. PATCH column to "review"

### Review column — Approve or reject
Review completed work:
1. If the work looks good: PATCH column to "done", add approval comment
2. If changes needed: PATCH column back to "in-progress", add feedback comment, re-assign

### Backlog column — Triage & Promote
For each backlog task, sorted by priority (critical > high > medium > low):
1. Read the task title, description, and priority
2. Add a triage comment with your assessment: estimated effort, importance, any questions
3. Do NOT promote in the same cycle — just triage. The triage comment will trigger a board change, which will re-invoke you automatically.
4. On a SUBSEQUENT cycle, if the task warrants work based on its priority and your assessment, promote it:
   - PATCH column to "ready"
   - Add a comment: "Promoting to ready — {brief reason}"

Guidelines for promoting:
- Critical/high priority: promote on the next cycle after triage
- Medium priority: promote when no critical/high tasks are pending
- Low priority: only promote when the board is otherwise clear

### Done column
No action needed.

### Creating new tasks
You may create new tasks when appropriate. Use the POST /api/tasks endpoint. Always set a clear title, description, priority, and type. Place new tasks in "backlog" so they go through normal triage.

Create tasks when:
- A worker discovers a bug or follow-up issue while working on something else
- You identify a prerequisite that must be done before an existing task can proceed (link it with "blocked-by")
- A task turns out to be too large and should be split into smaller subtasks (link with "parent"/"child")
- You notice something in the codebase that needs attention (tech debt, missing tests, etc.)

Always link new tasks to the related existing task using the refs API. Set the priority based on urgency:
- "critical" — blocks other work or is a production issue
- "high" — important follow-up that should be done soon
- "medium" — standard work
- "low" — nice-to-have, tech debt, cleanup

## Single Cycle
1. Fetch the board: curl -s 'http://localhost:${port}/api/board?excludeDone=true'
2. Process each column as described above
3. After all actions, you are DONE — exit normally
4. Do NOT loop or wait. Process the board once and stop.
5. You will be re-invoked automatically when the board changes.

## Worker Spawning
When spawning workers via the Task tool:
- Use subagent_type "general-purpose"
- Set the working directory context to: ${projectDir}
- Give them the task title, description, and file context from the board task
- IMPORTANT: Include these instructions in every worker prompt so they can update the board directly:
  ## Board Interaction
  Post progress comments to the board using: curl -s -X POST http://localhost:${port}/api/tasks/TASK_ID/comments -H 'Content-Type: application/json' -d '{\"author\":\"YOUR_NAME\",\"text\":\"Your update here\"}'
  Post a comment when you start work, when you hit blockers, and when you finish with a summary of changes made.

  ## File Context
  When you create or modify important files (especially docs, configs, markdown, or new source files), attach them to the task:
  curl -s -X POST http://localhost:${port}/api/tasks/TASK_ID/context -H 'Content-Type: application/json' -d '{\"path\":\"relative/path/to/file.md\",\"note\":\"Brief description of this file\"}'

  ## Creating New Tasks
  This is important: do NOT try to do everything in one session. If this task is too large, if you discover a bug, or if there is follow-up work, create a new task on the board and link it. This is how the team learns and tracks work — always leave breadcrumbs.
  Create a task: curl -s -X POST http://localhost:${port}/api/tasks -H 'Content-Type: application/json' -d '{\"title\":\"Bug title\",\"description\":\"Details\",\"column\":\"backlog\",\"priority\":\"medium\",\"type\":\"bug\",\"tags\":[]}'
  Link it to the current task: curl -s -X POST http://localhost:${port}/api/tasks/NEW_TASK_ID/refs -H 'Content-Type: application/json' -d '{\"taskId\":\"TASK_ID\",\"type\":\"related\"}'
  "
- Replace TASK_ID and YOUR_NAME with the actual task ID and worker name in the prompt you give them

## Important Rules
- Always use curl for board mutations (not file writes)
- ALWAYS set assignee when moving to in-progress — never omit it
- Use author "Team Lead" for comments
- Be concise in comments
- Process highest priority tasks first
- You can spawn multiple workers in parallel for independent tasks
- Proactively create new tasks when you notice follow-up work, bugs, or improvements — don't let knowledge get lost

Start by fetching the board now.`;
}

function formatStreamEvent(event: Record<string, unknown>): string | null {
  const type = event.type as string | undefined;

  // system init — log session start
  if (type === "system" && event.subtype === "init") {
    return `[session ${(event.session_id as string || "").slice(0, 8)}] model=${event.model}`;
  }

  // assistant message — extract text and tool calls
  if (type === "assistant" && event.message) {
    const msg = event.message as Record<string, unknown>;
    const content = msg.content as Array<Record<string, unknown>> | undefined;
    if (!content) return null;
    const parts: string[] = [];
    for (const block of content) {
      if (block.type === "text" && block.text) {
        parts.push(block.text as string);
      } else if (block.type === "tool_use") {
        const input = block.input as Record<string, unknown> | undefined;
        const summary = input?.command || input?.pattern || input?.description || "";
        parts.push(`[tool: ${block.name}${summary ? ` — ${String(summary).slice(0, 80)}` : ""}]`);
      }
    }
    return parts.length > 0 ? parts.join("\n") : null;
  }

  // final result
  if (type === "result") {
    const subtype = event.subtype as string | undefined;
    const result = event.result as string | undefined;
    const cost = event.total_cost_usd as number | undefined;
    const turns = event.num_turns as number | undefined;
    const lines: string[] = [];
    if (result) lines.push(`\n[Result] ${result.slice(0, 500)}`);
    if (subtype === "error_max_turns") lines.push("[Reached max turns]");
    if (cost !== undefined || turns !== undefined) {
      lines.push(`[Done] turns=${turns ?? "?"} cost=$${cost?.toFixed(2) ?? "?"}`);
    }
    return lines.join("\n") || null;
  }

  return null;
}

function spawnCycle(): void {
  if (!currentConfig) return;

  const config = currentConfig;
  const port = currentPort;
  const maxTurns = config.maxTurns || 1000;
  const remainingBudget = maxTurns - totalTurnsUsed;

  if (remainingBudget <= 0) {
    console.log(`[clamban] Turn budget exhausted (${totalTurnsUsed}/${maxTurns}), auto-stopping team`);
    teamActive = false;
    persistState(config.teamName, { leadPid: undefined, stoppedAt: new Date().toISOString() });
    currentOnExit?.();
    return;
  }

  const model = config.model || "sonnet";
  const cycleTurns = Math.min(50, remainingBudget);
  const prompt = buildLeadPrompt(config.teamName, config.projectDir, port);

  ensureDir(LOGS_DIR);
  const logPath = getLogFilePath(config.teamName);
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  logStream.write(`\n--- Cycle started at ${new Date().toISOString()} (turns used: ${totalTurnsUsed}/${maxTurns}, budget: ${cycleTurns}) ---\n`);

  lastSpawnTime = Date.now();
  pendingBoardChange = false;

  leadProcess = spawn(
    "claude",
    [
      "-p",
      "--dangerously-skip-permissions",
      "--model", model,
      "--max-turns", String(cycleTurns),
      "--output-format", "stream-json",
      "--verbose",
    ],
    {
      cwd: config.projectDir,
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    }
  );

  // Feed prompt via stdin to avoid argv length limits
  if (leadProcess.stdin) {
    leadProcess.stdin.write(prompt);
    leadProcess.stdin.end();
  }

  // Parse stream-json output into readable log lines
  if (leadProcess.stdout) {
    let buffer = "";
    leadProcess.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          // Accumulate turns from result events
          if (event.type === "result" && typeof event.num_turns === "number") {
            totalTurnsUsed += event.num_turns;
          }
          const logLine = formatStreamEvent(event);
          if (logLine) {
            logStream.write(logLine + "\n");
          }
        } catch {
          // Not valid JSON, write raw
          logStream.write(line + "\n");
        }
      }
    });
  }
  if (leadProcess.stderr) {
    leadProcess.stderr.pipe(logStream);
  }

  const pid = leadProcess.pid!;
  const teamName = config.teamName;

  persistState(teamName, {
    leadPid: pid,
    startedAt: new Date().toISOString(),
    stoppedAt: undefined,
  });

  leadProcess.on("exit", (code) => {
    logStream.write(`\n--- Cycle exited with code ${code} at ${new Date().toISOString()} (total turns: ${totalTurnsUsed}) ---\n`);
    logStream.end();
    leadProcess = null;

    persistState(teamName, {
      leadPid: undefined,
      stoppedAt: undefined,
    });

    // Team was stopped while process was running
    if (!teamActive) {
      persistState(teamName, { stoppedAt: new Date().toISOString() });
      currentOnExit?.();
      return;
    }

    // Crash guard: process exited < 5s after spawn
    const elapsed = Date.now() - lastSpawnTime;
    if (elapsed < 5000) {
      logStream.write?.(""); // no-op, stream already ended
      console.warn(`[clamban] Cycle exited in ${elapsed}ms (< 5s), not respawning — possible crash`);
      currentOnExit?.();
      return;
    }

    // Turn budget exhausted
    const maxT = config.maxTurns || 1000;
    if (totalTurnsUsed >= maxT) {
      console.log(`[clamban] Turn budget exhausted (${totalTurnsUsed}/${maxT}), auto-stopping team`);
      teamActive = false;
      persistState(teamName, { stoppedAt: new Date().toISOString() });
      currentOnExit?.();
      return;
    }

    // Board changed while we were running — respawn after short debounce
    if (pendingBoardChange) {
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        spawnCycle();
      }, 1000);
      currentOnExit?.();
      return;
    }

    // Nothing pending — go idle, wait for next board-change event
    currentOnExit?.();
  });
}

export function startTeam(
  config: TeamConfig,
  port: number,
  onExit?: () => void
): { pid: number } {
  if (checkRunning(config.teamName)) {
    throw new Error("Team is already running");
  }

  // Reset state for fresh start
  teamActive = true;
  totalTurnsUsed = 0;
  pendingBoardChange = false;
  currentConfig = config;
  currentPort = port;
  currentOnExit = onExit;

  // Truncate log on fresh start
  ensureDir(LOGS_DIR);
  fs.writeFileSync(getLogFilePath(config.teamName), "");

  // Spawn first cycle immediately
  spawnCycle();

  return { pid: leadProcess?.pid ?? 0 };
}

export function stopTeam(teamName: string): void {
  teamActive = false;
  pendingBoardChange = false;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (leadProcess && !leadProcess.killed) {
    leadProcess.kill("SIGTERM");
    setTimeout(() => {
      if (leadProcess && !leadProcess.killed) {
        leadProcess.kill("SIGKILL");
      }
    }, 5000);
  } else {
    // No in-memory ref (e.g. after HMR) — kill via persisted PID
    const pid = getPersistedPid(teamName);
    if (pid && isPidAlive(pid)) {
      try {
        process.kill(pid, "SIGTERM");
        setTimeout(() => {
          if (isPidAlive(pid)) {
            try { process.kill(pid, "SIGKILL"); } catch {}
          }
        }, 5000);
      } catch {}
    }
  }

  leadProcess = null;
  currentConfig = null;
  persistState(teamName, {
    leadPid: undefined,
    stoppedAt: new Date().toISOString(),
  });
}

export function isTeamRunning(teamName: string): boolean {
  return checkRunning(teamName);
}

/** Called when board.json changes — triggers a new cycle if team is active */
export function notifyBoardChanged(): void {
  if (!teamActive) return;

  // Process is running — flag it so we respawn after exit
  if (leadProcess && !leadProcess.killed) {
    pendingBoardChange = true;
    return;
  }

  // Idle — debounce 3s then spawn a new cycle
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (teamActive && !leadProcess) {
      spawnCycle();
    }
  }, 3000);
}

export function listAvailableTeams(): string[] {
  try {
    if (!fs.existsSync(CLAUDE_TEAMS_DIR)) return [];
    return fs.readdirSync(CLAUDE_TEAMS_DIR).filter((entry) => {
      const configPath = path.join(CLAUDE_TEAMS_DIR, entry, "config.json");
      return fs.existsSync(configPath);
    });
  } catch {
    return [];
  }
}

export function getTeamConfigDir(teamName: string): string {
  return path.join(CLAUDE_TEAMS_DIR, teamName);
}

export function getTeamInboxDir(teamName: string): string {
  return path.join(CLAUDE_TEAMS_DIR, teamName, "inboxes");
}

export function readLogTail(teamName: string, lines: number = 200): string {
  try {
    const logPath = getLogFilePath(teamName);
    if (!fs.existsSync(logPath)) return "";
    const content = fs.readFileSync(logPath, "utf-8");
    const allLines = content.split("\n");
    return allLines.slice(-lines).join("\n");
  } catch {
    return "";
  }
}
