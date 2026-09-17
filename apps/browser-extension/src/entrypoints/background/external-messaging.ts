/** External Message Listener - Website Integration */

export function registerExternalMessaging(): void {
  // SECURITY: manifest.json's externally_connectable is set to { ids: [] } —
  // no web origin and no other extension is allowlisted, so this listener is
  // intentionally unreachable. The upstream AIPex manifest allowlisted
  // "http://localhost:*/*", which would let ANY page served over localhost
  // (any port) call openWithPrompt below to force-open the side panel and
  // inject a prompt that gets auto-submitted to the AI agent — a realistic
  // local-webpage-to-agent-action escalation. Only re-add a match here for a
  // specific, deliberately-chosen Apty origin, never a wildcard localhost/port.
  chrome.runtime.onMessageExternal.addListener(
    (message, sender, sendResponse) => {
      // Handle "openWithPrompt" action from website
      if (message.action === "openWithPrompt") {
        const prompt = message.prompt;

        if (!prompt || typeof prompt !== "string") {
          sendResponse({ success: false, error: "Invalid prompt" });
          return true;
        }

        // Save prompt to chrome.storage.local with timestamp
        chrome.storage.local.set(
          {
            "aipex-pending-prompt": prompt,
            "aipex-pending-prompt-timestamp": Date.now(),
          },
          () => {
            if (chrome.runtime.lastError) {
              sendResponse({
                success: false,
                error: chrome.runtime.lastError.message,
              });
              return;
            }

            // Open sidepanel
            const windowId = sender.tab?.windowId;

            if (!windowId) {
              chrome.windows
                .getCurrent()
                .then((window) => {
                  if (window.id) {
                    return chrome.sidePanel.open({ windowId: window.id });
                  }
                  throw new Error("No window ID available");
                })
                .then(() => {
                  sendResponse({ success: true });
                })
                .catch((error) => {
                  sendResponse({ success: false, error: error.message });
                });
            } else {
              chrome.sidePanel
                .open({ windowId })
                .then(() => {
                  sendResponse({ success: true });
                })
                .catch((error) => {
                  sendResponse({ success: false, error: error.message });
                });
            }
          },
        );

        return true; // Keep message channel open for async response
      }

      sendResponse({ success: false, error: "Unknown action" });
      return true;
    },
  );
}
