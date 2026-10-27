/**
 * DOM Config's run state, outside React so a run survives leaving its
 * page. Memory only (D12): nothing is written to storage. One capture is
 * held: the crawl's, and the manual and imported
 * pages added to it; the report is always the analysis of that capture.
 * The crawl's tab is fixed when it starts; switching tabs never redirects
 * it.
 */
import {
  buildPageCapture,
  buildReportFromCapture,
  captureCurrentState,
  DOM_CONFIG_DEFAULT_MAX_PAGES,
  DOM_CONFIG_DEFAULT_MAX_TOTAL_MS,
  DOM_CONFIG_DEFAULT_RUNS_PER_STATE,
  DOM_CONFIG_LIMITS,
  type DomConfigApplicationCapture,
  type DomConfigCaptureOutcome,
  type DomConfigCaptureProgress,
  type DomConfigImportedRun,
  type DomConfigReport,
  type DomConfigReportOptions,
  type DomConfigRun,
  type DomConfigRunLabel,
  type DomProfileImportError,
  runDomConfigCapture,
} from "@apty/browser-runtime/apty/dom-config/index";
import { useSyncExternalStore } from "react";
import {
  type NavigationOrigin,
  navigationStore,
} from "../../../state/navigation-store";
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

export type RunChipState =
  | "pending"
  | "running"
  | "done"
  | "mismatch"
  | "failed";

export type PageOrigin = "crawl" | "manual" | "import";

export interface PageRow {
  key: string;
  /** The URL shape for a crawled page, the SE's name otherwise. */
  label: string;
  origin: PageOrigin;
  runs: { label: DomConfigRunLabel; state: RunChipState }[];
  elementCount: number | null;
  status: DomConfigReport["pages"][number]["status"] | null;
}

type CapturingProgress = Extract<
  DomConfigCaptureProgress,
  { phase: "capturing" }
>;

export type CompletedCapture = Extract<
  DomConfigCaptureOutcome,
  { available: true }
>;

export type CoverageMarks = NonNullable<DomConfigReportOptions["coverage"]>;
export type CoverageKey = DomConfigReport["coverage"]["items"][number]["key"];
export type CoverageMark = NonNullable<CoverageMarks[CoverageKey]>;

export type ManualCaptureResult =
  | {
      ok: true;
      pageLabel: string;
      runCount: number;
      /** Other pages holding a run of the same state. */
      duplicates: string[];
    }
  | { ok: false; error: string };

export interface ImportResult {
  pageLabel: string;
  added: number;
  /** Valid runs left out because the page reached the run limit. */
  dropped: number;
  errors: { run: number; error: DomProfileImportError }[];
}

export interface DomConfigState {
  phase: DomConfigPhase;
  tabId: number | null;
  options: DomConfigStartOptions;
  rows: PageRow[];
  current: DomConfigCaptureProgress | null;
  /** The last crawl's own result; null when the capture holds no crawl. */
  outcome: CompletedCapture | null;
  capture: DomConfigApplicationCapture | null;
  /** The SE's coverage statements; the engine does not verify them. */
  coverageMarks: CoverageMarks;
  report: DomConfigReport | null;
  error: string | null;
  /** A manual capture is reading the tab. */
  capturing: boolean;
  manualResult: ManualCaptureResult | null;
  importResult: ImportResult | null;
  /** Set by "Capture another run" until manual capture takes the page name. */
  captureRequest: { pageName: string } | null;
  /** Explicit include/exclude choices, by rule id. */
  ruleChoices: Record<string, boolean>;
  includeReview: boolean;
  includeRecordSpecific: boolean;
  /** When the crawl started, while it runs. */
  startedAt: number | null;
  /** The last page the crawl captured, kept while it discovers or revisits between pages. */
  lastCapture: CapturingProgress | null;
  /** How long the held crawl took; null when the capture holds no crawl. */
  crawlMs: number | null;
  /** The options the held crawl ran with; null when the capture holds no crawl. */
  crawlOptions: DomConfigStartOptions | null;
  /** The last Export or Copy all of the results held now; null until one. */
  exportedAt: number | null;
}

type StartResult = "started" | "busy" | "locked" | "confirm";

