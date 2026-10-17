/** Opening the side panel: icon click and on-demand message. */

export function registerSidepanelActionClick(): void {
  // Open side panel when extension icon is clicked
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
      chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
        console.warn("[Background] side_panel_open_failed");
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
