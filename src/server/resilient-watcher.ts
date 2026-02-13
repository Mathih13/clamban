import fs from "fs";
import path from "path";

export interface WatcherOptions {
  /** Directories to ensure exist before watching */
  directories: string[];
  /** Callback when any watched path changes */
  onChange: (dir: string) => void;
  /** Heartbeat timeout in ms — re-init watchers if no events arrive within this window. 0 = disabled. */
  heartbeatTimeoutMs?: number;
  /** Whether to watch recursively (for subdirectories like inboxes/) */
  recursive?: boolean;
}

export interface ResilientWatcher {
  /** Start watching (pre-creates dirs, sets up watchers + heartbeat) */
  start(): void;
  /** Stop all watchers and timers */
  stop(): void;
  /** Notify the watcher that an event was received externally (resets heartbeat) */
  heartbeat(): void;
  /** True if watchers are currently active */
  readonly active: boolean;
  /** Number of times watchers have been re-initialized due to heartbeat timeout */
  readonly reinitCount: number;
}

export function createResilientWatcher(options: WatcherOptions): ResilientWatcher {
  const {
    directories,
    onChange,
    heartbeatTimeoutMs = 0,
    recursive = false,
  } = options;

  let watchers: fs.FSWatcher[] = [];
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let isActive = false;
  let _reinitCount = 0;

  function ensureDirectories(): void {
    for (const dir of directories) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /** Collect all subdirectories under `root` (including `root` itself) */
  function walkDirs(root: string): string[] {
    const result = [root];
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          result.push(...walkDirs(path.join(root, entry.name)));
        }
      }
    } catch { /* dir may have vanished */ }
    return result;
  }

  function watchCallback(dir: string): void {
    resetHeartbeat();
    try {
      onChange(dir);
    } catch {
      // Prevent unhandled exceptions from crashing the process
    }
  }

  function watchSingle(dir: string, useRecursive: boolean): void {
    try {
      const w = fs.watch(dir, { persistent: false, recursive: useRecursive }, () => {
        watchCallback(dir);
      });
      w.on("error", () => {
        // Watcher died — will be recovered by heartbeat
      });
      watchers.push(w);
    } catch {
      // Directory might have vanished between ensureDir and watch
    }
  }

  function initWatchers(): void {
    teardownWatchers();

    // Linux inotify does not support recursive fs.watch — watch each subdir individually
    const needsManualRecursion = recursive && process.platform === "linux";

    for (const dir of directories) {
      if (needsManualRecursion) {
        for (const subdir of walkDirs(dir)) {
          watchSingle(subdir, false);
        }
      } else {
        watchSingle(dir, recursive);
      }
    }
  }

  function teardownWatchers(): void {
    for (const w of watchers) {
      try { w.close(); } catch { /* watcher already closed */ }
    }
    watchers = [];
  }

  function resetHeartbeat(): void {
    if (heartbeatTimeoutMs <= 0 || !isActive) return;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(() => {
      if (!isActive) return;
      _reinitCount++;
      ensureDirectories();
      initWatchers();
      resetHeartbeat();
    }, heartbeatTimeoutMs);
  }

  return {
    start() {
      isActive = true;
      _reinitCount = 0;
      ensureDirectories();
      initWatchers();
      resetHeartbeat();
    },

    stop() {
      isActive = false;
      teardownWatchers();
      if (heartbeatTimer) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      }
    },

    heartbeat() {
      resetHeartbeat();
    },

    get active() {
      return isActive;
    },

    get reinitCount() {
      return _reinitCount;
    },
  };
}
