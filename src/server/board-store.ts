import fs from "fs";
import path from "path";
import type { Board } from "../types/board";

const CLAMBAN_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".clamban"
);
const BOARDS_DIR = path.join(CLAMBAN_DIR, "boards");
const ACTIVE_TEAM_PATH = path.join(CLAMBAN_DIR, "active-team.json");
const FALLBACK_BOARD_PATH = path.join(CLAMBAN_DIR, "board.json");

let activeTeamName: string | null = null;

// Restore active team from disk on module load
try {
  if (fs.existsSync(ACTIVE_TEAM_PATH)) {
    const data = JSON.parse(fs.readFileSync(ACTIVE_TEAM_PATH, "utf-8"));
    activeTeamName = data.teamName ?? null;
  }
} catch {}

export function setActiveTeam(name: string | null): void {
  activeTeamName = name;
  if (!fs.existsSync(CLAMBAN_DIR)) {
    fs.mkdirSync(CLAMBAN_DIR, { recursive: true });
  }
  fs.writeFileSync(
    ACTIVE_TEAM_PATH,
    JSON.stringify({ teamName: name }),
    "utf-8"
  );
}

export function getActiveTeam(): string | null {
  return activeTeamName;
}

function defaultBoard(): Board {
  return {
    meta: {
      name: "My Board",
      createdAt: new Date().toISOString(),
      version: 1,
    },
    columns: [
      { id: "backlog", name: "Backlog" },
      { id: "ready", name: "Ready" },
      { id: "in-progress", name: "In Progress" },
      { id: "review", name: "Review" },
      { id: "done", name: "Done" },
    ],
    tasks: [],
  };
}

export function getBoardPath(): string {
  if (activeTeamName) {
    return path.join(BOARDS_DIR, `${activeTeamName}.json`);
  }
  return FALLBACK_BOARD_PATH;
}

export function readBoard(): Board {
  const boardPath = getBoardPath();
  const boardDir = path.dirname(boardPath);
  if (!fs.existsSync(boardDir)) {
    fs.mkdirSync(boardDir, { recursive: true });
  }
  if (!fs.existsSync(boardPath)) {
    const board = defaultBoard();
    writeBoardSync(board);
    return board;
  }
  const raw = fs.readFileSync(boardPath, "utf-8");
  return JSON.parse(raw) as Board;
}

export function writeBoardSync(board: Board): void {
  const boardPath = getBoardPath();
  const boardDir = path.dirname(boardPath);
  if (!fs.existsSync(boardDir)) {
    fs.mkdirSync(boardDir, { recursive: true });
  }
  const tmp = boardPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(board, null, 2), "utf-8");
  fs.renameSync(tmp, boardPath);
}
