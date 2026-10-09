/**
 * DOM snapshot and DOM Health responder, one per frame.
 *
 * Declared at document_start in every frame (see the manifest) and free of
 * React, so it registers as soon as its small chunk loads, and a frame
 * answers even when it has no <body>, never mounts UI, or is still parsing. The side panel can also
 * inject this file into a frame whose declared script never ran or belongs
 * to a previous extension instance (see frame-tree.ts in browser-runtime).
 */
import {
  closestComposed,
  collectDiscoverableLinks,
  collectDomHealthSnapshot,
  collectDomSnapshot,
  collectFrameOwners,
  collectRouteProbeFrameSignals,
  collectSafeNavigationCandidates,
  composedText,
  computeFrameStateSignature,
  ignoredRootPolicy,
  isSafeNavigationCandidate,
  isSafeToDiscover,
  replayElementRefs,
  resolveDomPath,
  shadowRootOf,
} from "@apty/dom-snapshot";
import { startCapture, stopCapture } from "./element-capture";
import {
  HISTORY_API_EVENT,
  HISTORY_SYNC_REQUEST_EVENT,
  type HistoryApiTotals,
  parseHistoryTotals,
  SHADOW_ATTACHED_EVENT,
  ZERO_HISTORY_TOTALS,
} from "./page-events";

type SendResponse = (response: unknown) => void;

interface FrameResponderMarker {
  isAlive: () => boolean;
}

const MARKER_KEY = "__aptyFrameResponder";

let historyTotals: HistoryApiTotals = { ...ZERO_HISTORY_TOTALS };
let listeningForHistoryApi = false;

function historyApiCallCount(): number {
  return (
    historyTotals.pushState +
    historyTotals.replaceState +
    historyTotals.popstate +
    historyTotals.hashchange
  );
}

/**
 * Client-side routing evidence, counted in the page's world by the
 * MAIN-world hooks (`page-hooks.ts`): this isolated world has its own
 * `history` wrappers and cannot see the page's `pushState` calls itself
 * (re-audit finding N-3). The hooks announce running totals since the
 * document started; asking once on install picks up navigation that
 * happened while this script was still loading. Totals only ever grow, so
 * an out-of-order announcement never lowers them.
 */
function listenForHistoryApi(): void {
  if (listeningForHistoryApi) return;
  listeningForHistoryApi = true;
  window.addEventListener(HISTORY_API_EVENT, (event) => {
    const totals = parseHistoryTotals((event as CustomEvent).detail);
    if (!totals) return;
    historyTotals = {
      pushState: Math.max(historyTotals.pushState, totals.pushState),
      replaceState: Math.max(historyTotals.replaceState, totals.replaceState),
      popstate: Math.max(historyTotals.popstate, totals.popstate),
      hashchange: Math.max(historyTotals.hashchange, totals.hashchange),
    };
  });
  window.dispatchEvent(new CustomEvent(HISTORY_SYNC_REQUEST_EVENT));
}

export interface RouteProbeRequest {
  origin: string;
  path: string;
  initiatorType: string;
  msAfterClick: number;
}

interface RouteProbeState {
  lastClickAt: number | null;
  firstRequest: RouteProbeRequest | null;
  observer: PerformanceObserver | null;
}

let routeProbe: RouteProbeState | null = null;

/** Resource timings that can mean "the screen changed": API calls and frame loads, not images or fonts. */
const PROBE_REQUEST_INITIATORS = new Set([
  "fetch",
  "xmlhttprequest",
  "iframe",
  "frame",
  "beacon",
]);

const PROBE_CLICK_TARGET =
  'a, button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="treeitem"], [role="option"], input, select, label, summary';

/** Keep the first API call or frame load that started after the last probe click. */
export function recordFirstRequest(entries: PerformanceEntryList): void {
  const probe = routeProbe;
  if (!probe || probe.lastClickAt === null || probe.firstRequest) return;
  for (const entry of entries as PerformanceResourceTiming[]) {
    if (entry.startTime < probe.lastClickAt) continue;
    if (!PROBE_REQUEST_INITIATORS.has(entry.initiatorType)) continue;
    try {
      const url = new URL(entry.name);
      probe.firstRequest = {
        origin: url.origin,
        path: url.pathname,
        initiatorType: entry.initiatorType,
        msAfterClick: Math.round(entry.startTime - probe.lastClickAt),
      };
      return;
    } catch {
      // A resource name that is not a URL carries no path to report.
    }
  }
}

