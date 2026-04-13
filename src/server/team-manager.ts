import { spawn, execSync, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import type { TeamState, TeamMember, WorkerProcess } from "../types/team.ts";
import type { Task, TeamConfig, Validation } from "../types/board.ts";
import { readBoard, writeBoardSync } from "./board-store.ts";
import { createTurnGovernor, type TurnGovernor } from "./turn-governor.ts";

// --- Budget defaults ---
const HARDCODED_TURN_BUDGET = 50;
const HARDCODED_WALL_CLOCK_MINUTES = 30;
const BUDGET_CHECK_INTERVAL_MS = 15_000;

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
let turnGovernor: TurnGovernor | null = null;

// Worker process registry: key is worker name, value is the running worker
const workerProcesses = new Map<string, ChildProcess>();
const workerInfo = new Map<string, WorkerProcess>();

// Per-worker budget state: tracks turns used and wall-clock deadline for each
// running worker. A worker is killed and its task returned to "ready" when
// either limit is exceeded.
interface WorkerBudgetState {
  turnsAllocated: number;
  turnsUsed: number;
  deadline: number; // epoch ms
  taskId: string;
  mode: WorkerMode;
}
const workerBudgets = new Map<string, WorkerBudgetState>();
let budgetCheckInterval: ReturnType<typeof setInterval> | null = null;

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

function readTeamConfig(
  teamName: string
): { members: Array<{ name: string; agentId: string; agentType: string }> } | null {
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
        model: board.meta.team?.workerModel || "sonnet",
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

export function buildLeadPrompt(teamName: string, port: number): string {
  // Merge members from team config + board assignees
  const teamConfig = readTeamConfig(teamName);
  const configNames = new Set(
    teamConfig?.members?.map((m) => m.name).filter((n) => n !== "team-lead") ?? []
  );
  const board = readBoard();
  for (const task of board.tasks) {
    if (task.assignee) configNames.add(task.assignee);
  }
  const memberNames = Array.from(configNames);
  const memberList =
    memberNames.length > 0
      ? memberNames.map((n) => `  - "${n}"`).join("\n")
      : "  (no members yet — spawn workers via the Task tool and name them)";

  return `You are the team lead. You manage a kanban board via HTTP API and process tasks through their lifecycle autonomously.

## API Reference
Base URL for all endpoints: http://localhost:${port}. All mutations use -H 'Content-Type: application/json'.

Board summary (use this for your initial scan — lightweight, no descriptions/comments):
  curl -s /api/board/summary
Returns: tasks[] with {id, title, column, priority, type, tags, assignee, branch, commentCount, hasUnansweredQuestions, hasPlan, hasValidationPassed, hasValidationFailed}

Full task details (fetch only the tasks you need to act on):
  curl -s '/api/tasks?ids=ID1,ID2'

PATCH task: curl -s -X PATCH /api/tasks/ID -d '{"column":"ready"}' — updatable fields: column, assignee, priority, type, tags, branch, budget
POST comment: curl -s -X POST /api/tasks/ID/comments -d '{"author":"Team Lead","text":"..."}'
POST task: curl -s -X POST /api/tasks -d '{"title":"...","description":"...","column":"backlog","priority":"medium","type":"task","tags":[]}'
POST ref: curl -s -X POST /api/tasks/ID/refs -d '{"taskId":"OTHER_ID","type":"related"}' — types: related, blocks, blocked-by, parent, child
Search done: curl -s '/api/tasks/search?q=KEYWORD&column=done&limit=5'
Spawn worker: curl -s -X POST /api/workers/spawn -d '{"name":"...","taskId":"...","mode":"plan|build"}'
List workers: curl -s /api/workers
Answer question: curl -s -X PATCH /api/tasks/ID/questions/QID -d '{"answer":"Approve"}'

## Task Lifecycle

When you notice tasks that are related (e.g. similar area of code, one depends on another, or a bug was discovered while working on a feature), link them using the refs API. This helps future teams understand relationships between work items.

### Two-Phase Worker Lifecycle
Every task goes through TWO worker phases:
1. **Plan phase**: a planner worker explores, asks questions, and posts a [PLAN] comment. Planners cannot write code.
2. **Build phase**: a builder worker reads the approved plan and implements it.

The team lead orchestrates both phases via the worker spawn API (see "Worker Spawning" section below).

### Ready column — Pick up and spawn
For each task with column "ready", sorted by priority (critical > high > medium > low):
1. Pick the most suitable team member from the Team Members list above
2. IMMEDIATELY update the board: PATCH with BOTH column="in-progress" AND assignee="{member-name}" in the SAME request
3. Check the task's tags. If the task has the tag "simple", this is a **simple task** — skip the planner and spawn a builder directly:
   - Add a comment: "Assigned to {member-name}, simple task — skipping plan phase"
   - curl -s -X POST http://localhost:${port}/api/workers/spawn -H 'Content-Type: application/json' -d '{"name":"{member-name}","taskId":"TASK_ID","mode":"build"}'
4. Otherwise (no "simple" tag), spawn a planner:
   - Add a comment: "Assigned to {member-name}, starting plan phase"
   - curl -s -X POST http://localhost:${port}/api/workers/spawn -H 'Content-Type: application/json' -d '{"name":"{member-name}","taskId":"TASK_ID","mode":"plan"}'

CRITICAL: The PATCH to move a task to in-progress MUST always include the "assignee" field. Never PATCH column without also setting assignee. Use ONLY names from the Team Members list above.

When triaging backlog tasks, you MAY add the "simple" tag to tasks that are clearly small and self-contained (typo fixes, single-line config changes, simple refactors, doc updates). Do NOT tag as "simple" if the task involves creating new files, changing architecture, or has any ambiguity about the approach.

### Budget enforcement
Each task has a budget (default 50 turns / 30 wall-clock minutes, split 50/50 between planner and builder). Workers that exceed their allocation are killed automatically — Clamban posts a [BUDGET_EXCEEDED] comment and reverts the task to "ready". When you see a [BUDGET_EXCEEDED] comment on a task, do NOT just respawn the same worker — investigate:
- If the task is genuinely too large: split it into smaller subtasks (link with parent/child) and move the parent to backlog
- If the worker was spiraling on a specific obstacle: post a redirect comment with an alternate approach, then re-assign
- If the issue requires human input: post a question to the task and wait for the human pilot
A task that hits its budget twice in a row almost always needs to be split or escalated, NEVER blindly retried.

Workers that go silent for 15 minutes are also killed automatically — Clamban posts a [STUCK] comment and reverts the task to "ready". When you see a [STUCK] comment, the worker may have deadlocked on a shell command or hit a network timeout. Check the worker's log for the last few actions, then decide whether to re-spawn with a different approach or escalate.

### In Progress column — Watch for plans and progress
For each task in "in-progress", check the comments:

**If the task has NO [PLAN] comment yet** — the planner is still working. Move on, you'll be re-invoked when they post.

**If the task has a [PLAN] comment AND the planner's "Approve this plan?" question is unanswered** — the human pilot needs to approve. You can either:
- Wait (the human will answer via the UI), OR
- If the plan looks reasonable and the task is straightforward, YOU (the team lead) can answer the question via:
  curl -s -X PATCH http://localhost:${port}/api/tasks/TASK_ID/questions/QUESTION_ID -H 'Content-Type: application/json' -d '{"answer":"Approve"}'

**If the task has a [PLAN] comment AND the approval question has been answered "Approve"** — the planner has finished and the plan is approved. Spawn the builder now:
1. Verify no worker is currently running for this assignee: curl -s http://localhost:${port}/api/workers
2. Add a comment: "Plan approved, spawning builder"
3. Spawn the builder via the workers API with mode="build":
   curl -s -X POST http://localhost:${port}/api/workers/spawn -H 'Content-Type: application/json' -d '{"name":"{member-name}","taskId":"TASK_ID","mode":"build"}'

**If the approval question was answered "Reject" or with feedback** — read the feedback, decide whether to:
- Re-spawn the planner with the feedback context, OR
- Simplify/split the task and move it back to "ready"

**If a worker (planner OR builder) reports a FAILURE or BLOCKER** (their last comment says they are stuck):
1. Read their comments to understand what went wrong
2. Do NOT blindly re-spawn the same worker on the same task — choose one of:
   a. **Simplify**: break the task into smaller subtasks (link with parent/child)
   b. **Redirect**: add a comment with a different approach, then re-spawn
   c. **Escalate**: post a question to the task and wait for the human pilot
3. PATCH the task back to "ready" so it goes through proper re-assignment

**If a worker has unanswered questions** that have since been answered, re-spawn them. The worker will see the answers in the task's questions array.

### Review column — Approve or reject
Review completed work:
1. Check the most recent comments. If the team has validation configured, you will see a [VALIDATION_PASSED] or [VALIDATION_FAILED] comment posted automatically by Clamban after the worker moved the task to review.
   - [VALIDATION_PASSED]: trust this. The build/test/typecheck/lint commands all ran clean against the worker's branch. Proceed to step 2.
   - [VALIDATION_FAILED]: do NOT merge. The task has already been reverted to "in-progress" automatically and will appear in your in-progress workflow. Read the failure output in the comment, decide whether to re-spawn the same worker (with redirect comment), simplify the task, or escalate via question.
   - No validation comment: validation isn't configured for this team, proceed with manual review.
2. **Check for the "review-required" tag.** If the task has this tag, do NOT merge it yourself. Instead:
   - Review the diff: \`git diff main...\${BRANCH_NAME}\`
   - Post your review assessment as a comment (what looks good, what concerns you, any suggestions)
   - Leave the task in "review" — the human pilot will approve and merge via the Clamban UI
   - Move on to other tasks
3. For tasks WITHOUT "review-required", review the diff: \`git diff main...\${BRANCH_NAME}\`
4. If the work looks good:
   a. Merge the branch into main: \`git merge \${BRANCH_NAME} --no-edit\`
   b. If the merge has conflicts, resolve them, then \`git add . && git commit --no-edit\`
   c. PATCH column to "done", add approval comment noting the merge
5. If changes needed: PATCH column back to "in-progress", add feedback comment, re-assign

### Backlog column — Triage & Promote
For each backlog task, sorted by priority (critical > high > medium > low):
1. Read the task title, description, and priority
2. Search for related done tasks using 1-2 keywords from the title:
   curl -s 'http://localhost:${port}/api/tasks/search?q=KEYWORD&column=done&limit=5'
   If matches are found, link each relevant result to this task so workers have context:
   curl -s -X POST http://localhost:${port}/api/tasks/TASK_ID/refs -H 'Content-Type: application/json' -d '{"taskId":"MATCHED_TASK_ID","type":"related"}'
3. If the task has NO triage comment yet from you: add a triage comment with your assessment (estimated effort, importance, any questions, relevant prior work found)
4. If the task ALREADY HAS a triage comment from you (or was already triaged): decide whether to promote it now

Promotion rules:
- If there are tasks in ready, in-progress, or review columns: only promote critical/high priority backlog items
- If NO tasks are in ready, in-progress, or review: promote backlog items according to priority guidelines below
- To promote: PATCH column to "ready", add a comment: "Promoting to ready — {brief reason}"

Priority guidelines for promotion:
- Critical/high priority: promote immediately (same cycle as triage if no active work, next cycle otherwise)
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

When deciding tags, add "review-required" if the task:
- Touches shared types, interfaces, or data models
- Introduces a new library or dependency
- Changes authentication, authorization, or security-related code
- Modifies build configuration, CI/CD, or project structure
- Creates a new architectural pattern that other tasks will follow
For self-contained features, bug fixes, and simple changes, "review-required" is NOT needed.

## Single Cycle
1. Fetch the board summary: curl -s 'http://localhost:${port}/api/board/summary'
2. For tasks you need to act on, fetch full details: curl -s '/api/tasks?ids=ID1,ID2'
3. Process each column as described above
4. After all actions, you are DONE — exit normally
5. Do NOT loop or wait. Process the board once and stop.
6. You will be re-invoked automatically when the board changes.

## Worker Spawning (via HTTP, not the Task tool)
Workers are spawned as separate Claude CLI processes via the Clamban API. Do NOT use the Task tool to spawn workers.

Workers run in one of two modes:

**Plan mode** (the worker is a planner — read-only, cannot write code):
  curl -s -X POST http://localhost:${port}/api/workers/spawn \\
    -H 'Content-Type: application/json' \\
    -d '{"name":"worker-name","taskId":"TASK_ID","mode":"plan"}'

The planner explores the codebase, asks questions via the questions API, posts a [PLAN] comment, and asks an approval question. It exits when the plan is posted.

**Build mode** (the worker is a builder — full tools, implements an approved plan):
  curl -s -X POST http://localhost:${port}/api/workers/spawn \\
    -H 'Content-Type: application/json' \\
    -d '{"name":"worker-name","taskId":"TASK_ID","mode":"build"}'

The builder reads the [PLAN] comment, gets a fresh git worktree on a new branch, and implements the plan. It exits after moving the task to "review".

The response includes the worker's PID, log path, branch name (or "(planning)" for planners), and worktree path. Clamban handles all git worktree creation automatically.

Important:
- The worker name MUST match a name from the Team Members list above
- A given worker name can only have ONE active process at a time. Check via: curl -s http://localhost:${port}/api/workers
- The two phases use the same worker name but spawn separately (planner first, then builder after approval)
- After spawning, the worker runs in its own process. When it updates the board, you will be re-invoked by the board-changed event.
- You CAN spawn multiple DIFFERENT workers in parallel for independent tasks — each runs concurrently.
- To read a worker's log: curl -s http://localhost:${port}/api/team/worker-logs/WORKER_NAME?lines=100

After spawning a worker, you should:
1. Add a comment to the task: "Spawned {name} in {mode} mode (pid {pid})"
2. Move on to other tasks or exit your cycle — let the worker do its job

## Important Rules
- Always use curl for board mutations (not file writes)
- ALWAYS set assignee when moving to in-progress — never omit it
- Use author "Team Lead" for comments
- Be concise in comments
- Process highest priority tasks first
- You can spawn multiple workers in parallel for independent tasks
- Proactively create new tasks when you notice follow-up work, bugs, or improvements — don't let knowledge get lost

## Current Session Context
Team: "${teamName}"
Workers on this team (use ONLY these names for assignee and spawning):
${memberList}

Do NOT invent new worker names. Use the exact names listed above.

Start by fetching the board summary now.`;
}

export function buildPlannerPrompt(
  workerName: string,
  taskId: string,
  branch: string,
  worktreePath: string,
  port: number
): string {
  return `You are ${workerName}, a PLANNER on a Clamban team. You have been spawned with --disallowedTools "Edit,Write,NotebookEdit" — you literally CANNOT write, edit, or create files. Your only job is to produce a plan and get it approved.

Your task ID is ${taskId}.
Your name is ${workerName}.
Your git branch is ${branch}.
Your working directory is ${worktreePath} (you are already in it, but you cannot modify anything here).
The Clamban API is at http://localhost:${port}.

## CRITICAL FIRST ACTION
Your VERY FIRST tool call MUST be the Skill tool with skill="grill-me". This loads the grill-me methodology, which is exactly the mindset you need: interview the human pilot relentlessly about every aspect of the plan, walking down each branch of the design tree and resolving dependencies one-by-one.

Invoke it as:
  Skill({ skill: "grill-me" })

After the skill loads, follow its guidance in combination with the workflow below. The grill-me skill tells you HOW to think; this prompt tells you HOW to act (where to post questions, where to post the plan, how to get approval).

## What You Must Do (in order)

### Step 1: Understand the task
Fetch your task and any related tasks:
  curl -s 'http://localhost:${port}/api/tasks?ids=${taskId}'
Read the title, description, file context, refs, and ANY existing answered questions in the task's questions array.

If the task has refs, fetch them too:
  curl -s 'http://localhost:${port}/api/tasks?ids=REF_ID1,REF_ID2'

### Step 2: Explore the codebase (bounded)
Use Read, Glob, Grep, Bash (read-only commands) to understand the relevant parts of the codebase. Be efficient with your exploration:
- Start with package.json and any files listed in the task's context field
- Use Glob/Grep to find related files rather than reading everything
- Read at most 10-15 files during exploration — focus on the files you would actually modify
- Prioritize: existing patterns/conventions, dependency versions, related component shapes
- Do NOT read entire directories or every file in a module — targeted reads only

### Step 3: Ask questions (use the grill-me approach)
This is CRITICAL. Interview the human pilot relentlessly about every aspect of the plan that involves real-world context, business logic, or design preferences that you cannot determine from code alone. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

Post a question via the API (use multiple-choice options when there are discrete alternatives):
  curl -s -X POST http://localhost:${port}/api/tasks/${taskId}/questions -H 'Content-Type: application/json' -d '{"author":"${workerName}","text":"Your question","options":[{"label":"Option A","description":"Why A"},{"label":"Option B","description":"Why B"}]}'

The response includes the question id. Then poll for the answer (set Bash timeout to 600000ms):
  QID="the-returned-question-id"
  for i in $(seq 1 60); do
    ans=$(curl -s http://localhost:${port}/api/tasks/${taskId}/questions/$QID | jq -r '.answer // empty')
    [ -n "$ans" ] && echo "$ans" && exit 0
    sleep 10
  done
  echo "TIMEOUT"

If TIMEOUT, post a "still waiting for human input" comment and exit. You will be respawned when the answer arrives.

Ask as many questions as you need. The grill-me skill is exactly the right mindset here — be thorough, don't assume.

### Step 4: Post the plan AND ask for approval (in ONE step)
Once you have enough information, post a question whose "details" field contains the FULL plan content. The UI renders the details inline above the question, so the human can read your plan and approve/reject in a single view.

The plan in details should include:
- Goal: what this task achieves
- Approach: the technical approach
- Files to create or modify (specific paths)
- Key decisions and the reasoning
- Assumptions you are making
- Verification: how to test the change

Post the approval question with the plan in details:
  curl -s -X POST http://localhost:${port}/api/tasks/${taskId}/questions \\
    -H 'Content-Type: application/json' \\
    -d '{
      "author":"${workerName}",
      "text":"Approve this plan?",
      "details":"Goal: ...\\nApproach: ...\\nFiles to modify:\\n- path/to/file1.ts\\n- path/to/file2.tsx\\nKey decisions:\\n- decision A because ...\\nAssumptions:\\n- ...\\nVerification: ...",
      "options":[
        {"label":"Approve","description":"Plan is ready, proceed to implementation"},
        {"label":"Reject","description":"Plan needs changes — use custom answer to give feedback"}
      ]
    }'

IMPORTANT: Use proper JSON escaping for newlines in the details field (\\n inside the JSON string). The details field can be many lines long — include the full plan, not a summary.

ALSO post a [PLAN] comment as a permanent record on the task (for the team lead and future workers to find):
  curl -s -X POST http://localhost:${port}/api/tasks/${taskId}/comments -H 'Content-Type: application/json' -d '{"author":"${workerName}","text":"[PLAN] (same content as the question details)"}'

### Step 5: Poll for approval
Poll for the answer (set Bash timeout to 600000ms):
  QID="the-returned-question-id"
  for i in $(seq 1 60); do
    ans=$(curl -s http://localhost:${port}/api/tasks/${taskId}/questions/$QID | jq -r '.answer // empty')
    [ -n "$ans" ] && echo "$ans" && exit 0
    sleep 10
  done
  echo "TIMEOUT"

When the answer arrives:
- If "Approve": post a comment "Plan approved, ready for build phase" and EXIT normally
- If "Reject" or feedback: post a comment summarizing the feedback received, then exit. You'll be respawned with the feedback in scope.
- If TIMEOUT: post a "still waiting on plan approval" comment and exit.

## Hard Rules
- Your FIRST tool call MUST be Skill({ skill: "grill-me" }). Do not skip this.
- You CANNOT use Edit, Write, or NotebookEdit — the spawn flags forbid them. Trying will fail immediately.
- Do NOT use git commands to modify the worktree. You are read-only.
- Your only outputs are: board comments, board questions, and this prompt's instructions.
- Do NOT skip the planning step. Do NOT mark the task as complete. Your job ends when the plan is posted (in the approval question's details field) and the approval question is asked.

Begin by invoking the grill-me skill, then fetch your task.`;
}

export function buildBuilderPrompt(
  workerName: string,
  taskId: string,
  branch: string,
  worktreePath: string,
  port: number
): string {
  return `You are ${workerName}, a BUILDER on a Clamban team. A planner has already produced an approved plan for this task — your job is to implement it using test-driven development.

Your task ID is ${taskId}.
Your name is ${workerName}.
Your git branch is ${branch}.
Your working directory is ${worktreePath} (you are already in it).
The Clamban API is at http://localhost:${port}.

## Step 1: Read the task and any approved plan
Fetch the task:
  curl -s 'http://localhost:${port}/api/tasks?ids=${taskId}'

Look for a [PLAN] comment or an answered "Approve this plan?" question (the plan lives in its \`details\` field). If found, this is your spec — follow it closely.

If there is NO [PLAN] comment and no approval question, this is a **simple task** that skipped the planning phase. Read the task title and description directly — they ARE your spec. Implement exactly what they describe, nothing more.

ALWAYS check the questions array for any prior answered questions before proceeding.

## Step 2: INVOKE THE TDD SKILL (required, before any coding)
Your next tool call MUST be the Skill tool with skill="tdd". This loads the TDD methodology — vertical-slice red-green-refactor — which is MANDATORY for implementation.

Invoke it as:
  Skill({ skill: "tdd" })

After the skill loads, follow its guidance strictly:
- Write ONE test at a time (never write multiple tests up front)
- Get that test failing (RED), then write minimal code to pass (GREEN)
- Move to the next test
- Never refactor while RED
- Tests describe BEHAVIOR through public interfaces, not implementation details

This is non-negotiable. If the task has no natural test surface (e.g. pure UI with no logic), post a comment explaining why and then proceed with implementation + manual verification.

## Step 3: Set the branch
PATCH your branch name to the board:
  curl -s -X PATCH http://localhost:${port}/api/tasks/${taskId} -H 'Content-Type: application/json' -d '{"branch":"${branch}"}'

## Step 4: Implement the plan via TDD
Follow the red-green-refactor loop for each behavior in the plan:
1. RED: write a failing test for ONE behavior from the plan
2. GREEN: write the minimum code to make that test pass
3. Commit (small, focused commit)
4. Repeat for the next behavior

Use standard git commands between cycles:
  git add <files>
  git commit -m "test+impl: behavior X"

Commit frequently after each red-green cycle. Do NOT push — the team lead will merge your branch into main during review.

If the plan includes non-testable work (e.g. CSS, configuration files, asset additions), do those in separate commits alongside the TDD-driven commits.

## Step 4: Code Review (REQUIRED before reporting completion)
After implementation and commits, run a CodeRabbit review:
  /coderabbit:review --base main
If issues are found, fix them and re-run until clean.

## Step 5: Report completion
1. Post a final summary comment: what you built, files touched, CodeRabbit results
   curl -s -X POST http://localhost:${port}/api/tasks/${taskId}/comments -H 'Content-Type: application/json' -d '{"author":"${workerName}","text":"Built: ... Files: ... CodeRabbit: clean"}'
2. PATCH the task to column "review":
   curl -s -X PATCH http://localhost:${port}/api/tasks/${taskId} -H 'Content-Type: application/json' -d '{"column":"review"}'
3. Exit normally

## Avoiding Spirals (CRITICAL)
If you find yourself doing any of the following, STOP immediately:
- Running the same command or a similar variant more than 3 times
- Debugging compiled/bundled output (webpack chunks, .next build artifacts, minified code)
- Deleting and recreating the same file repeatedly
- Trying more than 2 different approaches to fix the same build/type error

When stuck: post a comment explaining what you tried and what failed, commit any partial work, and exit. The team lead will reassess.

## If You Need Human Input Mid-Build
If you discover something during implementation that requires human input (the plan didn't anticipate it), post a question via the questions API and poll for the answer:
  curl -s -X POST http://localhost:${port}/api/tasks/${taskId}/questions -H 'Content-Type: application/json' -d '{"author":"${workerName}","text":"Your question","options":[{"label":"A","description":"..."},{"label":"B","description":"..."}]}'

Then poll (Bash timeout 600000ms):
  QID="..."
  for i in $(seq 1 60); do
    ans=$(curl -s http://localhost:${port}/api/tasks/${taskId}/questions/$QID | jq -r '.answer // empty')
    [ -n "$ans" ] && echo "$ans" && exit 0
    sleep 10
  done

Begin by fetching the task, reading the approved plan, then invoking Skill({ skill: "tdd" }).`;
}

function formatStreamEvent(event: Record<string, unknown>): string | null {
  const type = event.type as string | undefined;

  // system init — log session start
  if (type === "system" && event.subtype === "init") {
    return `[session ${((event.session_id as string) || "").slice(0, 8)}] model=${event.model}`;
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

  // Use governor if available, fall back to manual tracking
  if (turnGovernor && !turnGovernor.canSpawn()) {
    teamActive = false;
    persistState(config.teamName, { leadPid: undefined, stoppedAt: new Date().toISOString() });
    currentOnExit?.();
    return;
  }

  const remainingBudget = turnGovernor ? turnGovernor.remaining : maxTurns - totalTurnsUsed;
  if (remainingBudget <= 0) {
    console.log(
      `[clamban] Turn budget exhausted (${totalTurnsUsed}/${maxTurns}), auto-stopping team`
    );
    teamActive = false;
    persistState(config.teamName, { leadPid: undefined, stoppedAt: new Date().toISOString() });
    currentOnExit?.();
    return;
  }

  const model = config.model || "haiku";
  const cycleTurns = turnGovernor
    ? turnGovernor.allocateCycleBudget(15)
    : Math.min(15, remainingBudget);
  const prompt = buildLeadPrompt(config.teamName, port);

  ensureDir(LOGS_DIR);
  const logPath = getLogFilePath(config.teamName);
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  logStream.write(
    `\n--- Cycle started at ${new Date().toISOString()} (turns used: ${totalTurnsUsed}/${maxTurns}, budget: ${cycleTurns}) ---\n`
  );

  lastSpawnTime = Date.now();
  pendingBoardChange = false;

  leadProcess = spawn(
    "claude",
    [
      "-p",
      "--dangerously-skip-permissions",
      "--model",
      model,
      "--max-turns",
      String(cycleTurns),
      "--output-format",
      "stream-json",
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
            turnGovernor?.recordTurns(event.num_turns);
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
    logStream.write(
      `\n--- Cycle exited with code ${code} at ${new Date().toISOString()} (total turns: ${totalTurnsUsed}) ---\n`
    );
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
      console.warn(
        `[clamban] Cycle exited in ${elapsed}ms (< 5s), not respawning — possible crash`
      );
      currentOnExit?.();
      return;
    }

    // Turn budget exhausted — check governor first, fall back to manual
    const budgetExhausted = turnGovernor
      ? turnGovernor.exhausted
      : totalTurnsUsed >= (config.maxTurns || 1000);
    if (budgetExhausted) {
      console.log(
        `[clamban] Turn budget exhausted (${totalTurnsUsed}/${config.maxTurns || 1000}), auto-stopping team`
      );
      teamActive = false;
      persistState(teamName, { stoppedAt: new Date().toISOString() });
      currentOnExit?.();
      return;
    }

    // Board changed while we were running — respawn after debounce
    if (pendingBoardChange) {
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        spawnCycle();
      }, 5000);
      currentOnExit?.();
      return;
    }

    // Check if there's actionable work remaining (ready tasks, or backlog to promote)
    try {
      const board = readBoard();
      const hasReady = board.tasks.some((t) => t.column === "ready");
      const hasInProgress = board.tasks.some((t) => t.column === "in-progress");
      const hasReview = board.tasks.some((t) => t.column === "review");
      const hasBacklog = board.tasks.some((t) => t.column === "backlog");

      if (hasReady || hasInProgress || hasReview || hasBacklog) {
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          spawnCycle();
        }, 30000);
        currentOnExit?.();
        return;
      }
    } catch {}

    // Nothing pending — go idle, wait for next board-change event
    currentOnExit?.();
  });
}

