/**
 * DOM Config's run state, outside React so a run survives the card
 * collapsing or re-mounting. Memory only (D12): nothing is written to
 * storage. The tab is fixed when a run starts; switching tabs never
 * redirects it.
 */
import {
  buildReportFromCapture,
  DOM_CONFIG_DEFAULT_MAX_PAGES,
  DOM_CONFIG_DEFAULT_MAX_TOTAL_MS,
  DOM_CONFIG_DEFAULT_RUNS_PER_STATE,
  type DomConfigCaptureOutcome,
  type DomConfigCaptureProgress,
  type DomConfigReport,
  type DomConfigRunLabel,
  runDomConfigCapture,
} from "@apty/browser-runtime/apty/dom-config/index";
import { useSyncExternalStore } from "react";
import { acquireTabLock, releaseTabLock } from "./tab-lock";

export type DomConfigScope = "page" | "application-safe" | "application-deep";

export interface DomConfigStartOptions {
  scope: DomConfigScope;
  runsPerState: 2 | 3 | 4;
  probe: boolean;
  maxPages: number;
  maxMinutes: number;
}

const DEFAULT_START_OPTIONS: DomConfigStartOptions = {
  scope: "application-safe",
  runsPerState: DOM_CONFIG_DEFAULT_RUNS_PER_STATE as 2,
  probe: true,
  maxPages: DOM_CONFIG_DEFAULT_MAX_PAGES,
  maxMinutes: DOM_CONFIG_DEFAULT_MAX_TOTAL_MS / 60_000,
};

type DomConfigPhase = "idle" | "running" | "stopping" | "report" | "failed";

export type DomConfigStep = "discover" | "capture" | "analyze" | "report";

export type RunChipState =
  | "pending"
  | "running"
  | "done"
  | "mismatch"
  | "failed";

export interface PageRow {
  key: string;
  urlShape: string;
  runs: { label: DomConfigRunLabel; state: RunChipState }[];
  elementCount: number | null;
  status: DomConfigReport["pages"][number]["status"] | null;
}

export type CompletedCapture = Extract<
  DomConfigCaptureOutcome,
  { available: true }
>;

export interface DomConfigState {
  phase: DomConfigPhase;
  expanded: boolean;
  /** Bumped when something outside the card asks to show it. */
  revealRequest: number;
  tabId: number | null;
  options: DomConfigStartOptions;
  step: DomConfigStep;
  rows: PageRow[];
  current: DomConfigCaptureProgress | null;
  outcome: CompletedCapture | null;
  /** The analysis shown: the outcome's, or a re-run of it. */
  report: DomConfigReport | null;
  error: string | null;
  /** Explicit include/exclude choices, by rule id. */
  ruleChoices: Record<string, boolean>;
  includeReview: boolean;
  includeRecordSpecific: boolean;
}

type StartResult = "started" | "busy" | "locked";

const INITIAL: DomConfigState = {
  phase: "idle",
  expanded: false,
  revealRequest: 0,
  tabId: null,
  options: DEFAULT_START_OPTIONS,
  step: "discover",
  rows: [],
  current: null,
  outcome: null,
  report: null,
  error: null,
  ruleChoices: {},
  includeReview: false,
  includeRecordSpecific: false,
};

function runLabelsFor(count: number): DomConfigRunLabel[] {
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? "initial" : i === 1 ? "after-reload" : "repeat",
  );
}

function progressRows(
  rows: PageRow[],
  progress: DomConfigCaptureProgress,
): PageRow[] {
  if (progress.phase !== "capturing") return rows;
  const index = progress.stateIndex - 1;
  const next = rows.map((row, i) =>
    i < index
      ? {
          ...row,
          runs: row.runs.map((run) =>
            run.state === "pending" ? run : { ...run, state: "done" as const },
          ),
        }
      : row,
  );
  const labels = runLabelsFor(progress.runCount);
  next[index] = {
    key: String(progress.stateIndex),
    urlShape: progress.urlShape,
    elementCount: null,
    status: null,
    runs: labels.map((label, i) => ({
      label,
      state:
        i + 1 < progress.runIndex
          ? "done"
          : i + 1 === progress.runIndex
            ? "running"
            : "pending",
    })),
  };
  return next;
}