/** Record a user click on `target` (the innermost element, inside any shadow root) and tell the probe which control it was. */
export function noteProbeClick(target: EventTarget | null, at: number): void {
  if (!routeProbe) return;
  routeProbe.lastClickAt = at;
  routeProbe.firstRequest = null;
  const control =
    target instanceof Element
      ? (closestComposed(target, PROBE_CLICK_TARGET) ?? target)
      : null;
  try {
    void chrome.runtime
      .sendMessage({
        request: "dom-health-probe-click",
        label: control ? composedText(control, 80) : "",
      })
      .catch(() => {});
  } catch {
    // The probe's listener may be gone (side panel closed); the click itself is unaffected.
  }
}

function onProbeClick(event: MouseEvent): void {
  if (!event.isTrusted) return;
  noteProbeClick(event.composedPath()[0] ?? null, performance.now());
}

/**
 * Start recording for the route probe: user clicks (trusted only, so the
 * audit's own `click()` calls never count) and the first API call or frame
 * load after each one, from the page's own resource timing. Reads timings
 * only; no request is intercepted and network capture stays off.
 */
function armRouteProbe(): { armed: true } {
  if (!routeProbe) {
    routeProbe = { lastClickAt: null, firstRequest: null, observer: null };
    document.addEventListener("click", onProbeClick, true);
    if (typeof PerformanceObserver === "function") {
      try {
        const observer = new PerformanceObserver((list) =>
          recordFirstRequest(list.getEntries()),
        );
        observer.observe({ type: "resource", buffered: false });
        routeProbe.observer = observer;
      } catch {
        routeProbe.observer = null;
      }
    }
  }
  return { armed: true };
}

function disarmRouteProbe(): { armed: false } {
  if (routeProbe) {
    document.removeEventListener("click", onProbeClick, true);
    routeProbe.observer?.disconnect();
    routeProbe = null;
  }
  return { armed: false };
}

function frameIdOf(element: Element): number | null {
  try {
    const getFrameId = (
      chrome.runtime as unknown as {
        getFrameId?: (target: Element) => number;
      }
    ).getFrameId;
    const id = getFrameId?.(element);
    return typeof id === "number" && id >= 0 ? id : null;
  } catch {
    return null;
  }
}

/** Attributes of every `<iframe>` / `<frame>` this document owns, each joined to the `frameId` of the frame it hosts. */
export function frameOwnersWithIds(owners = collectFrameOwners(document)) {
  return owners.map(({ element, ...attributes }) => ({
    ...attributes,
    frameId: frameIdOf(element),
  }));
}

/** One probe step for this frame: what identifies the screen, plus each child frame's owner attributes mapped to its `frameId`. */
export function captureRouteProbeFrame() {
  const { owners, ...signals } = collectRouteProbeFrameSignals(document);
  return {
    ...signals,
    owners: frameOwnersWithIds(owners),
    historyApiCallCount: historyApiCallCount(),
    pushStateCount: historyTotals.pushState,
    firstRequest: routeProbe?.firstRequest ?? null,
    armed: routeProbe !== null,
  };
}

/** Every shadow root (open or closed) under `root`, including nested ones. */
export function collectShadowRoots(root: ParentNode): ShadowRoot[] {
  const found: ShadowRoot[] = [];
  const visit = (node: ParentNode) => {
    for (const element of Array.from(node.querySelectorAll("*"))) {
      const shadow = shadowRootOf(element);
      if (shadow) {
        found.push(shadow);
        visit(shadow);
      }
    }
  };
  visit(root);
  return found;
}

/**
 * Resolves once the DOM, including every shadow tree, has been quiet for
 * `quietMs`, or `timeoutMs` has elapsed, whichever comes first.
 */