export function startTeam(config: TeamConfig, port: number, onExit?: () => void): { pid: number } {
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
  turnGovernor = createTurnGovernor({
    maxTurns: config.maxTurns || 1000,
    onBudgetExhausted(used, max) {
      console.log(`[clamban] Turn budget exhausted (${used}/${max}), auto-stopping team`);
    },
    warningThreshold: 0.1,
    onBudgetWarning(used, max, remaining) {
      console.warn(`[clamban] Turn budget warning: ${remaining} turns remaining (${used}/${max})`);
    },
  });

  // Truncate log on fresh start
  ensureDir(LOGS_DIR);
  fs.writeFileSync(getLogFilePath(config.teamName), "");

  // Clean up stale worktrees and branches from previous runs
  cleanupOrphanedWorktrees(config.projectDir);

  // Start the wall-clock budget check loop
  if (budgetCheckInterval) {
    clearInterval(budgetCheckInterval);
  }
  budgetCheckInterval = setInterval(budgetCheckTick, BUDGET_CHECK_INTERVAL_MS);

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

  // Stop the wall-clock budget check loop
  if (budgetCheckInterval) {
    clearInterval(budgetCheckInterval);
    budgetCheckInterval = null;
  }

  // Kill all running workers first, then clean up their worktrees
  killAllWorkers();
  if (currentConfig?.projectDir) {
    cleanupOrphanedWorktrees(currentConfig.projectDir);
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
            try {
              process.kill(pid, "SIGKILL");
            } catch {}
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

/** Expose the turn governor for monitoring (read-only use) */
export function getTurnGovernor(): TurnGovernor | null {
  return turnGovernor;
}

/** Called when board.json changes — triggers a new cycle if team is active */
export function notifyBoardChanged(): void {
  if (!teamActive) return;

  // Process is running — flag it so we respawn after exit
  if (leadProcess && !leadProcess.killed) {
    pendingBoardChange = true;
    return;
  }

  // Idle — debounce 30s then spawn a new cycle
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (teamActive && !leadProcess) {
      spawnCycle();
    }
  }, 30000);
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

function validatePathSegment(name: string): void {
  if (!name || /[\/\\]/.test(name) || name.includes("..")) {
    throw new Error(`Invalid path segment: ${name}`);
  }
}

export function getWorkerLogDir(teamName: string): string {
  validatePathSegment(teamName);
  return path.join(LOGS_DIR, teamName, "workers");
}

export function listWorkerLogs(teamName: string): string[] {
  try {
    const dir = getWorkerLogDir(teamName);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".log"))
      .map((f) => f.replace(/\.log$/, ""));
  } catch {
    return [];
  }
}

