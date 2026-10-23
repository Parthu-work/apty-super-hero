/**
 * The time and size budget a DOM collector runs under: element and
 * shadow-root ceilings, a time budget below the 8 s per-frame message
 * timeout, and a slice clock that yields to the page every `sliceMs`.
 * Shared by the DOM Health and DOM Config collectors.
 */
/**
 * Per-frame budget (DOM Health brief, section 4.11). The Infor LN top
 * document, the largest measured, has 3,788 elements and 251 shadow
 * roots; the element and root ceilings sit an order of magnitude above it
 * so they only stop a runaway page. The time budget stays below the
 * service worker's 8 s per-frame message timeout, so a slow frame returns
 * a partial, labelled result instead of nothing. The 16 ms slice is one
 * frame at 60 Hz: the collector yields to the page at least that often.
 * None of these was tuned on a live tenant.
 */
export const DEFAULT_COLLECTOR_BUDGET = {
  maxTotalElements: 50_000,
  maxShadowRoots: 2_500,
  timeBudgetMs: 6_000,
  sliceMs: 16,
} as const;

export interface CollectorBudgetOptions {
  maxTotalElements?: number;
  maxShadowRoots?: number;
  timeBudgetMs?: number;
  sliceMs?: number;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Ceilings, the time budget and the slice clock for one collection. */
export interface CollectorBudget {
  maxTotalElements: number;
  maxShadowRoots: number;
  timeBudgetMs: number;
  startedAt: number;
  /** True once the time budget is spent: nothing further is traversed or analyzed. */
  expired: boolean;
  /** Why the result is partial, for the report. */
  reasons: string[];
  longestSliceMs: number;
  /** Longest single unit of work between two clock checks: the floor on how long a slice can be. */
  longestStepMs: number;
  yields: number;
  note(reason: string): void;
  /** Yield to the page once the current slice is used up; true once the time budget is spent. */
  tick(): Promise<boolean>;
  /** Close the last slice, so `longestSliceMs` covers the whole run. */
  finish(): void;
}

export function createBudget(
  options: CollectorBudgetOptions = {},
): CollectorBudget {
  const sliceMs = options.sliceMs ?? DEFAULT_COLLECTOR_BUDGET.sliceMs;
  const startedAt = now();
  let sliceStart = startedAt;
  let lastCheck = startedAt;
  const closeSlice = (at: number) => {
    budget.longestSliceMs = Math.max(budget.longestSliceMs, at - sliceStart);
  };
  const budget: CollectorBudget = {
    maxTotalElements:
      options.maxTotalElements ?? DEFAULT_COLLECTOR_BUDGET.maxTotalElements,
    maxShadowRoots:
      options.maxShadowRoots ?? DEFAULT_COLLECTOR_BUDGET.maxShadowRoots,
    timeBudgetMs: options.timeBudgetMs ?? DEFAULT_COLLECTOR_BUDGET.timeBudgetMs,
    startedAt,
    expired: false,
    reasons: [],
    longestSliceMs: 0,
    longestStepMs: 0,
    yields: 0,
    note(reason) {
      if (!budget.reasons.includes(reason)) budget.reasons.push(reason);
    },
    async tick() {
      if (budget.expired) return true;
      const t = now();
      budget.longestStepMs = Math.max(budget.longestStepMs, t - lastCheck);
      lastCheck = t;
      if (t - startedAt > budget.timeBudgetMs) {
        budget.expired = true;
        budget.note(
          `Time budget of ${budget.timeBudgetMs} ms reached; the rest of this frame was not analyzed.`,
        );
        return true;
      }
      if (t - sliceStart >= sliceMs) {
        closeSlice(t);
        budget.yields++;
        await yieldToEventLoop();
        sliceStart = now();
        lastCheck = sliceStart;
      }
      return false;
    },
    finish() {
      const t = now();
      budget.longestStepMs = Math.max(budget.longestStepMs, t - lastCheck);
      closeSlice(t);
    },
  };
  return budget;
}