export function waitForDomToStabilize(
  quietMs: number,
  timeoutMs: number,
): Promise<{ settled: boolean; elapsedMs: number }> {
  return new Promise((resolve) => {
    const start = Date.now();
    let resolved = false;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (settled: boolean) => {
      if (resolved) return;
      resolved = true;
      observer.disconnect();
      window.removeEventListener(SHADOW_ATTACHED_EVENT, onShadowAttached);
      if (quietTimer) clearTimeout(quietTimer);
      clearTimeout(timeoutTimer);
      resolve({ settled, elapsedMs: Date.now() - start });
    };

    const options: MutationObserverInit = {
      childList: true,
      subtree: true,
      attributes: true,
    };
    const target = document.body ?? document.documentElement;
    const observed = new WeakSet<Node>();
    const observeNewRoots = () => {
      if (!target) return;
      for (const shadow of collectShadowRoots(target)) {
        if (observed.has(shadow)) continue;
        observed.add(shadow);
        observer.observe(shadow, options);
      }
    };
    const activity = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish(true), quietMs);
    };
    // Roots attached after the wait began are observed too (re-audit
    // finding N-5): an added subtree may bring hosts with roots, and the
    // MAIN-world hooks announce every later `attachShadow`.
    const observer = new MutationObserver((records) => {
      if (
        records.some((record) =>
          Array.from(record.addedNodes).some(
            (node) => node.nodeType === Node.ELEMENT_NODE,
          ),
        )
      ) {
        observeNewRoots();
      }
      activity();
    });
    const onShadowAttached = () => {
      observeNewRoots();
      activity();
    };
    window.addEventListener(SHADOW_ATTACHED_EVENT, onShadowAttached);

    if (target) {
      observer.observe(target, options);
      observeNewRoots();
    }
    quietTimer = setTimeout(() => finish(true), quietMs);
    const timeoutTimer = setTimeout(() => finish(false), timeoutMs);
  });
}

function isLoaded(): boolean {
  return document.readyState === "complete";
}

/**
 * `waitForDomToStabilize`, or — with `onlyWhileLoading` — return at once
 * when this document has already loaded, and otherwise wait for it to load
 * and then go quiet (for a few quiet windows at most). Used for child
 * frames, so a loaded embed that never goes quiet does not hold up the
 * audit.
 */