export function readWorkerLogTail(
  teamName: string,
  workerName: string,
  lines: number = 200
): string {
  try {
    validatePathSegment(workerName);
    const dir = getWorkerLogDir(teamName);
    const logPath = path.join(dir, `${workerName}.log`);
    const resolvedPath = path.resolve(logPath);
    if (!resolvedPath.startsWith(path.resolve(dir) + path.sep)) return "";
    if (!fs.existsSync(logPath)) return "";
    const content = fs.readFileSync(logPath, "utf-8");
    const allLines = content.split("\n");
    return allLines.slice(-lines).join("\n");
  } catch {
    return "";
  }
}

// --- Worker process management ---

function getWorktreesDir(projectDir: string): string {
  return path.join(projectDir, ".clamban-worktrees");
}

/**
 * Remove any worktrees under .clamban-worktrees/ that don't belong to a
 * currently active worker, then prune orphaned worker/* branches.
 * Called on team start (clean slate) and team stop (clean exit).
 */
function cleanupOrphanedWorktrees(projectDir: string): void {
  const worktreesDir = getWorktreesDir(projectDir);
  if (!fs.existsSync(worktreesDir)) return;

  // Collect worktree paths owned by active workers
  const activeWorktrees = new Set<string>();
  for (const info of workerInfo.values()) {
    if (info.worktreePath) activeWorktrees.add(info.worktreePath);
  }

  // Remove orphaned worktree directories
  try {
    const entries = fs.readdirSync(worktreesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(worktreesDir, entry.name);
      if (activeWorktrees.has(fullPath)) continue;
      try {
        execSync(`git worktree remove --force "${fullPath}"`, {
          cwd: projectDir,
          stdio: "pipe",
        });
      } catch {
        // Best effort — might already be gone or locked
      }
    }
  } catch {}

  // Prune git's internal worktree list to match what we just removed
  try {
    execSync("git worktree prune", { cwd: projectDir, stdio: "pipe" });
  } catch {}

  // Collect branch names owned by active workers
  const activeBranches = new Set<string>();
  for (const info of workerInfo.values()) {
    if (info.branch && info.branch !== "(planning)") {
      activeBranches.add(info.branch);
    }
  }

  // Delete orphaned worker/* branches
  try {
    const branchOutput = execSync('git branch --list "worker/*"', {
      cwd: projectDir,
      stdio: "pipe",
    }).toString();
    const branches = branchOutput
      .split("\n")
      .map((b) => b.trim().replace(/^\* /, ""))
      .filter(Boolean);
    for (const branch of branches) {
      if (activeBranches.has(branch)) continue;
      try {
        execSync(`git branch -D "${branch}"`, {
          cwd: projectDir,
          stdio: "pipe",
        });
      } catch {}
    }
  } catch {}
}

