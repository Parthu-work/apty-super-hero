import {
  type ApplicationAuditOutcome,
  type ApplicationAuditProgress,
  type ApplicationDiscoveryMode,
  type DomHealthAuditOutcome,
  runApplicationDomHealthAudit,
  runDomHealthAudit,
} from "@apty/browser-runtime";
import { useSyncExternalStore } from "react";
import { acquireTabLock, releaseTabLock } from "./dom-config/tab-lock";

export type DomHealthScope = "page" | "application";
export type DomHealthPhase = "idle" | "running" | "result" | "failed";

export interface DomHealthState {
  /** The result shown, and what the next check covers. */
  scope: DomHealthScope;
  discoveryMode: ApplicationDiscoveryMode;
  /** The check in progress, if any. */
  running: DomHealthScope | null;
  tabId: number | null;
  startedAt: number | null;
  /** The application audit's progress; null for a single page. */
  progress: ApplicationAuditProgress | null;
  pageOutcome: DomHealthAuditOutcome | null;
  appOutcome: ApplicationAuditOutcome | null;
}

interface DomHealthRunOptions {
  tabId: number;
  ignoredRoots?: readonly string[];
  thresholdOverrides?: Record<string, number>;
}

type RunResult = "started" | "busy" | "locked";

const INITIAL: DomHealthState = {
  scope: "page",
  discoveryMode: "application-safe",
  running: null,
  tabId: null,
  startedAt: null,
  progress: null,
  pageOutcome: null,
  appOutcome: null,
};

interface DomHealthDeps {
  checkPage: typeof runDomHealthAudit;
  auditApplication: typeof runApplicationDomHealthAudit;
  now: () => number;
}

/**
 * DOM health's checks and results, outside React: leaving the page or
 * closing the card never cancels a check, and the menu and the job bar
 * read the same state. Only the application audit can be stopped; it
 * stops between pages and keeps what it reached.
 * @internal Exported for tests; the app uses `domHealthStore`.
 */
export function createDomHealthStore(
  deps: DomHealthDeps = {
    checkPage: (tabId, options) => runDomHealthAudit(tabId, options),
    auditApplication: (tabId, options) =>
      runApplicationDomHealthAudit(tabId, options),
    now: () => Date.now(),
  },
) {
  let state = INITIAL;
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<DomHealthState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  function begin(scope: DomHealthScope, tabId: number): RunResult {
    if (state.running) return "busy";
    if (!acquireTabLock(tabId, "dom-health")) return "locked";
    set({
      scope,
      running: scope,
      tabId,
      startedAt: deps.now(),
      progress: null,
    });
    return "started";
  }

  function finish(tabId: number, patch: Partial<DomHealthState>) {
    releaseTabLock(tabId, "dom-health");
    controller = null;
    set({ ...patch, running: null, startedAt: null, progress: null });
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setScope: (scope: DomHealthScope) => set({ scope }),
    setDiscoveryMode: (discoveryMode: ApplicationDiscoveryMode) =>
      set({ discoveryMode }),

    checkPage({
      tabId,
      ignoredRoots,
      thresholdOverrides,
    }: DomHealthRunOptions): RunResult {
      const result = begin("page", tabId);
      if (result !== "started") return result;
      void deps
        .checkPage(tabId, { ignoredRoots, thresholdOverrides })
        .catch(
          (error: unknown): DomHealthAuditOutcome => ({
            available: false,
            error: String(error),
          }),
        )
        .then((pageOutcome) => finish(tabId, { pageOutcome }));
      return result;
    },

    auditApplication({
      tabId,
      ignoredRoots,
      thresholdOverrides,
    }: DomHealthRunOptions): RunResult {
      const result = begin("application", tabId);
      if (result !== "started") return result;
      controller = new AbortController();
      void deps
        .auditApplication(tabId, {
          discoveryMode: state.discoveryMode,
          ignoredRoots,
          thresholdOverrides,
          signal: controller.signal,
          onProgress: (progress) => set({ progress }),
        })
        .catch(
          (error: unknown): ApplicationAuditOutcome => ({
            available: false,
            error: String(error),
          }),
        )
        .then((appOutcome) => finish(tabId, { appOutcome }));
      return result;
    },

    /** Stops the application audit after the page it is on. */
    stop: () => controller?.abort(),
  };
}

export type DomHealthStore = ReturnType<typeof createDomHealthStore>;

export const domHealthStore = createDomHealthStore();

export function useDomHealthState(
  store: DomHealthStore = domHealthStore,
): DomHealthState {
  return useSyncExternalStore(store.subscribe, store.getState);
}

export function domHealthPhase(state: DomHealthState): DomHealthPhase {
  if (state.running) return "running";
  const outcome =
    state.scope === "application" ? state.appOutcome : state.pageOutcome;
  if (!outcome) return "idle";
  return outcome.available ? "result" : "failed";
}
