import type { Plugin } from "vite";
import type { ServerResponse } from "http";
import { handleRoute, onTeamChanged, setServerPort } from "./routes";
import { getBoardPath, readBoard } from "./board-store";
import { getTeamConfigDir, getTeamInboxDir, notifyBoardChanged } from "./team-manager";
import { createResilientWatcher, type ResilientWatcher } from "./resilient-watcher";

export function apiPlugin(): Plugin {
  const sseClients = new Set<ServerResponse>();
  let configWatcher: ResilientWatcher | null = null;
  let inboxWatcher: ResilientWatcher | null = null;
  let currentTeamName: string | null = null;
  let watchedBoardPath: string | null = null;

  function broadcast(event: { type: string }) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      client.write(data);
    }
  }

  function teardownTeamWatchers() {
    configWatcher?.stop();
    inboxWatcher?.stop();
    configWatcher = null;
    inboxWatcher = null;
    currentTeamName = null;
  }

  function setupTeamWatchers(teamName: string) {
    if (currentTeamName === teamName) return;
    teardownTeamWatchers();
    currentTeamName = teamName;

    const configDir = getTeamConfigDir(teamName);
    const inboxDir = getTeamInboxDir(teamName);

    // Resilient config directory watcher — pre-creates dir, has heartbeat recovery
    configWatcher = createResilientWatcher({
      directories: [configDir],
      onChange: () => broadcast({ type: "team-changed" }),
      heartbeatTimeoutMs: 60_000,
    });
    configWatcher.start();

    // Resilient inbox watcher — pre-creates dir, recursive, has heartbeat recovery
    inboxWatcher = createResilientWatcher({
      directories: [inboxDir],
      onChange: () => broadcast({ type: "team-changed" }),
      heartbeatTimeoutMs: 60_000,
      recursive: true,
    });
    inboxWatcher.start();
  }

  function syncTeamWatchers() {
    const board = readBoard();
    if (board.meta.team) {
      setupTeamWatchers(board.meta.team.teamName);
    } else {
      teardownTeamWatchers();
    }
  }

  return {
    name: "clamban-api",
    configureServer(server) {
      function updateBoardWatcher() {
        const newPath = getBoardPath();
        if (newPath === watchedBoardPath) return;
        if (watchedBoardPath) {
          server.watcher.unwatch(watchedBoardPath);
        }
        watchedBoardPath = newPath;
        // Ensure the board file (and parent dir) exist before watching —
        // chokidar silently fails if the parent directory doesn't exist yet
        readBoard();
        server.watcher.add(newPath);
      }

      // Watch initial board path for external changes
      updateBoardWatcher();
      server.watcher.on("change", (changedPath) => {
        if (changedPath === watchedBoardPath) {
          broadcast({ type: "board-changed" });
          notifyBoardChanged();
        }
      });

      // Register team-changed callback from routes
      onTeamChanged(() => {
        updateBoardWatcher();
        broadcast({ type: "team-changed" });
        syncTeamWatchers();
      });

      // Initial team watcher setup
      syncTeamWatchers();

      // Pass server port to routes once httpServer is listening
      server.httpServer?.on("listening", () => {
        const addr = server.httpServer?.address();
        if (addr && typeof addr === "object") {
          setServerPort(addr.port);
        }
      });

      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "";

        if (!url.startsWith("/api/")) {
          return next();
        }

        // SSE endpoint
        if (req.method === "GET" && url === "/api/events") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
          sseClients.add(res);

          req.on("close", () => {
            sseClients.delete(res);
          });
          return;
        }

        try {
          const handled = await handleRoute(req, res);
          if (!handled) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
          }
        } catch (err) {
          console.error("API error:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" })
          );
        }
      });
    },
  };
}