function shortTaskId(taskId: string): string {
  return taskId.slice(-8);
}

/**
 * Resolve the effective budget for a task by walking precedence:
 * task.budget → team.defaultBudget → hardcoded defaults.
 */
export function resolveBudget(
  task: Task | undefined,
  config: TeamConfig | undefined
): { turns: number; wallClockMinutes: number } {
  const taskBudget = task?.budget;
  const teamBudget = config?.defaultBudget;
  const turns = taskBudget?.turns ?? teamBudget?.turns ?? HARDCODED_TURN_BUDGET;
  const wallClockMinutes =
    taskBudget?.wallClockMinutes ?? teamBudget?.wallClockMinutes ?? HARDCODED_WALL_CLOCK_MINUTES;
  return { turns, wallClockMinutes };
}

/**
 * Append a comment to a task directly via board-store (no HTTP).
 * Used by in-process enforcement paths.
 */
function postBoardComment(taskId: string, author: string, text: string): void {
  const board = readBoard();
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.comments.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    author,
    text,
    timestamp: new Date().toISOString(),
  });
  task.updatedAt = new Date().toISOString();
  writeBoardSync(board);
}

/**
 * Move a task back to "ready" and clear its assignee. Used when a worker
 * is killed for exceeding its budget so the team lead re-triages it.
 */
