/**
 * Apty DOM Health audit orchestrator.
 *
 * Ties the frame-aware, multi-frame capture layer (`frame-audit.ts`)
 * together with the deterministic scoring engine (`./dom-health-scoring.js`)
 * into one on-demand audit: three ROUNDS across every reachable frame in
 * the tab, spaced apart to catch both a quick debounced re-render and a
 * slower one, aggregated and scored.
 *
 * Forensic-audit fix (RC-1/RC-2): the previous implementation sent exactly
 * one un-addressed `chrome.tabs.sendMessage` per round and trusted whatever
 * frame happened to answer. This version enumerates the tab's real frame
 * tree and messages every frame explicitly by `frameId`, so a page whose
 * real UI lives inside an iframe or a legacy frameset is actually seen,
 * deterministically, instead of depending on which frame's content script
 * wins an unaddressed race.
 *
 * `runDomHealthAudit` is the single source of truth for the score — it is
 * called both by the `run_dom_health_audit` agent tool (`../tools/dom-health.ts`)
 * and directly by the side panel's "Check DOM Health" button
 * (no agent/LLM turn involved), so the UI's CTA works independently of chat
 * and always reports the same deterministic result the agent would.
 *
 * Deliberately does NOT depend on Apty Client/Studio/Service-Worker state —
 * it only needs the page's own DOM, so it keeps working even when those
 * integrations are unavailable or unconfigured.
 */
import type { DomHealthSnapshot } from "@apty/dom-snapshot";
import {
  buildDomHealthAuditResult,
  type DomHealthAuditResult,
} from "./dom-health-scoring.js";
import {
  aggregateFrameSnapshots,
  captureApplicationState,
  type FrameCaptureResult,
} from "./frame-audit.js";
import type { FrameAccessibilitySummary } from "./frame-tree.js";

/** Delays (ms, from the audit's start) at which each round's capture is taken — short enough not to make the user wait, long enough apart to catch both a quick and a slower debounced re-render. */
const SNAPSHOT_DELAYS_MS = [0, 800, 2000];
const FRAME_MESSAGE_TIMEOUT_MS = 8000;
const UNSUPPORTED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "devtools://",
];

export type DomHealthAuditOutcome =
  | ({ available: true } & DomHealthAuditResult)
  | { available: false; error: string };

/** Exported for reuse by `application-audit.ts`, which applies the same check before navigating to a discovered page. */
export function isUnsupportedPage(url: string | undefined): boolean {
  if (!url) return true;
  return UNSUPPORTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let auditSequence = 0;
function generateAuditId(): string {
  auditSequence += 1;
  return `dom-health-${Date.now()}-${auditSequence}`;
}

function mergeFrameAccessibility(
  rounds: FrameAccessibilitySummary[],
): FrameAccessibilitySummary {
  // The last round is the most representative snapshot of "can we currently
  // see this page" — earlier rounds can differ if a frame was mid-navigation
  // when the audit started, but the FINAL state is what the score describes.
  return (
    rounds[rounds.length - 1] ?? {
      framesTotal: 0,
      framesAccessible: 0,
      framesFailed: 0,
      framesInaccessible: 0,
    }
  );
}

/**
 * Run a full Apty DOM Health audit against the given tab. Each round
 * captures every reachable frame (never a single un-addressed message) and
 * aggregates them into one snapshot; the aggregated sequence is scored
 * deterministically — the same sequence of captures always produces the
 * same score.
 */
export async function runDomHealthAudit(
  tabId: number,
): Promise<DomHealthAuditOutcome> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
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

  const snapshots: DomHealthSnapshot[] = [];
  const frameAccessibilityByRound: FrameAccessibilitySummary[] = [];

  for (let i = 0; i < SNAPSHOT_DELAYS_MS.length; i++) {
    if (i > 0) {
      const waitMs = SNAPSHOT_DELAYS_MS[i]! - SNAPSHOT_DELAYS_MS[i - 1]!;
      await delay(waitMs);
    }

    const outcome = await captureApplicationState(tabId, {
      sequenceIndex: i,
      timeoutMs: FRAME_MESSAGE_TIMEOUT_MS,
    });

    if (!outcome.available) {
      return { available: false, error: outcome.error };
    }

    const captured: FrameCaptureResult[] = outcome.result.frames;
    snapshots.push(aggregateFrameSnapshots(captured));
    frameAccessibilityByRound.push(outcome.result.frameAccessibility);
  }

  const result = buildDomHealthAuditResult(
    snapshots,
    generateAuditId(),
    mergeFrameAccessibility(frameAccessibilityByRound),
  );
  return { available: true, ...result };
}
