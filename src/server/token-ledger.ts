/**
 * Token accounting for Clamban orchestration.
 *
 * Records per-invocation token usage from stream-json result events and
 * partitions consumption into "useful work" vs "orchestration overhead"
 * for comparison against the baseline of running N independent terminals.
 */

export interface TokenEntry {
  timestamp: string;
  role: "lead" | "worker";
  taskId?: string;
  workerName?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  turns: number;
  cycleReason?: string;
}

export interface TaskCost {
  taskId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCostUsd: number;
  totalTurns: number;
  breakdown: TokenEntry[];
}

export interface SessionSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCostUsd: number;
  totalTurns: number;
  entryCount: number;
  leadOverhead: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    turns: number;
    cycleCount: number;
  };
  workerWork: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    turns: number;
  };
  overheadRatio: number;
  perTask: TaskCost[];
}

export interface TokenLedger {
  record(entry: TokenEntry): void;
  getTaskCost(taskId: string): TaskCost | null;
  getSessionSummary(): SessionSummary;
  reset(): void;
}

export function createTokenLedger(): TokenLedger {
  let entries: TokenEntry[] = [];

  return {
    record(entry: TokenEntry): void {
      entries.push(entry);
    },

    getTaskCost(taskId: string): TaskCost | null {
      const taskEntries = entries.filter((e) => e.taskId === taskId);
      if (taskEntries.length === 0) return null;
      return {
        taskId,
        totalInputTokens: sum(taskEntries, "inputTokens"),
        totalOutputTokens: sum(taskEntries, "outputTokens"),
        totalCacheReadTokens: sum(taskEntries, "cacheReadTokens"),
        totalCostUsd: sum(taskEntries, "costUsd"),
        totalTurns: sum(taskEntries, "turns"),
        breakdown: taskEntries,
      };
    },

    getSessionSummary(): SessionSummary {
      const leadEntries = entries.filter((e) => e.role === "lead");
      const workerEntries = entries.filter((e) => e.role !== "lead");

      const totalInput = sum(entries, "inputTokens");
      const totalOutput = sum(entries, "outputTokens");
      const leadInput = sum(leadEntries, "inputTokens");
      const leadOutput = sum(leadEntries, "outputTokens");
      const leadCost = sum(leadEntries, "costUsd");
      const totalCost = sum(entries, "costUsd");

      // Group worker entries by taskId for per-task breakdown
      const taskIds = new Set(entries.filter((e) => e.taskId).map((e) => e.taskId!));
      const perTask: TaskCost[] = [];
      for (const taskId of taskIds) {
        const taskEntries = entries.filter((e) => e.taskId === taskId);
        perTask.push({
          taskId,
          totalInputTokens: sum(taskEntries, "inputTokens"),
          totalOutputTokens: sum(taskEntries, "outputTokens"),
          totalCacheReadTokens: sum(taskEntries, "cacheReadTokens"),
          totalCostUsd: sum(taskEntries, "costUsd"),
          totalTurns: sum(taskEntries, "turns"),
          breakdown: taskEntries,
        });
      }

      return {
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        totalCacheReadTokens: sum(entries, "cacheReadTokens"),
        totalCostUsd: totalCost,
        totalTurns: sum(entries, "turns"),
        entryCount: entries.length,
        leadOverhead: {
          inputTokens: leadInput,
          outputTokens: leadOutput,
          costUsd: leadCost,
          turns: sum(leadEntries, "turns"),
          cycleCount: leadEntries.length,
        },
        workerWork: {
          inputTokens: sum(workerEntries, "inputTokens"),
          outputTokens: sum(workerEntries, "outputTokens"),
          costUsd: sum(workerEntries, "costUsd"),
          turns: sum(workerEntries, "turns"),
        },
        overheadRatio: totalCost > 0 ? leadCost / totalCost : 0,
        perTask,
      };
    },

    reset(): void {
      entries = [];
    },
  };
}

function sum(entries: TokenEntry[], key: keyof TokenEntry): number {
  return entries.reduce((acc, e) => acc + (typeof e[key] === "number" ? (e[key] as number) : 0), 0);
}