function revertTaskToReady(taskId: string): void {
  const board = readBoard();
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.column = "ready";
  task.assignee = undefined;
  task.updatedAt = new Date().toISOString();
  writeBoardSync(board);
}

/**
 * Kill a worker that has exceeded its budget, post a [BUDGET_EXCEEDED]
 * comment, revert the task to "ready", and clean up worktree/state.
 */
/**
 * Shared kill → audit-log → worktree cleanup → board comment → revert helper.
 * Used by both budget enforcement and heartbeat stuck detection.
 */
function killWorkerAndRevert(workerName: string, commentText: string, auditLabel: string): void {
  const info = workerInfo.get(workerName);
  const budget = workerBudgets.get(workerName);
  if (!info) {
    workerBudgets.delete(workerName);
    workerProcesses.delete(workerName);
    return;
  }

  const proc = workerProcesses.get(workerName);

  // 1. Kill the process (SIGTERM → SIGKILL after 5s)
  if (proc && !proc.killed) {
    try {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) {
          try {
            proc.kill("SIGKILL");
          } catch {}
        }
      }, 5000);
    } catch {}
  }

  // 2. Audit-log to the worker's log file
  try {
    const logStream = fs.createWriteStream(info.logPath, { flags: "a" });
    logStream.write(`\n=== [${auditLabel}] ${workerName} killed ===\n`);
    logStream.end();
  } catch {}

  // 3. For builders, clean up the worktree so it doesn't linger
  if (budget?.mode === "build" && info.worktreePath) {
    const mainRepo = currentConfig?.projectDir;
    if (mainRepo) {
      try {
        execSync(`git worktree remove --force "${info.worktreePath}"`, {
          cwd: mainRepo,
          stdio: "pipe",
        });
      } catch {}
      try {
        execSync(`git branch -D "${info.branch}"`, {
          cwd: mainRepo,
          stdio: "pipe",
        });
      } catch {}
    }
  }

  // 4. Post comment + revert task to ready
  const taskId = budget?.taskId ?? info.taskId;
  postBoardComment(taskId, "Team Lead", commentText);
  revertTaskToReady(taskId);

  // 5. Clean up in-memory state
  workerBudgets.delete(workerName);
  workerInfo.delete(workerName);
  workerProcesses.delete(workerName);
}

