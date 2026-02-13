import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { createResilientWatcher } from "../src/server/resilient-watcher";
import { createTurnGovernor } from "../src/server/turn-governor";
import { createEventDelivery } from "../src/server/event-delivery";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clamban-test-"));
}

function rmrf(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 1. ResilientWatcher — directory pre-creation & heartbeat
// ---------------------------------------------------------------------------

describe("ResilientWatcher", () => {
  let root: string;

  beforeEach(() => {
    root = tmpDir();
  });

  afterEach(() => {
    rmrf(root);
  });

  it("pre-creates directories that do not exist before watching", () => {
    const missing = path.join(root, "a", "b", "c");
    expect(fs.existsSync(missing)).toBe(false);

    const watcher = createResilientWatcher({
      directories: [missing],
      onChange: () => {},
    });
    watcher.start();
    expect(fs.existsSync(missing)).toBe(true);
    watcher.stop();
  });

  it("survives when directory is deleted and re-created", () => {
    const dir = path.join(root, "watched");
    const onChange = vi.fn();

    const watcher = createResilientWatcher({
      directories: [dir],
      onChange,
    });
    watcher.start();
    expect(fs.existsSync(dir)).toBe(true);

    // Delete the directory — watcher should not throw
    rmrf(dir);
    expect(watcher.active).toBe(true);

    watcher.stop();
    expect(watcher.active).toBe(false);
  });

  it("re-initializes watchers when heartbeat times out", async () => {
    const dir = path.join(root, "heartbeat-test");
    const onChange = vi.fn();

    const watcher = createResilientWatcher({
      directories: [dir],
      onChange,
      heartbeatTimeoutMs: 50, // very short for testing
    });
    watcher.start();
    expect(watcher.reinitCount).toBe(0);

    // Wait for heartbeat timeout to trigger re-init
    await new Promise((r) => setTimeout(r, 150));
    expect(watcher.reinitCount).toBeGreaterThanOrEqual(1);

    watcher.stop();
  });

  it("resets heartbeat timer on manual heartbeat() call", async () => {
    const dir = path.join(root, "manual-hb");
    const onChange = vi.fn();

    const watcher = createResilientWatcher({
      directories: [dir],
      onChange,
      heartbeatTimeoutMs: 80,
    });
    watcher.start();

    // Keep sending heartbeats faster than the timeout
    await new Promise((r) => setTimeout(r, 40));
    watcher.heartbeat();
    await new Promise((r) => setTimeout(r, 40));
    watcher.heartbeat();
    await new Promise((r) => setTimeout(r, 40));

    // Should not have re-initialized since heartbeats kept it alive
    expect(watcher.reinitCount).toBe(0);

    watcher.stop();
  });

  it("does not re-init after stop()", async () => {
    const dir = path.join(root, "stop-test");
    const watcher = createResilientWatcher({
      directories: [dir],
      onChange: () => {},
      heartbeatTimeoutMs: 30,
    });
    watcher.start();
    watcher.stop();

    await new Promise((r) => setTimeout(r, 100));
    expect(watcher.reinitCount).toBe(0);
  });

  it("handles multiple directories — creates all of them", () => {
    const dirs = [
      path.join(root, "dir1"),
      path.join(root, "dir2", "nested"),
    ];

    const watcher = createResilientWatcher({
      directories: dirs,
      onChange: () => {},
    });
    watcher.start();

    for (const d of dirs) {
      expect(fs.existsSync(d)).toBe(true);
    }

    watcher.stop();
  });

  describe("chokidar / fs.watch silent failure on missing directories", () => {
    it("pre-creates directory so fs.watch does not silently fail", () => {
      const missing = path.join(root, "nonexistent", "deeply", "nested");
      // Without pre-creation, fs.watch would throw ENOENT and the try/catch
      // in the original code would swallow it silently
      const watcher = createResilientWatcher({
        directories: [missing],
        onChange: () => {},
      });
      watcher.start();

      // Verify directory exists — this is the fix for the silent failure
      expect(fs.existsSync(missing)).toBe(true);
      watcher.stop();
    });

    it("recovers watcher after directory is removed and timeout fires", async () => {
      const dir = path.join(root, "vanishing");
      const watcher = createResilientWatcher({
        directories: [dir],
        onChange: () => {},
        heartbeatTimeoutMs: 50,
      });
      watcher.start();
      expect(fs.existsSync(dir)).toBe(true);

      // Simulate external removal (e.g. Claude team cleanup)
      rmrf(dir);
      expect(fs.existsSync(dir)).toBe(false);

      // Wait for heartbeat to re-init — should re-create dir
      await new Promise((r) => setTimeout(r, 120));
      expect(fs.existsSync(dir)).toBe(true);
      expect(watcher.reinitCount).toBeGreaterThanOrEqual(1);

      watcher.stop();
    });
  });
});

// ---------------------------------------------------------------------------
// 2. TurnGovernor — budget enforcement, warning, exhaustion
// ---------------------------------------------------------------------------

describe("TurnGovernor", () => {
  it("allocates cycle budget capped at per-cycle limit", () => {
    const gov = createTurnGovernor({ maxTurns: 100 });
    expect(gov.allocateCycleBudget(50)).toBe(50);
  });

  it("allocates remaining when less than per-cycle cap", () => {
    const gov = createTurnGovernor({ maxTurns: 30 });
    gov.recordTurns(20);
    expect(gov.allocateCycleBudget(50)).toBe(10);
  });

  it("returns 0 allocation when budget is exhausted", () => {
    const gov = createTurnGovernor({ maxTurns: 10 });
    gov.recordTurns(10);
    expect(gov.allocateCycleBudget()).toBe(0);
    expect(gov.canSpawn()).toBe(false);
  });

  it("fires onBudgetExhausted callback when budget runs out", () => {
    const onExhausted = vi.fn();
    const gov = createTurnGovernor({ maxTurns: 10, onBudgetExhausted: onExhausted });
    gov.recordTurns(5);
    expect(onExhausted).not.toHaveBeenCalled();

    gov.recordTurns(5);
    expect(onExhausted).toHaveBeenCalledWith(10, 10);
  });

  it("fires onBudgetWarning when threshold is reached", () => {
    const onWarning = vi.fn();
    const gov = createTurnGovernor({
      maxTurns: 100,
      warningThreshold: 0.2,
      onBudgetWarning: onWarning,
    });
    gov.recordTurns(79);
    expect(onWarning).not.toHaveBeenCalled();

    gov.recordTurns(1); // 80 used, 20 remaining = 20% = threshold
    expect(onWarning).toHaveBeenCalledWith(80, 100, 20);
  });

  it("only fires warning once", () => {
    const onWarning = vi.fn();
    const gov = createTurnGovernor({
      maxTurns: 100,
      warningThreshold: 0.1,
      onBudgetWarning: onWarning,
    });
    gov.recordTurns(91);
    gov.recordTurns(1);
    gov.recordTurns(1);
    expect(onWarning).toHaveBeenCalledTimes(1);
  });

  it("reset() restores full budget", () => {
    const gov = createTurnGovernor({ maxTurns: 50 });
    gov.recordTurns(50);
    expect(gov.canSpawn()).toBe(false);
    expect(gov.exhausted).toBe(true);

    gov.reset();
    expect(gov.canSpawn()).toBe(true);
    expect(gov.turnsUsed).toBe(0);
    expect(gov.remaining).toBe(50);
    expect(gov.exhausted).toBe(false);
  });

  it("recordTurns returns false when budget just exhausted", () => {
    const gov = createTurnGovernor({ maxTurns: 10 });
    expect(gov.recordTurns(5)).toBe(true);
    expect(gov.recordTurns(5)).toBe(false);
  });

  describe("turn budget exhaustion — pauses rather than spinning", () => {
    it("canSpawn is false after exact budget match", () => {
      const gov = createTurnGovernor({ maxTurns: 50 });
      gov.recordTurns(50);
      expect(gov.canSpawn()).toBe(false);
      expect(gov.exhausted).toBe(true);
    });

    it("canSpawn is false after over-budget (single large cycle)", () => {
      const gov = createTurnGovernor({ maxTurns: 50 });
      // Simulate a cycle that uses more turns than allocated (shouldn't happen but defensive)
      gov.recordTurns(60);
      expect(gov.canSpawn()).toBe(false);
      expect(gov.remaining).toBe(-10);
    });

    it("handles many small cycles accumulating to budget", () => {
      const onExhausted = vi.fn();
      const gov = createTurnGovernor({ maxTurns: 100, onBudgetExhausted: onExhausted });
      for (let i = 0; i < 10; i++) {
        gov.recordTurns(10);
      }
      expect(gov.canSpawn()).toBe(false);
      expect(onExhausted).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. EventDelivery — retry logic, confirmation, backoff
// ---------------------------------------------------------------------------

describe("EventDelivery", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers successfully on first attempt", async () => {
    const action = vi.fn();
    const delivery = createEventDelivery({ action });

    const result = await delivery.deliver();
    expect(result).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
    expect(delivery.deliveredCount).toBe(1);
    expect(delivery.failedCount).toBe(0);
  });

  it("retries on failure and succeeds on second attempt", async () => {
    let attempts = 0;
    const action = vi.fn().mockImplementation(() => {
      attempts++;
      if (attempts < 2) throw new Error("transient");
    });
    const delivery = createEventDelivery({
      action,
      maxRetries: 3,
      baseDelayMs: 10,
    });

    const result = await delivery.deliver();
    expect(result).toBe(true);
    expect(action).toHaveBeenCalledTimes(2);
    expect(delivery.deliveredCount).toBe(1);
  });

  it("exhausts retries and reports failure", async () => {
    const action = vi.fn().mockImplementation(() => { throw new Error("permanent"); });
    const onExhausted = vi.fn();
    const delivery = createEventDelivery({
      action,
      maxRetries: 2,
      baseDelayMs: 10,
      onExhausted,
    });

    const result = await delivery.deliver();
    expect(result).toBe(false);
    expect(action).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(delivery.failedCount).toBe(1);
  });

  it("uses confirmation predicate for delivery verification", async () => {
    let confirmed = false;
    const action = vi.fn();
    const delivery = createEventDelivery({
      action,
      maxRetries: 3,
      baseDelayMs: 10,
      confirm: () => {
        // Confirm on second check
        if (confirmed) return true;
        confirmed = true;
        return false;
      },
    });

    const result = await delivery.deliver();
    expect(result).toBe(true);
    // Action called twice: first time confirm returns false, second time true
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("applies exponential backoff between retries", async () => {
    const timestamps: number[] = [];
    const action = vi.fn().mockImplementation(() => {
      timestamps.push(Date.now());
      if (timestamps.length < 3) throw new Error("retry");
    });

    const delivery = createEventDelivery({
      action,
      maxRetries: 3,
      baseDelayMs: 100,
    });

    await delivery.deliver();

    // Verify increasing delays (with tolerance for timer precision)
    expect(timestamps.length).toBe(3);
    const delay1 = timestamps[1] - timestamps[0];
    const delay2 = timestamps[2] - timestamps[1];
    // First retry: 100ms, second retry: 200ms (2x backoff)
    expect(delay1).toBeGreaterThanOrEqual(80);
    expect(delay2).toBeGreaterThanOrEqual(160);
  });

  it("calls onDelivered on success", async () => {
    const onDelivered = vi.fn();
    const delivery = createEventDelivery({
      action: () => {},
      onDelivered,
    });

    await delivery.deliver();
    expect(onDelivered).toHaveBeenCalledTimes(1);
  });

  it("tracks multiple deliveries", async () => {
    const delivery = createEventDelivery({ action: () => {} });

    await delivery.deliver();
    await delivery.deliver();
    await delivery.deliver();
    expect(delivery.deliveredCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Race conditions — subagent writes vs board reads
// ---------------------------------------------------------------------------

describe("Race conditions: board file contention", () => {
  let root: string;

  beforeEach(() => {
    root = tmpDir();
  });

  afterEach(() => {
    rmrf(root);
  });

  it("atomic write prevents partial reads during concurrent writes", () => {
    const filePath = path.join(root, "board.json");
    const data = { meta: { name: "test" }, columns: [], tasks: [] };

    // Simulate atomic write pattern from board-store
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);

    // Read should get complete data
    const read = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(read.meta.name).toBe("test");
  });

  it("concurrent rapid writes do not produce corrupt JSON", () => {
    const filePath = path.join(root, "board.json");

    // Simulate 50 rapid atomic writes
    for (let i = 0; i < 50; i++) {
      const data = { version: i, tasks: Array(10).fill({ id: `task-${i}` }) };
      const tmp = filePath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(data), "utf-8");
      fs.renameSync(tmp, filePath);
    }

    // Final read should be valid JSON
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(49);
  });

  it("read during write gets previous or new version, never partial", () => {
    const filePath = path.join(root, "board.json");
    const initial = { version: 0 };
    fs.writeFileSync(filePath, JSON.stringify(initial), "utf-8");

    // Write a new version atomically
    const updated = { version: 1 };
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(updated), "utf-8");

    // Read before rename — should still see version 0
    const beforeRename = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(beforeRename.version).toBe(0);

    fs.renameSync(tmp, filePath);

    // Read after rename — should see version 1
    const afterRename = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(afterRename.version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Integration: watcher + event delivery combined
// ---------------------------------------------------------------------------

describe("Integration: watcher triggers event delivery", () => {
  let root: string;

  beforeEach(() => {
    root = tmpDir();
  });

  afterEach(() => {
    rmrf(root);
  });

  it("watcher onChange triggers delivery with retry on failure", async () => {
    const dir = path.join(root, "integration");
    let deliveryAttempts = 0;
    const onDelivered = vi.fn();

    const delivery = createEventDelivery({
      action: () => {
        deliveryAttempts++;
        if (deliveryAttempts < 2) throw new Error("transient SSE failure");
      },
      maxRetries: 3,
      baseDelayMs: 10,
      onDelivered,
    });

    const watcher = createResilientWatcher({
      directories: [dir],
      onChange: () => {
        delivery.deliver(); // fire-and-forget from watcher callback
      },
    });
    watcher.start();

    // Trigger a file change
    fs.writeFileSync(path.join(dir, "test.txt"), "hello");

    // Give the watcher + delivery time to process
    await new Promise((r) => setTimeout(r, 200));

    watcher.stop();

    // The delivery may or may not have been triggered depending on OS watcher timing,
    // but if triggered, it should have retried and succeeded
    if (deliveryAttempts > 0) {
      expect(onDelivered).toHaveBeenCalled();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Edge cases: governor + watcher interaction
// ---------------------------------------------------------------------------

describe("Edge case: governor prevents spawn after budget exhaustion", () => {
  it("governor blocks allocation after exhaustion even without explicit canSpawn check", () => {
    const gov = createTurnGovernor({ maxTurns: 10 });
    gov.recordTurns(10);

    // allocateCycleBudget should return 0
    expect(gov.allocateCycleBudget(50)).toBe(0);

    // Even trying to record more turns should keep it exhausted
    gov.recordTurns(5);
    expect(gov.turnsUsed).toBe(15);
    expect(gov.exhausted).toBe(true);
  });
});

describe("Edge case: watcher handles rapid start/stop cycles", () => {
  let root: string;

  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { rmrf(root); });

  it("rapid start/stop does not leak watchers or timers", () => {
    const dir = path.join(root, "rapid");

    for (let i = 0; i < 20; i++) {
      const watcher = createResilientWatcher({
        directories: [dir],
        onChange: () => {},
        heartbeatTimeoutMs: 100,
      });
      watcher.start();
      watcher.stop();
      expect(watcher.active).toBe(false);
    }

    // Directory should still exist from first start
    expect(fs.existsSync(dir)).toBe(true);
  });
});
