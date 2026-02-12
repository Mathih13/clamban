export interface TurnGovernorOptions {
  maxTurns: number;
  /** Called when budget is exhausted — receives turns used and max */
  onBudgetExhausted?: (used: number, max: number) => void;
  /** Called when budget drops below this percentage (0-1). Default: 0.1 */
  warningThreshold?: number;
  /** Called when warning threshold is reached */
  onBudgetWarning?: (used: number, max: number, remaining: number) => void;
}

export interface TurnGovernor {
  /** Record turns consumed by a cycle. Returns false if budget is now exhausted. */
  recordTurns(count: number): boolean;
  /** Get a safe per-cycle allocation (capped at perCycleCap, clamped to remaining) */
  allocateCycleBudget(perCycleCap?: number): number;
  /** Check if more cycles can run */
  canSpawn(): boolean;
  /** Reset the governor (e.g. on fresh team start) */
  reset(): void;
  readonly turnsUsed: number;
  readonly maxTurns: number;
  readonly remaining: number;
  /** Whether the governor has paused the team due to budget exhaustion */
  readonly exhausted: boolean;
}

export function createTurnGovernor(options: TurnGovernorOptions): TurnGovernor {
  const { maxTurns, onBudgetExhausted, warningThreshold = 0.1, onBudgetWarning } = options;

  let turnsUsed = 0;
  let exhausted = false;
  let warningFired = false;

  function checkWarning(): void {
    if (warningFired || !onBudgetWarning) return;
    const remaining = maxTurns - turnsUsed;
    if (remaining / maxTurns <= warningThreshold) {
      warningFired = true;
      onBudgetWarning(turnsUsed, maxTurns, remaining);
    }
  }

  return {
    recordTurns(count: number): boolean {
      turnsUsed += count;
      checkWarning();
      if (turnsUsed >= maxTurns) {
        exhausted = true;
        onBudgetExhausted?.(turnsUsed, maxTurns);
        return false;
      }
      return true;
    },

    allocateCycleBudget(perCycleCap = 50): number {
      const remaining = maxTurns - turnsUsed;
      if (remaining <= 0) return 0;
      return Math.min(perCycleCap, remaining);
    },

    canSpawn(): boolean {
      return !exhausted && turnsUsed < maxTurns;
    },

    reset(): void {
      turnsUsed = 0;
      exhausted = false;
      warningFired = false;
    },

    get turnsUsed() { return turnsUsed; },
    get maxTurns() { return maxTurns; },
    get remaining() { return maxTurns - turnsUsed; },
    get exhausted() { return exhausted; },
  };
}
