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
 *
 * Forensic-audit fix (RC-1, RC-4): discovery (`collectPageLinks`,
 * `getNavigationModel`, `collectSafeNavigationCandidates`) now enumerates
 * the tab's real frame tree and queries every frame explicitly by
 * `frameId`, tagging each result with where it came from. A menu-driven
 * enterprise application (Infor LN's typical shape: a menu frame, separate
 * from the content frame) keeps its navigation entirely inside a NON-top
 * frame — discovery that only ever asked the top frame (the previous,
 * un-addressed broadcast) could never see it.
 */
import type {
  CrossStateVerdict,
  DiscoverableLink,
  ElementRef,
  SafeNavigationCandidate,
} from "@apty/dom-snapshot";
import { getFrameTree, sendFrameMessage } from "./frame-tree.js";

const DEFAULT_NAVIGATION_TIMEOUT_MS = 20_000;
const DEFAULT_STABILIZE_QUIET_MS = 400;
const DEFAULT_STABILIZE_TIMEOUT_MS = 8_000;
const DISCOVERY_FRAME_TIMEOUT_MS = 4_000;

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

function waitForFrameStable(
  tabId: number,
  frameId: number,
  quietMs: number,
  timeoutMs: number,
  onlyWhileLoading: boolean,
): Promise<StabilizeResult> {
  return new Promise((resolve) => {
    const localFallback = setTimeout(
      () => resolve({ settled: false, elapsedMs: timeoutMs }),
      timeoutMs + 2000,
    );
    sendFrameMessage<StabilizeResult>(
      tabId,
      frameId,
      { request: "wait-for-dom-stable", quietMs, timeoutMs, onlyWhileLoading },
      timeoutMs + 1000,
    ).then((response) => {
      clearTimeout(localFallback);
      if (!response.success || !response.data) {
        resolve({ settled: false, elapsedMs: 0 });
        return;
      }
      resolve(response.data);
    });
  });
}

/**
 * Report once the DOM has been quiet for `quietMs`, or `timeoutMs` has
 * elapsed — never a fixed sleep. The top frame is always waited on. Every
 * other frame, asked by `frameId` (never a broadcast), is waited on only
 * while its document is still loading (e.g. a frameset content frame
 * navigated by a menu click): a loaded frame that never goes quiet (ads,
 * chat widgets, clocks) must not stall every wait of an audit.
 */
export async function waitForDomStable(
  tabId: number,
  quietMs = DEFAULT_STABILIZE_QUIET_MS,
  timeoutMs = DEFAULT_STABILIZE_TIMEOUT_MS,
): Promise<StabilizeResult> {
  const frames = await getFrameTree(tabId);
  const frameIds = frames
    ?.filter((f) => !f.isAboutBlank && !f.errorOccurred)
    .map((f) => f.frameId) ?? [0];
  const results = await Promise.all(
    (frameIds.length > 0 ? frameIds : [0]).map((frameId) =>
      waitForFrameStable(tabId, frameId, quietMs, timeoutMs, frameId !== 0),
    ),
  );
  return {
    settled: results.every((r) => r.settled),
    elapsedMs: Math.max(...results.map((r) => r.elapsedMs)),
  };
}

export interface FrameTaggedLink extends DiscoverableLink {
  frameId: number;
}

/**
 * Read every safe-to-discover same-origin link on the page — across EVERY
 * frame in the tab, not just the top one, tagged with the frame it was
 * found in. Never triggers a click. See `@apty/dom-snapshot`'s
 * `health-links.ts`.
 */
export async function collectPageLinks(
  tabId: number,
): Promise<FrameTaggedLink[]> {
  const frameTree = await getFrameTree(tabId).catch(() => null);
  if (!frameTree) return [];

  const perFrame = await Promise.all(
    frameTree
      .filter((frame) => !frame.errorOccurred && !frame.isAboutBlank)
      .map(async (frame) => {
        const response = await sendFrameMessage<DiscoverableLink[]>(
          tabId,
          frame.frameId,
          { request: "collect-dom-health-links" },
          DISCOVERY_FRAME_TIMEOUT_MS,
        );
        if (!response.success || !response.data) return [];
        return response.data.map((link) => ({
          ...link,
          frameId: frame.frameId,
        }));
      }),
  );

  return perFrame.flat();
}

export interface FrameTaggedSafeNavigationCandidate
  extends SafeNavigationCandidate {
  frameId: number;
}

/**
 * Read-only detection of safe-looking, non-anchor navigation controls
 * (menu items, tabs, tree nodes) across every frame in the tab — see
 * `@apty/dom-snapshot`'s `health-links.ts`. Never clicks anything by
 * itself; the caller (`application-audit.ts`) decides, behind an explicit
 * opt-in, whether to ever act on one of these.
 */
