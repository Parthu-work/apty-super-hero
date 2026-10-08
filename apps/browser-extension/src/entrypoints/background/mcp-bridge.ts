/** WebSocket MCP Bridge: connect/disconnect messaging, badge, keepalive alarms, auto-connect. */

import { createLogger } from "@apty/agent-core";
import { wsMcpServer } from "@apty/browser-runtime";
import { isOwnExtensionPage } from "@apty/browser-runtime/runtime/trusted-sender";

const log = createLogger("McpBridge");

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
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.request === "ws-bridge-connect") {
      // Highest-privilege message this handler accepts (connects to an
      // arbitrary localhost WebSocket with a stored auth token) — restrict
      // to this extension's own pages (sidepanel/options), never a content
      // script running inside an arbitrary, possibly-hostile page.
      if (!isOwnExtensionPage(sender)) {
        sendResponse({ success: false, error: "Unauthorized sender" });
        return true;
      }
      const url = message.url as string;
      const token = message.token as string;
      wsMcpServer
        .connect(url, token)
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
      if (!isOwnExtensionPage(sender)) {
        sendResponse({ success: false, error: "Unauthorized sender" });
        return true;
      }
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
  Promise.all([wsMcpServer.getSavedUrl(), wsMcpServer.getSavedToken()])
    .then(([url, token]) => {
      if (url && token) {
        log.debug("Auto-connecting to saved URL:", url);
        wsMcpServer.connect(url, token).catch(() => {
          // connect() handles its own retry logic
        });
      }
    })
    .catch(() => {
      // Ignore storage errors on startup
    });
}
