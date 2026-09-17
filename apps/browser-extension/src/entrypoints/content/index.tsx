import {
  collectDiscoverableLinks,
  collectDomHealthSnapshot,
  collectDomSnapshot,
} from "@apty/dom-snapshot";
import { FakeMouse } from "@apty/ui/components/fake-mouse";
import type { FakeMouseController } from "@apty/ui/components/fake-mouse/types";
import type { OmniCommandGroup } from "@apty/ui/components/omni";
import { Omni } from "@apty/ui/components/omni";
import { MessageSquareText } from "lucide-react";
import React from "react";
import ReactDOM from "react-dom/client";
// Import CSS as a string to inject into Shadow DOM
import tailwindCss from "../../styles/tailwind.css?inline";

interface CaptureState {
  isCapturing: boolean;
  highlightedElement: Element | null;
}

/**
 * SPA navigation-model detection (spec section 24) — installed once, at
 * module scope, when this content script loads (which happens fresh on
 * every real page navigation, per the manifest). `history` is a shared
 * platform object between the isolated content-script world and the
 * page's own main-world script, so patching it here also observes the
 * page's own `pushState`/`replaceState` calls — diagnostic only, never
 * used to decide safety or to affect the DOM Health score.
 */
let historyApiCallCount = 0;
if (
  typeof history !== "undefined" &&
  !(history as any).__aptyDomHealthPatched
) {
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
}

/**
 * DOM-stabilization signal for the application-wide audit (spec section 5)
 * — reports once the DOM has been quiet for `quietMs`, or `timeoutMs` has
 * elapsed, whichever comes first. A MutationObserver-based quiet period,
 * never a fixed sleep, so a debounced re-render gets real time to settle.
 */
function waitForDomToStabilize(
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
      resolve({ settled, elapsedMs: Date.now() - start });
    };

    const observer = new MutationObserver(() => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish(true), quietMs);
    });

    const target = document.body ?? document.documentElement;
    if (target) {
      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    }
    // Starts the quiet-period clock immediately in case nothing mutates again.
    quietTimer = setTimeout(() => finish(true), quietMs);
    setTimeout(() => finish(false), timeoutMs);
  });
}

const OMNI_COMMAND_GROUPS: OmniCommandGroup[] = [
  {
    heading: "Apty",
    items: [
      {
        id: "open-apty-live-debugging",
        label: "Open Apty Live Debugging",
        icon: MessageSquareText,
        onSelect: () => {
          chrome.runtime.sendMessage({ request: "open-sidepanel" });
        },
      },
    ],
  },
];