export async function collectSafeNavigationCandidates(
  tabId: number,
): Promise<FrameTaggedSafeNavigationCandidate[]> {
  const frameTree = await getFrameTree(tabId).catch(() => null);
  if (!frameTree) return [];

  const perFrame = await Promise.all(
    frameTree
      .filter((frame) => !frame.errorOccurred && !frame.isAboutBlank)
      .map(async (frame) => {
        const response = await sendFrameMessage<SafeNavigationCandidate[]>(
          tabId,
          frame.frameId,
          { request: "collect-dom-health-safe-navigation-candidates" },
          DISCOVERY_FRAME_TIMEOUT_MS,
        );
        if (!response.success || !response.data) return [];
        return response.data.map((candidate) => ({
          ...candidate,
          frameId: frame.frameId,
        }));
      }),
  );

  return perFrame.flat();
}

export interface ClickCandidateResult {
  clicked: boolean;
  reason?: string;
}

async function requestClick(
  tabId: number,
  frameId: number,
  request: string,
  domPath: string,
): Promise<ClickCandidateResult> {
  const response = await sendFrameMessage<ClickCandidateResult>(
    tabId,
    frameId,
    { request, domPath },
    DISCOVERY_FRAME_TIMEOUT_MS,
  );
  if (!response.success || !response.data) {
    return {
      clicked: false,
      reason: response.error ?? "Frame did not respond.",
    };
  }
  return response.data;
}

/**
 * One of the two functions in DOM Health that can cause a real click.
 * Never called unless the caller has explicitly enabled
 * `allowClickDiscovery` (default off — see `application-audit.ts`), and
 * the content script itself re-verifies the candidate is still safe
 * (same-container, non-destructive, non-form) immediately before clicking
 * — defense in depth, never trusting a single check.
 */
export async function clickSafeNavigationCandidate(
  tabId: number,
  frameId: number,
  domPath: string,
): Promise<ClickCandidateResult> {
  return requestClick(
    tabId,
    frameId,
    "click-safe-navigation-candidate",
    domPath,
  );
}

/**
 * The other: clicks a link the audit already discovered and navigated to,
 * to reach its page by in-app navigation when loading the URL directly did
 * not reproduce it. Same gate as `clickSafeNavigationCandidate`, and the
 * content script re-verifies the link as a safe same-origin link first.
 */
export async function clickDiscoveredLink(
  tabId: number,
  frameId: number,
  domPath: string,
): Promise<ClickCandidateResult> {
  return requestClick(tabId, frameId, "click-dom-health-link", domPath);
}

export interface NavigationModel {
  usesHistoryApiRouting: boolean;
  historyApiCallCount: number;
}

/** Whether the tab's top frame appears to use client-side (pushState/replaceState/popstate) routing — diagnostic only, never affects the score. */
export async function getNavigationModel(
  tabId: number,
): Promise<NavigationModel> {
  const response = await sendFrameMessage<NavigationModel>(
    tabId,
    0,
    { request: "get-dom-health-navigation-model" },
    DISCOVERY_FRAME_TIMEOUT_MS,
  );
  if (!response.success || !response.data) {
    return { usesHistoryApiRouting: false, historyApiCallCount: 0 };
  }
  return response.data;
}

export interface ElementPathReplaySample {
  fingerprint: string;
  ref: ElementRef;
}

export interface ElementPathReplayResponseItem {
  fingerprint: string;
  verdict: CrossStateVerdict;
  brokenAtHop?: number;
  hostSelector?: string;
  legacy?: boolean;
}

/**
 * Replay element paths CAPTURED at some other application state against
 * `frameId`'s CURRENT live DOM — the cross-application-state selector
 * validation primitive (spec section 7: "can the selector/config captured
 * in one application state still resolve correctly when the application
 * changes state"). Delegates entirely to `@apty/dom-snapshot`'s
 * `replayElementRefs` inside the content script, which resolves each
 * sample from the top of the frame's document through its shadow hosts
 * — never regenerates a fresh path from the current DOM and
 * compares it to the old one. A frame that doesn't respond (or has none of
 * the requested samples reachable) contributes nothing rather than a
 * fabricated verdict.
 */
export async function replayElementPathSamplesInFrame(
  tabId: number,
  frameId: number,
  samples: ElementPathReplaySample[],
): Promise<ElementPathReplayResponseItem[]> {
  if (samples.length === 0) return [];
  const response = await sendFrameMessage<ElementPathReplayResponseItem[]>(
    tabId,
    frameId,
    { request: "replay-dom-health-element-paths", samples },
    DISCOVERY_FRAME_TIMEOUT_MS,
  );
  if (!response.success || !response.data) return [];
  return response.data;
}
