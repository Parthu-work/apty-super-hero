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
  collectDiscoverableLinks,
  collectDomHealthSnapshot,
  collectDomSnapshot,
  collectSafeNavigationCandidates,
  computeFrameStateSignature,
  isSafeNavigationCandidate,
  replayElementPathSamples,
  shadowRootOf,
} from "@apty/dom-snapshot";

type SendResponse = (response: unknown) => void;

interface FrameResponderMarker {
  isAlive: () => boolean;
}

const MARKER_KEY = "__aptyFrameResponder";

let historyApiCallCount = 0;

/**
 * SPA navigation evidence: `history` is shared between the isolated and
 * main worlds, so patching it here also observes the page's own calls.
 */
function patchHistory(): void {
  if (typeof history === "undefined") return;
  if ((history as any).__aptyDomHealthPatched) return;
  (history as any).__aptyDomHealthPatched = true;
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);
  history.pushState = function patchedPushState(...args) {
    historyApiCallCount++;
    return originalPushState(...args);
  };
  history.replaceState = function patchedReplaceState(...args) {
    historyApiCallCount++;
    return originalReplaceState(...args);
  };
  window.addEventListener("popstate", () => {
    historyApiCallCount++;
  });
  window.addEventListener("hashchange", () => {
    historyApiCallCount++;
  });
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
      if (quietTimer) clearTimeout(quietTimer);
      clearTimeout(timeoutTimer);
      resolve({ settled, elapsedMs: Date.now() - start });
    };

    const options: MutationObserverInit = {
      childList: true,
      subtree: true,
      attributes: true,
    };
    const observer = new MutationObserver(() => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish(true), quietMs);
    });

    const target = document.body ?? document.documentElement;
    if (target) {
      observer.observe(target, options);
      for (const shadow of collectShadowRoots(target)) {
        observer.observe(shadow, options);
      }
    }
    quietTimer = setTimeout(() => finish(true), quietMs);
    const timeoutTimer = setTimeout(() => finish(false), timeoutMs);
  });
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

function clickSafeNavigationCandidate(domPath: unknown) {
  const path = typeof domPath === "string" ? domPath : "";
  const target = path ? document.querySelector(path) : null;
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
    case "dom-health-ping":
      sendResponse({ success: true, data: { pong: true } });
      return true;
    case "collect-dom-health-frame-bundle":
      return respondAsync(
        sendResponse,
        "Failed to collect a DOM Health frame bundle",
        async () => {
          const snapshot = await collectDomHealthSnapshot(document, {
            freshAudit: (message.sequenceIndex ?? 0) === 0,
            maxInteractiveElements:
              typeof message.maxInteractiveElements === "number"
                ? message.maxInteractiveElements
                : undefined,
            frameContext: message.frameContext ?? null,
          });
          return {
            snapshot,
            stateSignature: computeFrameStateSignature(document),
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
    case "wait-for-dom-stable":
      return respondAsync(sendResponse, "Failed to wait for the DOM", () =>
        waitForDomToStabilize(
          typeof message.quietMs === "number" ? message.quietMs : 400,
          typeof message.timeoutMs === "number" ? message.timeoutMs : 8000,
        ),
      );
    case "get-dom-health-navigation-model":
      sendResponse({
        success: true,
        data: {
          usesHistoryApiRouting: historyApiCallCount > 0,
          historyApiCallCount,
        },
      });
      return true;
    case "replay-dom-health-element-paths":
      return respondAsync(
        sendResponse,
        "Failed to replay stored element paths",
        () =>
          replayElementPathSamples(
            document,
            Array.isArray(message.samples) ? message.samples : [],
          ),
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

  patchHistory();
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) =>
    handleFrameMessage(message, sendResponse),
  );
  scope[MARKER_KEY] = { isAlive: runtimeAliveCheck(chrome.runtime) };
  return true;
}

installFrameResponder();
