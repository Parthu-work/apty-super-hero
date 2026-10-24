/**
 * DOM Config capture (R3): the application crawl shared with Audit
 * Application, with several profile runs per state instead of a DOM Health
 * audit, and a manual capture of the tab as it is for states no crawl can
 * reach. Page titles are never recorded; URLs only as `toUrlShape` (D11).
 */
import {
  type BehaviorProbe,
  DEFAULT_PROBE_WINDOW_MS,
  toUrlShape,
} from "@apty/dom-snapshot";
import {
  type ApplicationDiscoveryMode,
  type CrawlRow,
  captureFingerprint,
  crawlApplication,
} from "../application-crawl.js";
import type { PageDiscoverySource } from "../application-scoring.js";
import { isUnsupportedPage } from "../dom-health.js";
import { navigateTab, waitForDomStable } from "../page-navigation.js";
import { pageIdentity } from "../route-key.js";
import { buildDomConfigReport } from "./build-report.js";
import {
  captureBehaviorProbe,
  collectStateProfile,
  type DomConfigFrameInventoryEntry,
} from "./collect-state-profile.js";
import { DOM_CONFIG_LIMITS } from "./limits.js";
import { renderDomConfigMarkdown } from "./render-markdown.js";
import type {
  ApplicationCapture,
  DomConfigReport,
  DomConfigReportOptions,
  PageCapture,
  ProfileRun,
  RunLabel,
} from "./types.js";

export const DOM_CONFIG_DEFAULT_MAX_PAGES = 20;
export const DOM_CONFIG_DEFAULT_MAX_TOTAL_MS = 600_000;
export const DOM_CONFIG_DEFAULT_RUNS_PER_STATE = 2;
export const DOM_CONFIG_MAX_RUNS_PER_STATE = 4;

export type DomConfigCaptureProgress =
  | { phase: "discovering"; urlShape: string }
  | {
      phase: "capturing";
      stateIndex: number;
      maxStates: number;
      urlShape: string;
      runIndex: number;
      runCount: number;
      runLabel: RunLabel;
    }
  | { phase: "probing"; stateIndex: number; urlShape: string }
  | { phase: "revisiting"; stateIndex: number; urlShape: string }
  | { phase: "restoring"; urlShape: string }
  | { phase: "analyzing" };

interface ProbeOptions {
  /** Defaults to on. */
  probe?: boolean;
  probeWindowMs?: number;
  ignoredRoots?: readonly string[];
  /** Where capture dates come from; tests pass their own. */
  now?: () => Date;
  /** How the probe window is waited out; tests pass their own. */
  wait?: (ms: number) => Promise<void>;
}

export interface DomConfigCaptureOptions extends ProbeOptions {
  /** Defaults to "application-safe"; only "application-deep" clicks. */
  discoveryMode?: ApplicationDiscoveryMode;
  maxPages?: number;
  maxTotalMs?: number;
  /** 2 by default, at most 4: run 1 initial, run 2 after a fresh visit, the rest repeats. */
  runsPerState?: number;
  onProgress?: (progress: DomConfigCaptureProgress) => void;
  signal?: AbortSignal;
  applicationName?: string;
  report?: DomConfigReportOptions;
}

export type DomConfigInventoryStatus =
  | "audited"
  | "failed"
  | "skipped"
  | "not-discovered"
  | "not-explored";

export interface DomConfigInventoryEntry {
  urlShape: string;
  /** A control found on that page rather than a link. */
  control: boolean;
  source: PageDiscoverySource | "queue";
  status: DomConfigInventoryStatus;
  reason: string | null;
  pageId: string | null;
  runs: number;
}

export interface DomConfigStateVisit {
  pageId: string;
  runs: ProfileRun[];
  frames: DomConfigFrameInventoryEntry[];
  /** Why run 2 does not show the state run 1 showed, when it does not. */
  revisitIssue: string | null;
  failedRuns: { runLabel: RunLabel; error: string }[];
}

export interface DomConfigCaptureResult {
  capture: ApplicationCapture;
  inventory: DomConfigInventoryEntry[];
  states: DomConfigStateVisit[];
  limitsReached: { maxPages: boolean; maxTotalMs: boolean };
  aborted: boolean;
  returnedToSeed: { success: boolean; reason: string | null };
  report: DomConfigReport;
  markdown: string;
}

export type DomConfigCaptureOutcome =
  | ({ available: true } & DomConfigCaptureResult)
  | { available: false; error: string };

export function buildReportFromCapture(
  capture: ApplicationCapture,
  options: DomConfigReportOptions = {},
): { report: DomConfigReport; markdown: string } {
  const report = buildDomConfigReport(capture, options);
  return { report, markdown: renderDomConfigMarkdown(report) };
}

