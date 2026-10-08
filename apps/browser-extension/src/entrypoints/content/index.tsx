import { FakeMouse } from "@apty/ui/components/fake-mouse";
import type { FakeMouseController } from "@apty/ui/components/fake-mouse/types";
import type { OmniCommandGroup } from "@apty/ui/components/omni";
import { Omni } from "@apty/ui/components/omni";
import { MessageSquareText } from "lucide-react";
import React from "react";
import ReactDOM from "react-dom/client";
// Import CSS as a string to inject into Shadow DOM
import tailwindCss from "../../styles/tailwind.css?inline";

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
      }

      return false;
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

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

// The UI belongs to the top frame only; frame-responder.ts serves every frame.
if (window === window.top) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initContentScript);
  } else {
    initContentScript();
  }
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