export async function waitForFrameToSettle(
  quietMs: number,
  timeoutMs: number,
  onlyWhileLoading: boolean,
): Promise<{ settled: boolean; elapsedMs: number }> {
  if (!onlyWhileLoading) return waitForDomToStabilize(quietMs, timeoutMs);
  if (isLoaded()) {
    return { settled: true, elapsedMs: 0 };
  }
  const start = Date.now();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    window.addEventListener(
      "load",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
  const loadedAfter = Date.now() - start;
  // Once loaded, a frame that keeps changing gets a few quiet windows only.
  const quiet = await waitForDomToStabilize(
    quietMs,
    Math.max(0, Math.min(timeoutMs - loadedAfter, quietMs * 3)),
  );
  return {
    settled: quiet.settled && isLoaded(),
    elapsedMs: loadedAfter + quiet.elapsedMs,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function respondAsync(
  sendResponse: SendResponse,
  fallbackError: string,
  work: () => Promise<unknown> | unknown,
): true {
  Promise.resolve()
    .then(work)
    .then(
      (data) => sendResponse({ success: true, data }),
      (error) =>
        sendResponse({
          success: false,
          error: errorMessage(error, fallbackError),
        }),
    );
  return true;
}

/** The user's extra ignored-root entries from a request; anything that is not a list of strings counts as none. */
function settingsEntries(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Paths may cross shadow boundaries (`buildComposedDomPath`), so they are resolved hop by hop, never with one `querySelector`. */
export function clickSafeNavigationCandidate(domPath: unknown) {
  const path = typeof domPath === "string" ? domPath : "";
  const target = path ? resolveDomPath(document, path) : null;
  const stillSafe =
    target &&
    collectSafeNavigationCandidates(document).some(
      (c) => c.domPath === path && isSafeNavigationCandidate(c),
    );
  if (!target || !stillSafe) {
    return {
      clicked: false,
      reason:
        "This control could no longer be found, or no longer verifies as a safe navigation candidate.",
    };
  }
  (target as HTMLElement).click();
  return { clicked: true };
}

/**
 * Click a link the audit discovered, to reach its page by in-app
 * navigation when loading its URL directly does not reproduce the page.
 * Re-verified first, exactly like `collectDiscoverableLinks` filtered it:
 * still present at the same path, same-origin, and not destructive-looking.
 */
export function clickDiscoveredLink(domPath: unknown) {
  const path = typeof domPath === "string" ? domPath : "";
  const target = path ? resolveDomPath(document, path) : null;
  const stillSafe =
    target &&
    collectDiscoverableLinks(document).some(
      (link) => link.domPath === path && isSafeToDiscover(link),
    );
  if (!target || !stillSafe) {
    return {
      clicked: false,
      reason:
        "This link could no longer be found, or no longer verifies as a safe same-origin link.",
    };
  }
  (target as HTMLElement).click();
  return { clicked: true };
}

/**
 * Handle one message addressed to this frame. Returns true when it will
 * answer (asynchronously), false when the message is not for this
 * responder.
 */
export function handleFrameMessage(
  message: any,
  sendResponse: SendResponse,
): boolean {
  if (
    message?.type === "aipex:collect-dom-snapshot" ||
    message?.request === "collect-dom-snapshot"
  ) {
    return respondAsync(sendResponse, "Failed to collect DOM snapshot", () =>
      collectDomSnapshot(document, message.options),
    );
  }

  switch (message?.request) {
    case "start-capture":
    case "stop-capture":
      try {
        if (message.request === "start-capture") startCapture();
        else stopCapture();
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({
          success: false,
          error: errorMessage(error, String(error)),
        });
      }
      return true;
    case "dom-health-ping":
      sendResponse({ success: true, data: { pong: true } });
      return true;
    case "collect-dom-health-frame-bundle":
      return respondAsync(
        sendResponse,
        "Failed to collect a DOM Health frame bundle",
        async () => {
          const ignoredRoots = settingsEntries(message.ignoredRoots);
          const snapshot = await collectDomHealthSnapshot(document, {
            freshAudit: (message.sequenceIndex ?? 0) === 0,
            maxInteractiveElements:
              typeof message.maxInteractiveElements === "number"
                ? message.maxInteractiveElements
                : undefined,
            frameContext: message.frameContext ?? null,
            ignoredRoots,
          });
          return {
            snapshot,
            stateSignature: computeFrameStateSignature(document, {
              ignoredRoots,
            }),
          };
        },
      );
    case "collect-dom-health-links":
      return respondAsync(
        sendResponse,
        "Failed to collect discoverable links",
        () => collectDiscoverableLinks(document),
      );
    case "collect-dom-health-safe-navigation-candidates":
      return respondAsync(
        sendResponse,
        "Failed to collect safe navigation candidates",
        () => collectSafeNavigationCandidates(document),
      );
    case "click-safe-navigation-candidate":
      return respondAsync(
        sendResponse,
        "Failed to click this navigation candidate",
        () => clickSafeNavigationCandidate(message.domPath),
      );
    case "click-dom-health-link":
      return respondAsync(sendResponse, "Failed to click this link", () =>
        clickDiscoveredLink(message.domPath),
      );
    case "wait-for-dom-stable":
      return respondAsync(sendResponse, "Failed to wait for the DOM", () =>
        waitForFrameToSettle(
          typeof message.quietMs === "number" ? message.quietMs : 400,
          typeof message.timeoutMs === "number" ? message.timeoutMs : 8000,
          message.onlyWhileLoading === true,
        ),
      );
    case "get-dom-health-navigation-model":
      sendResponse({
        success: true,
        data: {
          usesHistoryApiRouting: historyApiCallCount() > 0,
          historyApiCallCount: historyApiCallCount(),
          pushStateCount: historyTotals.pushState,
        },
      });
      return true;
    case "replay-dom-health-element-paths":
      return respondAsync(
        sendResponse,
        "Failed to replay stored element paths",
        () =>
          replayElementRefs(
            document,
            Array.isArray(message.samples) ? message.samples : [],
          ),
      );
    case "collect-dom-health-frame-owners":
      return respondAsync(
        sendResponse,
        "Failed to read this document's frame elements",
        () =>
          frameOwnersWithIds(
            collectFrameOwners(
              document,
              ignoredRootPolicy(settingsEntries(message.ignoredRoots)),
            ),
          ),
      );
    case "dom-health-probe-arm":
      sendResponse({ success: true, data: armRouteProbe() });
      return true;
    case "dom-health-probe-disarm":
      sendResponse({ success: true, data: disarmRouteProbe() });
      return true;
    case "dom-health-probe-capture":
      return respondAsync(
        sendResponse,
        "Failed to capture route probe signals",
        captureRouteProbeFrame,
      );
    default:
      return false;
  }
}

function runtimeAliveCheck(runtime: typeof chrome.runtime): () => boolean {
  return () => {
    try {
      return chrome.runtime === runtime && Boolean(runtime.id);
    } catch {
      return false;
    }
  };
}

/**
 * Install once per live extension instance. A marker left by a previous
 * instance (after an extension reload) is bound to a dead runtime, so a
 * fresh responder replaces it.
 */
export function installFrameResponder(): boolean {
  const scope = globalThis as unknown as Record<string, FrameResponderMarker>;
  if (scope[MARKER_KEY]?.isAlive()) return false;
  if (!chrome.runtime?.onMessage) return false;

  listenForHistoryApi();
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) =>
    handleFrameMessage(message, sendResponse),
  );
  scope[MARKER_KEY] = { isAlive: runtimeAliveCheck(chrome.runtime) };
  return true;
}

installFrameResponder();