const INITIAL: DomConfigState = {
  phase: "idle",
  tabId: null,
  options: DEFAULT_START_OPTIONS,
  rows: [],
  current: null,
  outcome: null,
  capture: null,
  coverageMarks: {},
  report: null,
  error: null,
  capturing: false,
  manualResult: null,
  importResult: null,
  captureRequest: null,
  ruleChoices: {},
  includeReview: false,
  includeRecordSpecific: false,
  startedAt: null,
  lastCapture: null,
  crawlMs: null,
  crawlOptions: null,
  exportedAt: null,
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
    label: progress.urlShape,
    origin: "crawl",
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

function chip(run: DomConfigRun): PageRow["runs"][number] {
  return {
    label: run.meta.label,
    state: run.meta.stateMismatch ? "mismatch" : "done",
  };
}

/** A row per held page. A crawled page keeps the crawl's chips, failed runs included; runs added later follow. */
function pageRows(
  capture: DomConfigApplicationCapture,
  outcome: CompletedCapture | null,
  report: DomConfigReport,
): PageRow[] {
  const summaries = new Map(report.pages.map((p) => [p.pageId, p]));
  const visits = new Map(outcome?.states.map((v) => [v.pageId, v]));
  return capture.pages.map((page) => {
    const summary = summaries.get(page.pageId);
    const counts = (summary?.runs ?? []).map((r) => r.elementCount);
    const visit = visits.get(page.pageId);
    return {
      key: page.pageId,
      label: page.label,
      origin: page.origin ?? "crawl",
      elementCount: counts.length ? Math.max(...counts) : null,
      status: summary?.status ?? null,
      runs: [
        ...(visit?.runs.map(chip) ?? []),
        ...(visit?.failedRuns.map((run) => ({
          label: run.runLabel,
          state: "failed" as const,
        })) ?? []),
        ...page.runs.slice(visit?.runs.length ?? 0).map(chip),
      ],
    };
  });
}

/** Pages captured by hand or imported, which a new crawl would discard. */
export function holdsAddedPages(
  capture: DomConfigApplicationCapture | null,
): boolean {
  return Boolean(
    capture?.pages.some(
      (page) => page.origin === "manual" || page.origin === "import",
    ),
  );
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

export function createDomConfigStore() {
  let state = INITIAL;
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<DomConfigState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const busy = () =>
    state.phase === "running" || state.phase === "stopping" || state.capturing;
  const analyze = (
    capture: DomConfigApplicationCapture,
    ignoredRoots: readonly string[],
    coverage: CoverageMarks = state.coverageMarks,
  ) => buildReportFromCapture(capture, { ignoredRoots, coverage }).report;
  const hold = (
    capture: DomConfigApplicationCapture,
    report: DomConfigReport,
    outcome: CompletedCapture | null = state.outcome,
  ): Partial<DomConfigState> => ({
    phase: "report",
    current: null,
    error: null,
    startedAt: null,
    lastCapture: null,
    exportedAt: null,
    outcome,
    capture,
    report,
    rows: pageRows(capture, outcome, report),
  });

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setOptions: (options: Partial<DomConfigStartOptions>) =>
      set({ options: { ...state.options, ...options } }),
    setRuleChoice: (ruleId: string, included: boolean) =>
      set({
        ruleChoices: { ...state.ruleChoices, [ruleId]: included },
        exportedAt: null,
      }),
    setIncludeReview: (includeReview: boolean) =>
      set({ includeReview, exportedAt: null }),
    setIncludeRecordSpecific: (includeRecordSpecific: boolean) =>
      set({ includeRecordSpecific, exportedAt: null }),

    /** "confirm" when the capture holds manual or imported pages and `replace` was not given. */
    async start(
      tabId: number,
      ignoredRoots: readonly string[] = [],
      { replace = false }: { replace?: boolean } = {},
    ): Promise<StartResult> {
      if (busy()) return "busy";
      if (!replace && holdsAddedPages(state.capture)) return "confirm";
      if (!acquireTabLock(tabId, "dom-config")) return "locked";
      controller = new AbortController();
      const { options } = state;
      set({
        ...INITIAL,
        options,
        phase: "running",
        tabId,
        startedAt: Date.now(),
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
              ...(progress.phase === "capturing"
                ? { lastCapture: progress }
                : {}),
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
      const crawlMs = Date.now() - (state.startedAt ?? Date.now());
      if (outcome.available) {
        // The crawl analyzed its capture with these options and no marks.
        set({
          ...hold(outcome.capture, outcome.report, outcome),
          crawlMs,
          crawlOptions: options,
        });
      } else {
        set({
          phase: "failed",
          current: null,
          startedAt: null,
          lastCapture: null,
          error: outcome.error,
        });
      }
      return "started";
    },

    stop() {
      if (state.phase !== "running" || !controller) return;
      controller.abort();
      set({ phase: "stopping" });
    },

    rerun(ignoredRoots: readonly string[] = []) {
      if (!state.capture) return;
      set({ report: analyze(state.capture, ignoredRoots), exportedAt: null });
    },

    /** Adds a run of the tab as it is now; never navigates, clicks or reloads. */
    async captureCurrent(
      tabId: number,
      input: { pageName: string; runLabel: DomConfigRunLabel; probe: boolean },
      ignoredRoots: readonly string[] = [],
    ): Promise<"captured" | "failed" | "busy" | "locked"> {
      if (busy()) return "busy";
      if (!acquireTabLock(tabId, "dom-config")) return "locked";
      set({ capturing: true, manualResult: null });
      let outcome: Awaited<ReturnType<typeof captureCurrentState>>;
      try {
        outcome = await captureCurrentState(tabId, {
          ...(state.capture ? { capture: state.capture } : {}),
          pageName: input.pageName,
          runLabel: input.runLabel,
          probe: input.probe,
          ignoredRoots,
        });
      } catch (error) {
        outcome = {
          available: false,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        releaseTabLock(tabId, "dom-config");
      }
      if (!outcome.available) {
        set({
          capturing: false,
          manualResult: { ok: false, error: outcome.error },
        });
        return "failed";
      }
      const { capture, pageId, warnings } = outcome;
      const labels = new Map(capture.pages.map((p) => [p.pageId, p.label]));
      const page = capture.pages.find((p) => p.pageId === pageId);
      set({
        ...hold(capture, analyze(capture, ignoredRoots)),
        capturing: false,
        manualResult: {
          ok: true,
          pageLabel: page?.label ?? pageId,
          runCount: page?.runs.length ?? 0,
          duplicates: warnings.flatMap((w) =>
            w.pageIds.map((id) => labels.get(id) ?? id),
          ),
        },
      });
      return "captured";
    },

    /** Adds pasted or loaded profiles as runs of one page; a page of the same name gets them appended, up to the run limit. */
    importPage(
      input: { pageName: string; runs: DomConfigImportedRun[] },
      ignoredRoots: readonly string[] = [],
      applicationName = "application",
    ): ImportResult | null {
      const pageName = input.pageName.trim();
      if (!pageName || busy()) return null;
      const previous = state.capture ?? { applicationName, pages: [] };
      const existing = previous.pages.find((p) => p.label === pageName);
      const pageId =
        existing?.pageId ??
        uniqueId(pageName, new Set(previous.pages.map((p) => p.pageId)));
      const built = buildPageCapture(
        { pageId, label: pageName, runs: input.runs },
        ignoredRoots,
      );
      const room =
        DOM_CONFIG_LIMITS.maxRunsPerPage - (existing?.runs.length ?? 0);
      const valid = built.page?.runs ?? [];
      const runs = valid.slice(0, Math.max(0, room));
      const result: ImportResult = {
        pageLabel: pageName,
        added: runs.length,
        dropped: valid.length - runs.length,
        errors: built.errors,
      };
      if (runs.length === 0) {
        set({ importResult: result });
        return result;
      }
      const page = existing
        ? { ...existing, runs: [...existing.runs, ...runs] }
        : { pageId, label: pageName, runs, origin: "import" as const };
      const capture = {
        ...previous,
        pages: existing
          ? previous.pages.map((p) => (p === existing ? page : p))
          : [...previous.pages, page],
      };
      set({
        ...hold(capture, analyze(capture, ignoredRoots)),
        importResult: result,
      });
      return result;
    },

    setCoverageMark(
      key: CoverageKey,
      mark: CoverageMark | null,
      ignoredRoots: readonly string[] = [],
    ) {
      const { [key]: _previous, ...rest } = state.coverageMarks;
      const coverageMarks = mark ? { ...rest, [key]: mark } : rest;
      set({
        coverageMarks,
        exportedAt: null,
        ...(state.capture
          ? { report: analyze(state.capture, ignoredRoots, coverageMarks) }
          : {}),
      });
    },

    /** After a successful Export or Copy all. */
    markExported() {
      if (state.report) set({ exportedAt: Date.now() });
    },

    /** "Capture another run": opens manual capture with the page's name. */
    requestCapture(pageName: string) {
      set({ captureRequest: { pageName } });
    },
    clearCaptureRequest() {
      if (state.captureRequest) set({ captureRequest: null });
    },

    clear() {
      if (busy()) return;
      set({
        ...INITIAL,
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

/** Opens the DOM config page. */
export function openDomConfigPage(origin?: NavigationOrigin): void {
  navigationStore.openPage("dom-config", origin);
}