function enforceBudgetExceeded(workerName: string, reason: "turns" | "wallclock"): void {
  const budget = workerBudgets.get(workerName);
  const detail =
    reason === "turns"
      ? `turn budget exhausted (${budget?.turnsUsed ?? "?"}/${budget?.turnsAllocated ?? "?"} turns)`
      : `wall-clock budget exhausted (deadline ${budget ? new Date(budget.deadline).toISOString() : "?"})`;

  killWorkerAndRevert(
    workerName,
    `[BUDGET_EXCEEDED] Worker ${workerName} killed: ${detail}. Task reverted to "ready" for re-triage. Consider splitting the task or raising its budget.`,
    "BUDGET_EXCEEDED"
  );
}

const HEARTBEAT_TIMEOUT_MS = 15 * 60 * 1000;

function enforceStuck(workerName: string): void {
  const info = workerInfo.get(workerName);
  const silentMinutes = info ? Math.round((Date.now() - info.lastEventAt) / 60_000) : "?";

  killWorkerAndRevert(
    workerName,
    `[STUCK] Worker ${workerName} killed: no activity for ${silentMinutes} minutes. Task reverted to "ready" for re-triage. Consider splitting or using a different approach.`,
    "STUCK"
  );
}

/**
 * Called every BUDGET_CHECK_INTERVAL_MS. Scans workers for:
 * 1. Wall-clock budget exceeded (deadline passed)
 * 2. Heartbeat timeout (no stream-json events for HEARTBEAT_TIMEOUT_MS)
 *
 * Turn enforcement is synchronous inside the spawnWorker stdout parser.
 */
