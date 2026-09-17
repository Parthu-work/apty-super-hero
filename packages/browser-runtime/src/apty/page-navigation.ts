/**
 * Navigation + DOM-stabilization primitives for the application-wide DOM
 * Health audit (spec sections 5, 24). Modeled on the existing
 * `replay-controller.ts` navigate/wait-for-load pattern (chrome.tabs.update
 * + `chrome.tabs.onUpdated` "complete", with a timeout that resolves
 * rather than rejects) rather than introducing a second implementation.
 *
 * Deliberately does NOT use a fixed delay as the only stabilization
 * signal: `waitForDomStable` asks the content script to watch the DOM with
 * a MutationObserver and report back once mutations have been quiet for a
 * configurable window (or a hard timeout elapses), so a debounced re-render
 * genuinely gets time to settle rather than being sampled mid-flight.
 */
import type { DiscoverableLink } from "@apty/dom-snapshot";

const DEFAULT_NAVIGATION_TIMEOUT_MS = 20_000;
const DEFAULT_STABILIZE_QUIET_MS = 400;
const DEFAULT_STABILIZE_TIMEOUT_MS = 8_000;

export function waitForTabLoad(
  tabId: number,
  timeoutMs = DEFAULT_NAVIGATION_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    const listener = (id: number, changeInfo: { status?: string }) => {
      if (id === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);
  });
}

/** Navigate the tab to `url` (a real browser navigation via chrome.tabs.update — never a simulated click) and wait for the load-complete signal. */
export async function navigateTab(
  tabId: number,
  url: string,
  timeoutMs = DEFAULT_NAVIGATION_TIMEOUT_MS,
): Promise<void> {
  await chrome.tabs.update(tabId, { url });
  await waitForTabLoad(tabId, timeoutMs);
}

interface StabilizeResult {
  settled: boolean;
  elapsedMs: number;
}

/** Ask the content script to report once the DOM has been quiet for `quietMs`, or `timeoutMs` has elapsed — never a fixed sleep. */
export function waitForDomStable(
  tabId: number,
  quietMs = DEFAULT_STABILIZE_QUIET_MS,
  timeoutMs = DEFAULT_STABILIZE_TIMEOUT_MS,
): Promise<StabilizeResult> {
  return new Promise((resolve) => {
    const localFallback = setTimeout(
      () => resolve({ settled: false, elapsedMs: timeoutMs }),
      timeoutMs + 2000,
    );
    try {
      chrome.tabs.sendMessage(
        tabId,
        { request: "wait-for-dom-stable", quietMs, timeoutMs },
        (
          response: { success?: boolean; data?: StabilizeResult } | undefined,
        ) => {
          clearTimeout(localFallback);
          if (
            chrome.runtime.lastError ||
            !response?.success ||
            !response.data
          ) {
            resolve({ settled: false, elapsedMs: 0 });
            return;
          }
          resolve(response.data);
        },
      );
    } catch {
      clearTimeout(localFallback);
      resolve({ settled: false, elapsedMs: 0 });
    }
  });
}

/** Read every safe-to-discover same-origin link on the current page (see `@apty/dom-snapshot`'s `health-links.ts`). Never triggers a click. */
export function collectPageLinks(tabId: number): Promise<DiscoverableLink[]> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(
        tabId,
        { request: "collect-dom-health-links" },
        (
          response:
            | { success?: boolean; data?: DiscoverableLink[] }
            | undefined,
        ) => {
          if (chrome.runtime.lastError || !response?.success) {
            resolve([]);
            return;
          }
          resolve(response.data ?? []);
        },
      );
    } catch {
      resolve([]);
    }
  });
}

export interface NavigationModel {
  usesHistoryApiRouting: boolean;
  historyApiCallCount: number;
}

/** Whether the current page appears to use client-side (pushState/replaceState/popstate) routing — diagnostic only, never affects the score. */
export function getNavigationModel(tabId: number): Promise<NavigationModel> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(
        tabId,
        { request: "get-dom-health-navigation-model" },
        (
          response: { success?: boolean; data?: NavigationModel } | undefined,
        ) => {
          if (
            chrome.runtime.lastError ||
            !response?.success ||
            !response.data
          ) {
            resolve({ usesHistoryApiRouting: false, historyApiCallCount: 0 });
            return;
          }
          resolve(response.data);
        },
      );
    } catch {
      resolve({ usesHistoryApiRouting: false, historyApiCallCount: 0 });
    }
  });
}