function clampRuns(runs: number | undefined): number {
  const n = Math.trunc(runs ?? DOM_CONFIG_DEFAULT_RUNS_PER_STATE);
  return Math.min(DOM_CONFIG_MAX_RUNS_PER_STATE, Math.max(1, n));
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

async function liveUrl(tabId: number): Promise<string> {
  return (await chrome.tabs.get(tabId).catch(() => null))?.url ?? "";
}

function labelOfRun(index: number): RunLabel {
  if (index === 0) return "initial";
  return index === 1 ? "after-reload" : "repeat";
}

interface RunCapture {
  run: ProfileRun | null;
  frames: DomConfigFrameInventoryEntry[];
  error: string | null;
}

async function captureRun(
  tabId: number,
  label: RunLabel,
  urlShape: string,
  options: ProbeOptions & {
    stateFingerprint?: string;
    stateMismatch?: boolean;
    probeNow: boolean;
    onProbe?: () => void;
  },
): Promise<RunCapture> {
  const ignoredRoots = options.ignoredRoots ?? [];
  const outcome = await collectStateProfile(tabId, { ignoredRoots });
  if (!outcome.available)
    return { run: null, frames: [], error: outcome.error };
  const { profile, inventory } = outcome.result;
  if (options.probeNow) {
    options.onProbe?.();
    const probe: BehaviorProbe = await captureBehaviorProbe(tabId, {
      windowMs: options.probeWindowMs ?? DEFAULT_PROBE_WINDOW_MS,
      ignoredRoots,
      ...(options.wait ? { wait: options.wait } : {}),
    });
    profile.probe = probe;
  }
  return {
    run: {
      meta: {
        label,
        capturedAt: (options.now ?? (() => new Date()))().toISOString(),
        urlShape,
        aptyPresent: Boolean(profile.meta?.aptyPresent),
        extensionNoisePresent: Boolean(profile.meta?.extensionNoisePresent),
        ...(options.stateFingerprint
          ? { stateFingerprint: options.stateFingerprint }
          : {}),
        ...(profile.meta?.partial ? { partial: true } : {}),
        ...(options.stateMismatch ? { stateMismatch: true } : {}),
      },
      profile,
    },
    frames: inventory,
    error: null,
  };
}

const SKIP_REASONS: Partial<Record<string, string>> = {
  "skipped-cross-origin": "Cross-origin link: never followed.",
  "skipped-unsafe": "Looks destructive or unsafe: never followed or clicked.",
  "skipped-duplicate": "Shows a state already captured.",
  "explored-no-new-state": "Clicking this control did not produce a new state.",
};

function inventoryStatus(status: string): DomConfigInventoryStatus {
  if (status === "completed") return "audited";
  if (status === "failed") return "failed";
  if (status === "not-discovered") return "not-discovered";
  return "skipped";
}

function shapeOfRowUrl(url: string): { urlShape: string; control: boolean } {
  const at = url.indexOf("#control:");
  return at < 0
    ? { urlShape: toUrlShape(url), control: false }
    : { urlShape: toUrlShape(url.slice(0, at)), control: true };
}

function toInventory(
  row: CrawlRow<DomConfigStateVisit>,
): DomConfigInventoryEntry {
  const status = inventoryStatus(row.status);
  return {
    ...shapeOfRowUrl(row.url),
    source: row.discoverySource,
    status,
    reason:
      status === "audited"
        ? (row.visit?.revisitIssue ?? null)
        : (row.failureReason ?? SKIP_REASONS[row.status] ?? null),
    pageId: row.visit?.pageId ?? null,
    runs: row.visit?.runs.length ?? 0,
  };
}

/**
 * Crawl the application from the tab's current state and capture every
 * state it reaches `runsPerState` times (R3.2): run 1 as reached, the
 * probe, run 2 after a fresh visit (D13), the rest with no navigation.
 * Ends back on the seed URL. Forms are never submitted and nothing is
 * typed; only "application-deep" clicks, and only allowlisted controls.
 */
export async function runDomConfigCapture(
  tabId: number,
  options: DomConfigCaptureOptions = {},
): Promise<DomConfigCaptureOutcome> {
  const runsPerState = clampRuns(options.runsPerState);
  const maxPages = options.maxPages ?? DOM_CONFIG_DEFAULT_MAX_PAGES;
  const ignoredRoots = options.ignoredRoots ?? [];
  const probe = options.probe ?? true;
  const pages: PageCapture[] = [];
  const pageIds = new Set<string>();
  /** Page identity (`pageIdentity`) of each captured state, to the URL shape it was captured under. */
  const capturedPages = new Map<string, string>();
  const states: DomConfigStateVisit[] = [];
  const aborted = () => options.signal?.aborted === true;
  const progress = options.onProgress;

  const crawl = await crawlApplication<DomConfigStateVisit>(tabId, {
    maxPages,
    maxTotalAuditMs: options.maxTotalMs ?? DOM_CONFIG_DEFAULT_MAX_TOTAL_MS,
    discoveryMode: options.discoveryMode ?? "application-safe",
    ignoredRoots,
    ...(options.signal ? { signal: options.signal } : {}),
    onProgress: (p) => {
      if (p.phase === "discovering-links") {
        progress?.({ phase: "discovering", urlShape: toUrlShape(p.url) });
      } else if (p.phase === "restoring-state") {
        progress?.({ phase: "restoring", urlShape: toUrlShape(p.targetUrl) });
      }
    },
    visit: async ({ stateId, source, fingerprint, routeKey, revisit }) => {
      const stateIndex = states.length + 1;
      const url = await liveUrl(tabId);
      const urlShape = toUrlShape(url);
      const identity = routeKey ? pageIdentity(routeKey) : null;
      const twin = identity ? capturedPages.get(identity) : undefined;
      if (twin) return { available: false, duplicate: `duplicate of ${twin}` };
      const pageId = uniqueId(
        source === "safe-navigation-control"
          ? `${urlShape} [${stateId}]`
          : urlShape,
        pageIds,
      );
      const visit: DomConfigStateVisit = {
        pageId,
        runs: [],
        frames: [],
        revisitIssue: null,
        failedRuns: [],
      };
      let stateFingerprint: string | undefined = fingerprint;
      let stateMismatch = false;
      for (let i = 0; i < runsPerState; i++) {
        if (i > 0 && aborted()) break;
        const runLabel = labelOfRun(i);
        if (runLabel === "after-reload") {
          progress?.({ phase: "revisiting", stateIndex, urlShape });
          const revisited = await revisit();
          if (revisited.comparison !== "same") {
            stateMismatch = true;
            stateFingerprint = undefined;
            visit.revisitIssue = `state-mismatch (${revisited.comparison}): ${revisited.reason ?? "the fresh visit showed a different state"}`;
          }
        } else if (runLabel === "repeat") {
          await waitForDomStable(tabId);
        }
        progress?.({
          phase: "capturing",
          stateIndex,
          maxStates: maxPages,
          urlShape,
          runIndex: i + 1,
          runCount: runsPerState,
          runLabel,
        });
        const captured = await captureRun(tabId, runLabel, urlShape, {
          ...options,
          ignoredRoots,
          ...(stateFingerprint ? { stateFingerprint } : {}),
          stateMismatch,
          probeNow: probe && i === 0 && !aborted(),
          onProbe: () => progress?.({ phase: "probing", stateIndex, urlShape }),
        });
        if (!captured.run) {
          if (i === 0) return { available: false, error: captured.error! };
          visit.failedRuns.push({ runLabel, error: captured.error! });
          continue;
        }
        visit.runs.push(captured.run);
        if (i === 0) visit.frames = captured.frames;
      }
      pageIds.add(pageId);
      if (identity && !capturedPages.has(identity)) {
        capturedPages.set(identity, urlShape);
      }
      pages.push({ pageId, label: pageId, runs: visit.runs, origin: "crawl" });
      states.push(visit);
      return { available: true, url, visit };
    },
  });
  if (!crawl.available) return crawl;
  const { result } = crawl;

  let returnedToSeed: DomConfigCaptureResult["returnedToSeed"] = {
    success: true,
    reason: null,
  };
  const seedStateId = result.graph.getSeedStateId();
  if (result.graph.getCurrentStateId() !== seedStateId) {
    progress?.({ phase: "restoring", urlShape: toUrlShape(result.seedUrl) });
    returnedToSeed = await returnToSeed(tabId, result.seedUrl, ignoredRoots, {
      fingerprint: seedStateId
        ? result.graph.getNode(seedStateId)?.fingerprint.fingerprint
        : undefined,
    });
  }

  const unexploredReason = result.aborted
    ? "Stopped before it was visited."
    : "A page or time limit was reached before it was visited.";
  const inventory = [
    ...result.rows.map(toInventory),
    ...result.unexplored.map(
      (item): DomConfigInventoryEntry => ({
        urlShape: toUrlShape(item.url),
        control: item.kind === "click",
        source: "queue",
        status: "not-explored",
        reason: unexploredReason,
        pageId: null,
        runs: 0,
      }),
    ),
  ];
  const capture: ApplicationCapture = {
    applicationName:
      options.applicationName ?? hostOf(result.seedUrl) ?? "application",
    pages,
  };
  progress?.({ phase: "analyzing" });
  return {
    available: true,
    capture,
    inventory,
    states,
    limitsReached: {
      maxPages: result.limitsReached.maxPages,
      maxTotalMs: result.limitsReached.maxTotalAuditMs,
    },
    aborted: result.aborted,
    returnedToSeed,
    ...buildReportFromCapture(capture, {
      ignoredRoots,
      ...options.report,
    }),
  };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

async function returnToSeed(
  tabId: number,
  seedUrl: string,
  ignoredRoots: readonly string[],
  seed: { fingerprint: string | undefined },
): Promise<DomConfigCaptureResult["returnedToSeed"]> {
  try {
    await navigateTab(tabId, seedUrl);
  } catch (error) {
    return {
      success: false,
      reason: error instanceof Error ? error.message : "Navigation failed",
    };
  }
  await waitForDomStable(tabId);
  const observed = await captureFingerprint(tabId, ignoredRoots);
  if (seed.fingerprint && observed?.fingerprint !== seed.fingerprint) {
    return {
      success: false,
      reason:
        "The starting URL was loaded again, but it shows a different state than when the capture started.",
    };
  }
  return { success: true, reason: null };
}

export interface CaptureCurrentStateOptions extends ProbeOptions {
  /** The in-memory capture the run is added to; a new one when absent. */
  capture?: ApplicationCapture;
  pageName: string;
  /** The SE's choice; for "after-reload" the SE reloads the page first. */
  runLabel: RunLabel;
  applicationName?: string;
}

export interface CaptureCurrentStateWarning {
  code: "duplicate-state";
  /** Pages already holding a run of the same state. */
  pageIds: string[];
}

export type CaptureCurrentStateOutcome =
  | {
      available: true;
      capture: ApplicationCapture;
      pageId: string;
      frames: DomConfigFrameInventoryEntry[];
      warnings: CaptureCurrentStateWarning[];
    }
  | { available: false; error: string };

/**
 * Add one run of the tab exactly as it is now to the named page (R3.2b),
 * for states only a person can open: a modal, a form, a record. Never
 * navigates, clicks or reloads. The input capture is not changed.
 */
export async function captureCurrentState(
  tabId: number,
  options: CaptureCurrentStateOptions,
): Promise<CaptureCurrentStateOutcome> {
  const pageName = options.pageName.trim();
  if (!pageName) return { available: false, error: "A page name is needed." };
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) {
    return {
      available: false,
      error: "The target tab could not be found — it may have been closed.",
    };
  }
  if (isUnsupportedPage(tab.url)) {
    return {
      available: false,
      error:
        "This page does not allow DOM inspection (browser and extension internal pages are not accessible to content scripts).",
    };
  }
  const previous: ApplicationCapture = options.capture ?? {
    applicationName:
      options.applicationName ?? hostOf(tab.url ?? "") ?? "application",
    pages: [],
  };
  const existing = previous.pages.find((page) => page.label === pageName);
  if (existing && existing.runs.length >= DOM_CONFIG_LIMITS.maxRunsPerPage) {
    return {
      available: false,
      error: `This page already holds ${DOM_CONFIG_LIMITS.maxRunsPerPage} runs, the most the analysis keeps.`,
    };
  }
  const ignoredRoots = options.ignoredRoots ?? [];
  await waitForDomStable(tabId);
  const fingerprint = await captureFingerprint(tabId, ignoredRoots);
  const urlShape = toUrlShape(tab.url ?? "");
  const captured = await captureRun(tabId, options.runLabel, urlShape, {
    ...options,
    ignoredRoots,
    ...(fingerprint ? { stateFingerprint: fingerprint.fingerprint } : {}),
    probeNow: options.probe ?? false,
  });
  if (!captured.run) return { available: false, error: captured.error! };

  const pageId =
    existing?.pageId ??
    uniqueId(pageName, new Set(previous.pages.map((page) => page.pageId)));
  const duplicates = fingerprint
    ? previous.pages
        .filter(
          (page) =>
            page.pageId !== pageId &&
            page.runs.some(
              (run) => run.meta.stateFingerprint === fingerprint.fingerprint,
            ),
        )
        .map((page) => page.pageId)
    : [];
  const page: PageCapture = existing
    ? { ...existing, runs: [...existing.runs, captured.run] }
    : { pageId, label: pageName, runs: [captured.run], origin: "manual" };
  return {
    available: true,
    capture: {
      ...previous,
      pages: existing
        ? previous.pages.map((p) => (p === existing ? page : p))
        : [...previous.pages, page],
    },
    pageId,
    frames: captured.frames,
    warnings: duplicates.length
      ? [{ code: "duplicate-state", pageIds: duplicates }]
      : [],
  };
}
