/** WebSocket MCP Bridge: connect/disconnect messaging, badge, keepalive alarms, auto-connect. */

import { wsMcpServer } from "@apty/browser-runtime";

function updateMcpBadge(connected: boolean) {
  if (connected) {
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

export function registerMcpBridge(): void {
  // Handle MCP bridge messages
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.request === "ws-bridge-connect") {
      const url = message.url as string;
      wsMcpServer
        .connect(url)
        .then(() => {
          updateMcpBadge(true);
          sendResponse({ success: true });
        })
        .catch((error) => {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true;
    }

    if (message.request === "ws-bridge-disconnect") {
      wsMcpServer
        .disconnect()
        .then(() => {
          updateMcpBadge(false);
          sendResponse({ success: true });
        })
        .catch((error) => {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true;
    }

    if (message.request === "ws-bridge-status") {
      sendResponse(wsMcpServer.getStatus());
      return true;
    }

    return false;
  });

  // Handle keepalive alarms for the WebSocket connection
  chrome.alarms.onAlarm.addListener((alarm) => {
    wsMcpServer.handleAlarm(alarm);
  });

  // Track MCP connection status for badge updates
  wsMcpServer.onStatusChange((state) => {
    updateMcpBadge(state.status === "connected");
  });

  // Auto-connect to saved URL on startup
  wsMcpServer
    .getSavedUrl()
    .then((url) => {
      if (url) {
        console.log("[WsMcpServer] Auto-connecting to saved URL:", url);
        wsMcpServer.connect(url).catch(() => {
          // connect() handles its own retry logic
        });
      }
    })
    .catch(() => {
      // Ignore storage errors on startup
    });
}