function stepOf(
  step: DomConfigStep,
  progress: DomConfigCaptureProgress,
): DomConfigStep {
  if (progress.phase === "analyzing") return "analyze";
  if (progress.phase === "discovering") {
    return step === "discover" ? "discover" : step;
  }
  return "capture";
}

/** Rows as the outcome knows them: visit order, a chip per run taken, mismatched and failed runs marked. */
function outcomeRows(outcome: CompletedCapture): PageRow[] {
  const summaries = new Map(outcome.report.pages.map((p) => [p.pageId, p]));
  return outcome.states.map((state) => {
    const summary = summaries.get(state.pageId);
    const counts = (summary?.runs ?? []).map((r) => r.elementCount);
    return {
      key: state.pageId,
      urlShape: state.pageId,
      elementCount: counts.length ? Math.max(...counts) : null,
      status: summary?.status ?? null,
      runs: [
        ...state.runs.map((run) => ({
          label: run.meta.label,
          state: run.meta.stateMismatch
            ? ("mismatch" as const)
            : ("done" as const),
        })),
        ...state.failedRuns.map((run) => ({
          label: run.runLabel,
          state: "failed" as const,
        })),
      ],
    };
  });
}

export function createDomConfigStore() {
  let state = INITIAL;
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<DomConfigState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setExpanded: (expanded: boolean) => set({ expanded }),
    reveal: () =>
      set({ expanded: true, revealRequest: state.revealRequest + 1 }),
    setOptions: (options: Partial<DomConfigStartOptions>) =>
      set({ options: { ...state.options, ...options } }),
    setRuleChoice: (ruleId: string, included: boolean) =>
      set({ ruleChoices: { ...state.ruleChoices, [ruleId]: included } }),
    setIncludeReview: (includeReview: boolean) => set({ includeReview }),
    setIncludeRecordSpecific: (includeRecordSpecific: boolean) =>
      set({ includeRecordSpecific }),

    async start(
      tabId: number,
      ignoredRoots: readonly string[] = [],
    ): Promise<StartResult> {
      if (state.phase === "running" || state.phase === "stopping") {
        return "busy";
      }
      if (!acquireTabLock(tabId, "dom-config")) return "locked";
      controller = new AbortController();
      const { options } = state;
      set({
        ...INITIAL,
        expanded: true,
        revealRequest: state.revealRequest,
        options,
        phase: "running",
        tabId,
      });
      let outcome: DomConfigCaptureOutcome;
      try {
        outcome = await runDomConfigCapture(tabId, {
          discoveryMode:
            options.scope === "application-deep"
              ? "application-deep"
              : "application-safe",
          maxPages: options.scope === "page" ? 1 : options.maxPages,
          maxTotalMs: options.maxMinutes * 60_000,
          runsPerState: options.runsPerState,
          probe: options.probe,
          ignoredRoots,
          report: { ignoredRoots },
          signal: controller.signal,
          onProgress: (progress) =>
            set({
              current: progress,
              step: stepOf(state.step, progress),
              rows: progressRows(state.rows, progress),
            }),
        });
      } catch (error) {
        outcome = {
          available: false,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        controller = null;
        releaseTabLock(tabId, "dom-config");
      }
      if (outcome.available) {
        set({
          phase: "report",
          step: "report",
          current: null,
          outcome,
          report: outcome.report,
          rows: outcomeRows(outcome),
        });
      } else {
        set({ phase: "failed", current: null, error: outcome.error });
      }
      return "started";
    },

    stop() {
      if (state.phase !== "running" || !controller) return;
      controller.abort();
      set({ phase: "stopping" });
    },

    rerun(ignoredRoots: readonly string[] = []) {
      if (!state.outcome) return;
      set({
        report: buildReportFromCapture(state.outcome.capture, { ignoredRoots })
          .report,
      });
    },

    clear() {
      if (state.phase === "running" || state.phase === "stopping") return;
      set({
        ...INITIAL,
        expanded: state.expanded,
        revealRequest: state.revealRequest,
        options: state.options,
      });
    },
  };
}

export type DomConfigStore = ReturnType<typeof createDomConfigStore>;

export const domConfigStore = createDomConfigStore();

export function useDomConfigState(
  store: DomConfigStore = domConfigStore,
): DomConfigState {
  return useSyncExternalStore(store.subscribe, store.getState);
}

/** Opens the DOM Config card, from the welcome screen's tile. */
export function revealDomConfigCard(): void {
  domConfigStore.reveal();
}
