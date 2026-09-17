/** Internal extension messaging: capture events, tab relays, recording state, sidepanel and chat-image download requests. */

import { downloadChatImagesInBackground } from "./downloads";
import { setIsRecording } from "./recording";
import { openSidePanelOnDemand } from "./sidepanel";

export function registerMessageRouter(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Echo capture events to all extension contexts
    if (message.request === "capture-click-event") {
      try {
        // Immediately acknowledge sender (content script)
        sendResponse({ success: true });
        // Re-broadcast so sidepanel listeners reliably receive it
        chrome.runtime
          .sendMessage({ request: "capture-click-event", data: message.data })
          .catch(() => {
            // Ignore broadcast errors (OK if no receivers)
          });
        // Persist latest event for sidepanel to pick up via storage change
        chrome.storage.local
          .set({
            aipex_last_capture_event: { data: message.data, ts: Date.now() },
          })
          .catch((err) => {
            console.warn("⚠️ Failed to persist capture event:", err);
          });
      } catch (err) {
        console.error("❌ Failed to echo capture event:", err);
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    // Relay a message to the active tab's content script
    if (message.request === "relay-to-active-tab") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId && message.message) {
          chrome.tabs
            .sendMessage(tabId, message.message)
            .then(() => sendResponse({ success: true }))
            .catch((err) => {
              sendResponse({
                success: false,
                error: err instanceof Error ? err.message : String(err),
              });
            });
        } else {
          sendResponse({ success: false, error: "No active tab" });
        }
      });
      return true;
    }

    // Recording lifecycle markers
    if (message.request === "start-recording") {
      setIsRecording(true);
      sendResponse({ success: true });
      return true;
    }
    if (message.request === "stop-recording") {
      setIsRecording(false);
      sendResponse({ success: true });
      return true;
    }

    // Open sidepanel on demand (e.g. from content script)
    if (message.request === "open-sidepanel") {
      (async () => {
        try {
          await openSidePanelOnDemand(_sender);
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      return true;
    }

    // Collect screenshots from sidepanel and trigger downloads
    if (message.request === "get-current-chat-images-for-download") {
      (async () => {
        try {
          const {
            folderPrefix,
            imageNames,
            filenamingStrategy,
            displayResults,
          } = message as {
            folderPrefix?: string;
            imageNames?: string[];
            filenamingStrategy?: string;
            displayResults?: boolean;
          };

          // Try to get images from sidepanel
          try {
            const sidepanelResponse = await chrome.runtime.sendMessage({
              request: "provide-current-chat-images",
              folderPrefix,
              imageNames,
              filenamingStrategy,
              displayResults,
            });

            if (
              sidepanelResponse?.images &&
              sidepanelResponse.images.length > 0
            ) {
              const result = await downloadChatImagesInBackground(
                sidepanelResponse.images,
                folderPrefix,
                imageNames,
              );
              sendResponse({
                success: result.success,
                downloadedCount: result.downloadedCount,
                downloadIds: result.downloadIds,
                folderPath: folderPrefix,
                filesList: result.filesList,
                error: result.errors?.join(", "),
              });
            } else {
              sendResponse({
                success: false,
                error: "No images found in current chat",
              });
            }
          } catch {
            // Fallback: try active tab content script
            try {
              const [activeTab] = await chrome.tabs.query({
                active: true,
                currentWindow: true,
              });
              if (activeTab?.id) {
                const tabResponse = await chrome.tabs.sendMessage(
                  activeTab.id,
                  {
                    request: "provide-current-chat-images",
                    folderPrefix,
                    imageNames,
                    filenamingStrategy,
                    displayResults,
                  },
                );
                if (tabResponse?.images && tabResponse.images.length > 0) {
                  const result = await downloadChatImagesInBackground(
                    tabResponse.images,
                    folderPrefix,
                    imageNames,
                  );
                  sendResponse({
                    success: result.success,
                    downloadedCount: result.downloadedCount,
                    downloadIds: result.downloadIds,
                    folderPath: folderPrefix,
                    filesList: result.filesList,
                    error: result.errors?.join(", "),
                  });
                } else {
                  sendResponse({
                    success: false,
                    error: "No images found in current chat",
                  });
                }
              } else {
                sendResponse({
                  success: false,
                  error: "Unable to access current chat",
                });
              }
            } catch (_tabError) {
              sendResponse({
                success: false,
                error: "Unable to access current chat images",
              });
            }
          }
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      return true;
    }

    return false;
  });
}