const ContentApp = () => {
  const [isOmniOpen, setIsOmniOpen] = React.useState(false);
  const fakeMouseRef = React.useRef<FakeMouseController | null>(null);
  const captureStateRef = React.useRef<CaptureState>({
    isCapturing: false,
    highlightedElement: null,
  });

  const generateCssSelector = React.useCallback((element: Element): string => {
    const path: string[] = [];
    let current: Element | null = element;
    let depth = 0;
    const maxDepth = 5;

    while (current && current !== document.body && depth < maxDepth) {
      let selector = current.tagName.toLowerCase();

      // Add ID if present
      if (current.id) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break;
      }

      // Add classes (filter out temp classes)
      if (current.classList.length > 0) {
        const classes = Array.from(current.classList)
          .filter((c) => !c.startsWith("plasmo-") && !c.startsWith("aipex-"))
          .slice(0, 2)
          .join(".");
        if (classes) {
          selector += `.${classes}`;
        }
      }

      // Add nth-child for specificity
      if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children);
        const index = siblings.indexOf(current) + 1;
        if (siblings.length > 1) {
          selector += `:nth-child(${index})`;
        }
      }

      path.unshift(selector);
      current = current.parentElement;
      depth++;
    }

    return path.join(" > ");
  }, []);

  const stopCapture = React.useCallback(() => {
    console.log("🛑 Stopping element capture mode");
    captureStateRef.current.isCapturing = false;

    // Remove highlight
    if (captureStateRef.current.highlightedElement) {
      captureStateRef.current.highlightedElement.classList.remove(
        "aipex-capture-highlight",
      );
      captureStateRef.current.highlightedElement = null;
    }

    // Cleanup event listeners
    if ((window as any).__aipexCaptureCleanup) {
      (window as any).__aipexCaptureCleanup();
      delete (window as any).__aipexCaptureCleanup;
    }
  }, []);

  // Capture functionality
  const startCapture = React.useCallback(() => {
    if (captureStateRef.current.isCapturing) {
      console.warn("⚠️ Capture already in progress");
      return;
    }

    console.log("🎯 Starting element capture mode");
    captureStateRef.current.isCapturing = true;

    const handleMouseOver = (e: MouseEvent) => {
      if (!captureStateRef.current.isCapturing) return;

      const target = e.target as Element;
      if (!target) return;

      // Remove previous highlight
      if (captureStateRef.current.highlightedElement) {
        captureStateRef.current.highlightedElement.classList.remove(
          "aipex-capture-highlight",
        );
      }

      // Add highlight to current element
      target.classList.add("aipex-capture-highlight");
      captureStateRef.current.highlightedElement = target;
    };

    const handleClick = (e: MouseEvent) => {
      if (!captureStateRef.current.isCapturing) return;

      e.preventDefault();
      e.stopPropagation();

      const target = e.target as Element;
      if (!target) return;

      console.log("🎯 Element captured:", target);

      // Generate selector
      const selector = generateCssSelector(target);

      // Collect element data
      const rect = target.getBoundingClientRect();
      const data = {
        timestamp: Date.now(),
        url: window.location.href,
        tagName: target.tagName.toLowerCase(),
        selector,
        id: target.id || undefined,
        classes: Array.from(target.classList).filter(
          (c) => !c.startsWith("aipex-") && !c.startsWith("plasmo-"),
        ),
        textContent: target.textContent?.trim().substring(0, 200) || undefined,
        attributes: Array.from(target.attributes).reduce(
          (acc, attr) => {
            if (!attr.name.startsWith("data-plasmo")) {
              acc[attr.name] = attr.value;
            }
            return acc;
          },
          {} as Record<string, string>,
        ),
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      };

      // Send to background
      chrome.runtime
        .sendMessage({
          request: "capture-click-event",
          data,
        })
        .catch((err) => {
          console.error("❌ Failed to send capture event:", err);
        });

      // Stop capture
      stopCapture();
    };

    // Add event listeners
    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("click", handleClick, true);

    // Store cleanup functions
    (window as any).__aipexCaptureCleanup = () => {
      document.removeEventListener("mouseover", handleMouseOver, true);
      document.removeEventListener("click", handleClick, true);
    };

    // Add CSS for highlight
    if (!document.getElementById("aipex-capture-styles")) {
      const style = document.createElement("style");
      style.id = "aipex-capture-styles";
      style.textContent = `
        .aipex-capture-highlight {
          outline: 2px solid #3b82f6 !important;
          outline-offset: 2px !important;
          cursor: crosshair !important;
        }
      `;
      document.head.appendChild(style);
    }
  }, [generateCssSelector, stopCapture]);

  // Message listener for external triggers (keyboard shortcuts from background)
  React.useEffect(() => {
    const handleMessage = (message: any, _sender: any, sendResponse: any) => {
      if (message.request === "open-apty-agent") {
        setIsOmniOpen(true);
        sendResponse({ success: true });
        return true; // Keep message channel open
      } else if (message.request === "close-omni") {
        setIsOmniOpen(false);
        sendResponse({ success: true });
        return true;
      } else if (message.request === "scroll-to-coordinates") {
        // Smooth scroll to coordinates
        const { x, y } = message;
        if (typeof x === "number" && typeof y === "number") {
          window.scrollTo({
            left: x - window.innerWidth / 2,
            top: y - window.innerHeight / 2,
            behavior: "smooth",
          });
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: "Invalid coordinates" });
        }
        return true;
      } else if (message.request === "fake-mouse-move") {
        // Move fake mouse to coordinates
        const { x, y, duration } = message;
        if (
          fakeMouseRef.current &&
          typeof x === "number" &&
          typeof y === "number"
        ) {
          fakeMouseRef.current.show();
          fakeMouseRef.current
            .moveTo(x, y, duration)
            .then(() => {
              sendResponse({ success: true });
            })
            .catch((error) => {
              sendResponse({ success: false, error: error.message });
            });
          return true; // Keep channel open for async response
        } else {
          sendResponse({
            success: false,
            error: "Fake mouse not ready or invalid coordinates",
          });
          return true;
        }
      } else if (message.request === "fake-mouse-play-click-animation") {
        // Play click animation
        if (fakeMouseRef.current) {
          fakeMouseRef.current
            .playClickAnimation()
            .then(() => {
              // Return to center after animation
              const centerX = window.innerWidth / 2;
              const centerY = window.innerHeight / 2;
              return fakeMouseRef.current!.moveTo(centerX, centerY);
            })
            .then(() => {
              fakeMouseRef.current!.hide();
              sendResponse({ success: true });
            })
            .catch((error) => {
              sendResponse({ success: false, error: error.message });
            });
          return true; // Keep channel open for async response
        } else {
          sendResponse({ success: false, error: "Fake mouse not ready" });
          return true;
        }
      } else if (message.request === "start-capture") {
        try {
          console.log("📥 Content script received start-capture message");
          startCapture();
          sendResponse({ success: true });
        } catch (error) {
          console.error("❌ Failed to start capture:", error);
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return true;
      } else if (message.request === "stop-capture") {
        try {
          console.log("📥 Content script received stop-capture message");
          stopCapture();
          sendResponse({ success: true });
        } catch (error) {
          console.error("❌ Failed to stop capture:", error);
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return true;
      } else if (
        message.type === "aipex:collect-dom-snapshot" ||
        message.request === "collect-dom-snapshot"
      ) {
        // DOM snapshot collection for background mode
        (async () => {
          try {
            console.log("📸 Content script collecting DOM snapshot");
            const snapshot = collectDomSnapshot(document, message.options);
            sendResponse({ success: true, data: snapshot });
          } catch (error) {
            console.error("❌ Failed to collect DOM snapshot:", error);
            sendResponse({
              success: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to collect DOM snapshot",
            });
          }
        })();
        return true; // Keep channel open for async response
      } else if (message.request === "collect-dom-health-snapshot") {
        // Apty DOM Health audit — separate from the accessibility-tree
        // snapshot above; see @apty/dom-snapshot's health-collector.
        // `sequenceIndex === 0` starts a fresh audit (resets the collector's
        // cross-snapshot element registry); later snapshots in the same
        // audit continue it so selector stability is tracked correctly.
        // The collector is async (it yields between batches on large
        // pages), so this responds asynchronously like the branch above.
        (async () => {
          try {
            const snapshot = await collectDomHealthSnapshot(document, {
              freshAudit: (message.sequenceIndex ?? 0) === 0,
            });
            sendResponse({ success: true, data: snapshot });
          } catch (error) {
            sendResponse({
              success: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to collect a DOM Health snapshot",
            });
          }
        })();
        return true;
      } else if (message.request === "collect-dom-health-links") {
        // Safe same-origin page discovery for the application-wide audit —
        // see @apty/dom-snapshot's health-links. Only ever reads
        // existing <a href> elements; never simulates a click.
        try {
          const links = collectDiscoverableLinks(document);
          sendResponse({ success: true, data: links });
        } catch (error) {
          sendResponse({
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Failed to collect discoverable links",
          });
        }
        return true;
      } else if (message.request === "wait-for-dom-stable") {
        const quietMs =
          typeof message.quietMs === "number" ? message.quietMs : 400;
        const timeoutMs =
          typeof message.timeoutMs === "number" ? message.timeoutMs : 8000;
        waitForDomToStabilize(quietMs, timeoutMs).then((data) => {
          sendResponse({ success: true, data });
        });
        return true;
      } else if (message.request === "get-dom-health-navigation-model") {
        sendResponse({
          success: true,
          data: {
            usesHistoryApiRouting: historyApiCallCount > 0,
            historyApiCallCount,
          },
        });
        return true;
      }

      return false;
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [startCapture, stopCapture]);

  // Return UI
  return (
    <>
      {isOmniOpen && (
        <Omni
          open={isOmniOpen}
          setOpen={setIsOmniOpen}
          groups={OMNI_COMMAND_GROUPS}
          placeholder="Search Apty commands..."
        />
      )}
      <FakeMouse
        onReady={(controller) => {
          fakeMouseRef.current = controller;
        }}
      />
    </>
  );
};

// ============================================================================
// Breathing Border Overlay — mounted OUTSIDE shadow DOM so z-index works
// against page elements.  Driven by the "aipex-conversation-active" storage key
// which the sidepanel writes as a heartbeat.
// ============================================================================
const HEARTBEAT_KEY = "aipex-conversation-active";
const HEARTBEAT_TTL_MS = 6_000; // Hide overlay if heartbeat is stale (>6 s)

function BorderOverlayApp() {
  const [visible, setVisible] = React.useState(false);

  const handleConversationState = React.useCallback((timestamp: unknown) => {
    if (
      typeof timestamp === "number" &&
      Date.now() - timestamp < HEARTBEAT_TTL_MS
    ) {
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, []);

  React.useEffect(() => {
    // Check on mount
    chrome.storage.local.get(HEARTBEAT_KEY, (result) => {
      handleConversationState(result[HEARTBEAT_KEY]);
    });

    // Listen for changes
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[HEARTBEAT_KEY]) {
        handleConversationState(changes[HEARTBEAT_KEY].newValue);
      }
    };
    chrome.storage.onChanged.addListener(onChange);

    // Poll heartbeat staleness every 3 s
    const interval = setInterval(() => {
      chrome.storage.local.get(HEARTBEAT_KEY, (result) => {
        handleConversationState(result[HEARTBEAT_KEY]);
      });
    }, 3000);

    return () => {
      chrome.storage.onChanged.removeListener(onChange);
      clearInterval(interval);
    };
  }, [handleConversationState]);

  if (!visible) return null;

  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          zIndex: 999998,
          pointerEvents: "none",
          animation: "aipexBreathe 2.5s ease-in-out infinite",
          boxShadow: `
            inset 0 0 15px 3px rgba(37, 99, 235, 0.5),
            inset 0 0 25px 5px rgba(59, 130, 246, 0.4),
            inset 0 0 35px 7px rgba(96, 165, 250, 0.3),
            inset 0 0 45px 9px rgba(147, 197, 253, 0.2)
          `,
        }}
      />
      <style>{`
        @keyframes aipexBreathe {
          0%, 100% {
            box-shadow:
              inset 0 0 12px 3px rgba(37,99,235,0.35),
              inset 0 0 20px 5px rgba(59,130,246,0.28),
              inset 0 0 28px 6px rgba(96,165,250,0.22),
              inset 0 0 35px 8px rgba(147,197,253,0.15);
          }
          50% {
            box-shadow:
              inset 0 0 20px 5px rgba(37,99,235,0.7),
              inset 0 0 30px 7px rgba(59,130,246,0.6),
              inset 0 0 40px 9px rgba(96,165,250,0.5),
              inset 0 0 50px 11px rgba(147,197,253,0.35);
          }
        }
      `}</style>
    </>
  );
}

// Wait for DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initContentScript);
} else {
  initContentScript();
}

function initContentScript() {
  // Mount the content script (shadow DOM for isolation)
  const container = document.createElement("div");
  container.id = "aipex-content-root";
  document.body.appendChild(container);

  const shadowRoot = container.attachShadow({ mode: "open" });
  const shadowContainer = document.createElement("div");
  shadowRoot.appendChild(shadowContainer);

  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
    }
    ${tailwindCss}
  `;
  shadowRoot.appendChild(style);

  const root = ReactDOM.createRoot(shadowContainer);
  root.render(
    <React.StrictMode>
      <ContentApp />
    </React.StrictMode>,
  );

  // Mount breathing border overlay OUTSIDE shadow DOM so z-index works
  const borderContainer = document.createElement("div");
  borderContainer.id = "aipex-border-overlay";
  document.body.appendChild(borderContainer);

  const borderRoot = ReactDOM.createRoot(borderContainer);
  borderRoot.render(
    <React.StrictMode>
      <BorderOverlayApp />
    </React.StrictMode>,
  );
}
