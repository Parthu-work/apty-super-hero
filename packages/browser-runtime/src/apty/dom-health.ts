/**
 * Apty DOM Health audit orchestrator.
 *
 * Ties the content-script DOM Health collector (`@aipexstudio/dom-snapshot`)
 * together with the deterministic scoring engine (`./dom-health-scoring.js`)
 * into one on-demand audit: two snapshots of the same tab, a short
 * stabilization interval apart, scored and returned.
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
import type { DomHealthSnapshot } from "@aipexstudio/dom-snapshot";
import {
  buildDomHealthAuditResult,
  type DomHealthAuditResult,
} from "./dom-health-scoring.js";

const COLLECT_MESSAGE = "collect-dom-health-snapshot";
/** Short pause between the two snapshots — long enough to catch a debounced re-render, short enough not to make the user wait. */
const STABILIZATION_DELAY_MS = 800;
const MESSAGE_TIMEOUT_MS = 8000;
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

function isUnsupportedPage(url: string | undefined): boolean {
  if (!url) return true;
  return UNSUPPORTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendCollectMessage(tabId: number): Promise<DomHealthSnapshot> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(
        new Error(
          "Timed out waiting for the page to respond. It may still be loading, or DOM Health may not be supported on this page.",
        ),
      );
    }, MESSAGE_TIMEOUT_MS);

    chrome.tabs.sendMessage(
      tabId,
      { request: COLLECT_MESSAGE },
      (
        response:
          | { success?: boolean; data?: DomHealthSnapshot; error?: string }
          | undefined,
      ) => {
        clearTimeout(timeoutId);
        if (chrome.runtime.lastError) {
          reject(
            new Error(
              chrome.runtime.lastError.message ??
                "Could not reach this page — it may not have finished loading yet.",
            ),
          );
          return;
        }
        if (!response?.success || !response.data) {
          reject(
            new Error(response?.error ?? "Failed to collect a DOM snapshot."),
          );
          return;
        }
        resolve(response.data);
      },
    );
  });
}

let auditSequence = 0;
function generateAuditId(): string {
  auditSequence += 1;
  return `dom-health-${Date.now()}-${auditSequence}`;
}

/**
 * Run a full Apty DOM Health audit against the given tab. Two DOM snapshots
 * are taken `STABILIZATION_DELAY_MS` apart and scored deterministically —
 * the same two snapshots always produce the same score.
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

  try {
    const before = await sendCollectMessage(tabId);
    await delay(STABILIZATION_DELAY_MS);
    const after = await sendCollectMessage(tabId);
    const result = buildDomHealthAuditResult(before, after, generateAuditId());
    return { available: true, ...result };
  } catch (error) {
    return {
      available: false,
      error:
        error instanceof Error ? error.message : "Unable to audit this page.",
    };
  }
}
