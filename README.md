# Clamban

A Kanban board that runs a Claude Code agent team to autonomously triage, assign, and execute software development tasks.

Clamban combines the AI-driven task decomposition of [Ralphing](https://www.reddit.com/r/ClaudeAI/comments/1kwiqai/introducing_the_ralph_loop/) with a Kanban-style workflow: a team lead agent continuously monitors the board, prioritizes backlog tasks, assigns them to worker agents, and moves cards through columns — while humans retain full visibility and control.

The key insight: by scoping context to individual tasks and using comments, file references, and task relationships as breadcrumbs, each agent gets a "Goldilocks zone" of context — enough to work effectively without hallucinating changes you never asked for. This enables longer, more reliable AI development sessions.

<!-- TODO: screenshot or demo GIF -->

## Prerequisites

- **Node.js** 18+
- **Claude Code CLI** installed and authenticated (`claude` command available)
- An existing **Claude team** in `~/.claude/teams/` (teams is an [experimental feature](https://code.claude.com/docs/en/agent-teams))

## Getting Started

```bash
git clone https://github.com/Mathih13/clamban.git
cd clamban
npm install
npm run dev
```

Open the URL shown in your terminal (default: `http://localhost:5173`).

> **Note:** Clamban currently runs in Vite dev mode only — there is no standalone production server yet.

## How It Works

**Frontend** — React 19 with shadcn/ui components, Tailwind CSS, and @dnd-kit for drag-and-drop. The board updates in real-time via Server-Sent Events (SSE).

**Backend** — The API runs as a Vite plugin (no separate server process). All `/api/*` requests are handled by middleware during development.

**Agent orchestration** — When you connect a team and hit Start, Clamban spawns a `claude` CLI process as the team lead. This agent reads the board state via the HTTP API, triages tasks, spawns worker agents, and writes results back — creating a shared collaboration loop between humans and AI.

The Claude CLI is spawned with `--dangerously-skip-permissions`, which allows it to execute code, run commands, and modify files without confirmation prompts. **This flag is required because the CLI runs in non-interactive pipe mode — there is no terminal for a user to approve permission prompts, so without it the agent would hang on the first tool call.** This means the agents can take any action on your system. Run Clamban in an environment where you're comfortable with that (e.g., a container or VM for untrusted workloads).

## Data Storage

All data lives in `~/.clamban/`:

```
~/.clamban/
├── board.json              # Default board (when no team connected)
├── boards/
│   └── <team-name>.json    # Per-team board state
├── team-state.json         # Team process state
└── logs/
    └── <team-name>.log     # Agent output logs
```

## Configuration

1. **Connect a team** — Select a team from `~/.claude/teams/` and provide the project directory path
2. **Model** — Choose which Claude model the team lead uses (e.g., `sonnet`, `opus`)
3. **Max turns** — Limit how many agentic turns the team lead can take per session before stopping

## Development

```bash
npm run dev       # Start dev server
npm run build     # Type-check + production build
npm run lint      # ESLint
npm run preview   # Preview production build
```

## License

[MIT](LICENSE)
