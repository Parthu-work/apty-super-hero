/**
 * Side panel lifecycle: opening it (icon click, on-demand message) and
 * reacting to its port disconnecting.
 */

import { getIsRecording, setIsRecording } from "./recording";

export function registerSidepanelActionClick(): void {
  // Open side panel when extension icon is clicked
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
      chrome.sidePanel.open({ tabId: tab.id });
    }
  });
}

export function registerSidepanelPortLifecycle(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "sidepanel") {
      port.onDisconnect.addListener(() => {
        // When sidepanel closes, stop capture on all tabs if recording was active
        if (getIsRecording()) {
          setIsRecording(false);
          chrome.tabs.query({}).then((tabs) => {
            for (const tab of tabs) {
              if (tab.id) {
                chrome.tabs
                  .sendMessage(tab.id, { request: "stop-capture" })
                  .catch(() => {
                    /* tab may not have content script */
                  });
              }
            }
          });
        }
      });
    }
  });
}

/** Open the side panel on demand (e.g. requested by a content script). */
export async function openSidePanelOnDemand(
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId) {
    await chrome.sidePanel.open({ tabId });
  } else {
    const window = await chrome.windows.getCurrent();
    if (window.id) {
      await chrome.sidePanel.open({ windowId: window.id });
    }
  }
}
