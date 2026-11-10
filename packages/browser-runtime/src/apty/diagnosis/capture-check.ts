/**
 * "Capture and reload" on the verdict card (KB-RAG K15 A): for a tenant
 * whose player fetches its content from the page (a 4.x player in Injected
 * mode), when the Agent has no Apty files, the card captures the tab's
 * network, reloads it, waits until the Apty calls stop (2 s with no new
 * one, at most 20 s), stops, and runs the same check again on the captured
 * files. The capture keeps whole bodies of Apty content calls only, through
 * the body deny list and redaction; they never reach a tool result.
 */

import { tabElementProbeOf } from "../element-probe.js";
import { loadBodyDenyList } from "../extension-network-inspector.js";
import {
  aptyContentCalls,
  type NetworkCaptureOptions,
  startNetworkCapture,
  stopNetworkCapture,
} from "../network-capture-session.js";
import { captureSource } from "./apty-files.js";
import { loadEvidenceFrom } from "./loader.js";
import { runPack } from "./responder.js";
import type { Route } from "./router.js";
import type { DiagnosisResult } from "./types.js";

const QUIET_MS = 2_000;
const MAX_MS = 20_000;
const POLL_MS = 250;

export interface CaptureReloadDeps {
  start(
    key: string,
    tabId: number,
    options: NetworkCaptureOptions,
  ): Promise<{ started: boolean; error?: string }>;
  stop(key: string): Promise<{ stopped: boolean }>;
  reload(tabId: number): Promise<void>;
  /** How many Apty content calls the tab's capture has seen. */
  count(tabId: number): number;
  now(): number;
  sleep(ms: number): Promise<void>;
}

const DEFAULT_DEPS: CaptureReloadDeps = {
  start: async (key, tabId, options) =>
    startNetworkCapture(key, tabId, {
      ...options,
      bodyDenyList: await loadBodyDenyList().catch(() => []),
    }),
  stop: (key) => stopNetworkCapture(key),
  reload: (tabId) => chrome.tabs.reload(tabId),
  count: (tabId) => aptyContentCalls(tabId)?.resources.length ?? 0,
  now: () => Date.now(),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
};

export type CaptureReloadResult =
  | { ok: true; calls: number }
  | { ok: false; error: string };

export async function captureAndReload(
  tabId: number,
  deps: CaptureReloadDeps = DEFAULT_DEPS,
): Promise<CaptureReloadResult> {
  const key = `apty-check-capture-${tabId}`;
  const started = await deps.start(key, tabId, { aptyContentBodies: true });
  if (!started.started) {
    return { ok: false, error: started.error ?? "capture did not start" };
  }
  try {
    await deps.reload(tabId);
    const begun = deps.now();
    let seen = 0;
    let changed = begun;
    while (deps.now() - begun < MAX_MS) {
      await deps.sleep(POLL_MS);
      const count = deps.count(tabId);
      if (count !== seen) {
        seen = count;
        changed = deps.now();
      }
      if (seen > 0 && deps.now() - changed >= QUIET_MS) break;
    }
    return { ok: true, calls: seen };
  } finally {
    await deps.stop(key);
  }
}

/** The route that runs a widget or content check again.
 * @internal exported for tests.
 */
export function routeOfResult(result: DiagnosisResult): Route | undefined {
  if (result.packId === "widget-not-visible") {
    return { packId: "widget-not-visible" };
  }
  if (result.packId !== "content-not-visible") return undefined;
  const { kind, query, language } = result.subject;
  if (
    kind === "widget" ||
    kind === "logs" ||
    kind === "page" ||
    kind === "dapty"
  ) {
    return undefined;
  }
  return {
    packId: "content-not-visible",
    kind,
    ...(query ? { query } : {}),
    ...(language ? { language } : {}),
  };
}

/** Runs `result`'s check again on the Apty files the tab's capture holds. */
export async function recheckFromCapture(
  result: DiagnosisResult,
  tabId: number,
  pageUrl: string | undefined,
): Promise<DiagnosisResult | undefined> {
  const route = routeOfResult(result);
  const calls = aptyContentCalls(tabId);
  if (!route || !calls) return undefined;
  return runPack(route, undefined, {
    pageUrl: async () => pageUrl,
    pageConsole: async () => undefined,
    probeElement: tabElementProbeOf({ tabId }),
    domHealth: async () => undefined,
    files: async (names) => ({
      ...(await loadEvidenceFrom(captureSource(calls), names)),
      fromCapture: true,
    }),
  });
}