function budgetCheckTick(): void {
  const now = Date.now();
  for (const [name] of workerBudgets) {
    const budget = workerBudgets.get(name);
    if (budget && now > budget.deadline) {
      enforceBudgetExceeded(name, "wallclock");
      continue; // already killed, skip heartbeat
    }
    const info = workerInfo.get(name);
    if (info && now - info.lastEventAt > HEARTBEAT_TIMEOUT_MS) {
      enforceStuck(name);
    }
  }
}

// --- Validation (Phase 2A) ---

const VALIDATION_TIMEOUT_MS = 5 * 60 * 1000;
const VALIDATION_OUTPUT_MAX_CHARS = 4000;

export type ValidationName = "build" | "test" | "typecheck" | "lint";

export interface ValidationResult {
  name: ValidationName;
  command: string;
  ok: boolean;
  durationMs: number;
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * Run a single validation command via execSync. Captures stdout+stderr (truncated)
 * and the exit code. A timeout (SIGTERM after VALIDATION_TIMEOUT_MS) is treated
 * as a failure with `timedOut: true`.
 */
export function runValidationCommand(
  name: ValidationName,
  command: string,
  cwd: string
): ValidationResult {
  const start = Date.now();
  try {
    execSync(command, {
      cwd,
      stdio: "pipe",
      timeout: VALIDATION_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024,
    });
    return {
      name,
      command,
      ok: true,
      durationMs: Date.now() - start,
      output: "",
      exitCode: 0,
      timedOut: false,
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: Buffer;
      stderr?: Buffer;
      status?: number;
      signal?: string;
    };
    const stdout = e.stdout?.toString() ?? "";
    const stderr = e.stderr?.toString() ?? "";
    const combined = (stdout + "\n" + stderr).trim();
    const truncated =
      combined.length > VALIDATION_OUTPUT_MAX_CHARS
        ? "...(truncated)...\n" + combined.slice(-VALIDATION_OUTPUT_MAX_CHARS)
        : combined;
    return {
      name,
      command,
      ok: false,
      durationMs: Date.now() - start,
      output: truncated,
      exitCode: e.status ?? null,
      timedOut: e.signal === "SIGTERM",
    };
  }
}

/**
 * Run all configured validation commands in order (build → test → typecheck → lint).
 * Aborts on first failure (later commands are skipped).
 *
 * Returns:
 * - `null` if no validation is configured at all (skip the feature gracefully)
 * - empty array if validation is configured but no commands are populated
 * - non-empty array of results otherwise
 */
export function runTaskValidation(
  validation: Validation | undefined,
  cwd: string
): ValidationResult[] | null {
  if (!validation) return null;
  const results: ValidationResult[] = [];
  const order: ValidationName[] = ["build", "test", "typecheck", "lint"];
  for (const name of order) {
    const cmd = validation[name];
    if (!cmd || !cmd.trim()) continue;
    const result = runValidationCommand(name, cmd, cwd);
    results.push(result);
    if (!result.ok) break;
  }
  return results;
}

/**
 * Apply validation results to the board: post a [VALIDATION_PASSED] or
 * [VALIDATION_FAILED] comment, and on failure revert the task column to
 * "in-progress" while preserving assignee and branch.
 *
 * Also writes a summary + failed-command output to the worker's log file.
 */
export function applyValidationResults(
  taskId: string,
  results: ValidationResult[],
  logStream: fs.WriteStream
): void {
  if (results.length === 0) return;

  const allPassed = results.every((r) => r.ok);
  const summary = results
    .map(
      (r) =>
        `  ${r.ok ? "✓" : "✗"} ${r.name} (${(r.durationMs / 1000).toFixed(1)}s)${r.timedOut ? " [TIMEOUT]" : ""}`
    )
    .join("\n");

  // Audit-log to the worker's log file (still open at this point)
  try {
    logStream.write(`\n=== Validation results ===\n${summary}\n`);
    for (const r of results) {
      if (!r.ok && r.output) {
        logStream.write(`\n--- ${r.name} output ---\n${r.output}\n`);
      }
    }
  } catch {}

  if (allPassed) {
    postBoardComment(taskId, "Team Lead", `[VALIDATION_PASSED] All checks green:\n${summary}`);
    return;
  }

  // First-failure-aborts: the failed result is the last in the array
  const failed = results[results.length - 1];
  postBoardComment(
    taskId,
    "Team Lead",
    `[VALIDATION_FAILED] ${failed.name} failed (exit ${failed.exitCode}${failed.timedOut ? ", timed out" : ""}, ${(failed.durationMs / 1000).toFixed(1)}s):\n\`\`\`\n${failed.output}\n\`\`\`\nTask reverted to in-progress for the worker to fix.`
  );

  // Revert column to in-progress, KEEPING assignee and branch so the same
  // worker can be re-spawned with the failure context.
  const board = readBoard();
  const task = board.tasks.find((t) => t.id === taskId);
  if (task) {
    task.column = "in-progress";
    task.updatedAt = new Date().toISOString();
    writeBoardSync(board);
  }
}

export type WorkerMode = "plan" | "build";

/**
 * Spawn a worker as a separate Claude CLI process.
 *
 * - Plan mode: spawned with --disallowedTools "Edit,Write,NotebookEdit". Runs in
 *   the project root (read-only exploration). Produces a [PLAN] comment and
 *   asks the human pilot for plan approval via the questions API.
 * - Build mode: spawned with full tool access. Runs in a fresh git worktree on
 *   a new branch. Implements the approved plan from the planner.
 *
 * Workers are one-shot — no auto-respawn on exit. Their stream-json output is
 * piped through formatStreamEvent into ~/.clamban/logs/{teamName}/workers/{name}.log.
 */
export function spawnWorker(
  config: TeamConfig,
  workerName: string,
  taskId: string,
  port: number,
  mode: WorkerMode = "plan"
): {
  pid: number;
  logPath: string;
  branch: string;
  worktreePath: string;
  mode: WorkerMode;
} {
  validatePathSegment(workerName);

  if (workerProcesses.has(workerName)) {
    throw new Error(`Worker "${workerName}" is already running`);
  }

  const projectDir = config.projectDir;
  if (!fs.existsSync(projectDir)) {
    throw new Error(`Project directory does not exist: ${projectDir}`);
  }

  // Resolve per-task budget and reserve half for this phase (50/50 split
  // between planner and builder). If the task cannot be found, fall back
  // to the team/hardcoded defaults.
  const taskForBudget = readBoard().tasks.find((t) => t.id === taskId);
  const resolved = resolveBudget(taskForBudget, config);
  const turnsAllocated = Math.max(1, Math.floor(resolved.turns / 2));
  const wallClockMs = Math.max(60_000, Math.floor((resolved.wallClockMinutes / 2) * 60_000));

  let branch: string;
  let worktreePath: string;
  let cwd: string;

  if (mode === "build") {
    // Builders get a fresh worktree on a new branch
    branch = `worker/${workerName}-${shortTaskId(taskId)}`;
    const worktreesDir = getWorktreesDir(projectDir);
    ensureDir(worktreesDir);
    worktreePath = path.join(worktreesDir, `${workerName}-${shortTaskId(taskId)}`);

    // Clean up any stale worktree at this path before creating
    if (fs.existsSync(worktreePath)) {
      try {
        execSync(`git worktree remove --force "${worktreePath}"`, {
          cwd: projectDir,
          stdio: "pipe",
        });
      } catch {}
    }
    try {
      execSync(`git branch -D "${branch}"`, { cwd: projectDir, stdio: "pipe" });
    } catch {}

    try {
      execSync(`git worktree add -b "${branch}" "${worktreePath}" main`, {
        cwd: projectDir,
        stdio: "pipe",
      });
    } catch (err) {
      throw new Error(
        `Failed to create worktree for worker "${workerName}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
    cwd = worktreePath;
  } else {
    // Planners run in the project root — they cannot write so no worktree needed
    branch = "(planning)";
    worktreePath = projectDir;
    cwd = projectDir;
  }

  // Set up the worker log file
  const workerLogDir = getWorkerLogDir(config.teamName);
  ensureDir(workerLogDir);
  const logPath = path.join(workerLogDir, `${workerName}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  const startedAt = new Date().toISOString();
  logStream.write(
    `\n=== Worker ${workerName} spawned in ${mode} mode at ${startedAt} (task ${taskId}${mode === "build" ? `, branch ${branch}` : ""}) ===\n`
  );

  // Build the prompt
  const model = config.workerModel || "sonnet";
  const cycleTurns = turnGovernor ? turnGovernor.allocateCycleBudget(50) : 50;
  const prompt =
    mode === "plan"
      ? buildPlannerPrompt(workerName, taskId, branch, worktreePath, port)
      : buildBuilderPrompt(workerName, taskId, branch, worktreePath, port);

  // Build CLI args: planner gets --disallowedTools to enforce read-only behavior
  const args = [
    "-p",
    "--dangerously-skip-permissions",
    "--model",
    model,
    "--max-turns",
    String(cycleTurns),
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  if (mode === "plan") {
    args.push("--disallowedTools", "Edit,Write,NotebookEdit");
  }

  const proc = spawn("claude", args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
  });

  if (proc.stdin) {
    proc.stdin.write(prompt);
    proc.stdin.end();
  }

  // Parse stream-json stdout into the worker log via formatStreamEvent
  if (proc.stdout) {
    let buffer = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          // Heartbeat: any parsed event refreshes the liveness timestamp
          const wInfo = workerInfo.get(workerName);
          if (wInfo) wInfo.lastEventAt = Date.now();

          if (event.type === "result" && typeof event.num_turns === "number") {
            totalTurnsUsed += event.num_turns;
            turnGovernor?.recordTurns(event.num_turns);

            // Per-worker turn accounting — enforce the task's turn budget
            const workerBudget = workerBudgets.get(workerName);
            if (workerBudget) {
              workerBudget.turnsUsed += event.num_turns;
              if (workerBudget.turnsUsed >= workerBudget.turnsAllocated) {
                enforceBudgetExceeded(workerName, "turns");
              }
            }
          }
          const formatted = formatStreamEvent(event);
          if (formatted) {
            logStream.write(formatted + "\n");
          }
        } catch {
          logStream.write(line + "\n");
        }
      }
    });
  }
  if (proc.stderr) {
    proc.stderr.pipe(logStream);
  }

  const pid = proc.pid ?? 0;

  proc.on("exit", (code) => {
    logStream.write(
      `\n=== Worker ${workerName} exited with code ${code} at ${new Date().toISOString()} ===\n`
    );

    // Validation hook: only for builders that exited cleanly with the task
    // already moved to "review" by the worker as its final action.
    if (mode === "build" && code === 0) {
      try {
        const board = readBoard();
        const task = board.tasks.find((t) => t.id === taskId);
        if (task && task.column === "review") {
          const results = runTaskValidation(config.validation, worktreePath);
          if (results && results.length > 0) {
            applyValidationResults(taskId, results, logStream);
          }
        }
      } catch (err) {
        logStream.write(
          `\n=== Validation hook error: ${err instanceof Error ? err.message : String(err)} ===\n`
        );
      }
    }

    logStream.end();
    workerProcesses.delete(workerName);
    workerInfo.delete(workerName);
    workerBudgets.delete(workerName);
  });

  proc.on("error", (err) => {
    logStream.write(`\n=== Worker ${workerName} error: ${err.message} ===\n`);
    logStream.end();
    workerProcesses.delete(workerName);
    workerInfo.delete(workerName);
    workerBudgets.delete(workerName);
  });

  workerProcesses.set(workerName, proc);
  workerInfo.set(workerName, {
    name: workerName,
    pid,
    taskId,
    branch,
    worktreePath,
    startedAt,
    logPath,
    lastEventAt: Date.now(),
  });
  workerBudgets.set(workerName, {
    turnsAllocated,
    turnsUsed: 0,
    deadline: Date.now() + wallClockMs,
    taskId,
    mode,
  });

  return { pid, logPath, branch, worktreePath, mode };
}

/** Kill a running worker process by name. */
export function killWorker(workerName: string): void {
  validatePathSegment(workerName);
  const proc = workerProcesses.get(workerName);
  if (!proc || proc.killed) {
    workerProcesses.delete(workerName);
    workerInfo.delete(workerName);
    workerBudgets.delete(workerName);
    return;
  }
  try {
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!proc.killed) {
        try {
          proc.kill("SIGKILL");
        } catch {}
      }
    }, 5000);
  } catch {}
  workerProcesses.delete(workerName);
  workerInfo.delete(workerName);
  workerBudgets.delete(workerName);
}

/** List all currently running worker processes. */
export function listRunningWorkers(): WorkerProcess[] {
  return Array.from(workerInfo.values());
}

/** Kill all running workers (called when team is stopped). */
function killAllWorkers(): void {
  for (const name of Array.from(workerProcesses.keys())) {
    killWorker(name);
  }
}
