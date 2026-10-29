/** `PreflightDeps` on the real Chrome APIs, for the Options page. */
import { STORAGE_KEYS } from "@apty/agent-core";
import { getAptyIntegrationConfig } from "@apty/browser-runtime";
import {
  getFrameTree,
  sendFrameMessage,
} from "@apty/browser-runtime/apty/frame-tree";
import { ConfiguredServiceWorkerDiagnosticsProvider } from "@apty/browser-runtime/apty/service-worker-diagnostics";
import {
  CONSOLE_BRIDGE_SCRIPT_ID,
  pageHooksAllowedOn,
} from "@apty/browser-runtime/runtime/page-hooks-registration";
import { isInstalledAndEnabled } from "./apty-client-check";
import { testConnection } from "./connection-check";
import type { FrameAnswer, PreflightDeps } from "./preflight";

const client = (extensionId: string) =>
  new ConfiguredServiceWorkerDiagnosticsProvider({ extensionId });

async function frames(tabId: number): Promise<FrameAnswer[] | null> {
  const tree = await getFrameTree(tabId);
  if (!tree) return null;
  return Promise.all(
    tree
      .filter((frame) => !frame.isAboutBlank)
      .map(async (frame) => {
        const answer = await sendFrameMessage<{ historyHooksSeen?: boolean }>(
          tabId,
          frame.frameId,
          { request: "get-dom-health-navigation-model" },
          3000,
        );
        return {
          frameId: frame.frameId,
          url: frame.url,
          answered: answer.success,
          bridgeSeen: answer.success && answer.data?.historyHooksSeen === true,
        };
      }),
  );
}

export const browserPreflightDeps: PreflightDeps = {
  async loadSettings() {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return stored[STORAGE_KEYS.SETTINGS] ?? {};
  },
  testConnection: (settings) => testConnection(settings),
  async clientId() {
    return (await getAptyIntegrationConfig()).clientExtensionId || undefined;
  },
  clientInstalled: isInstalledAndEnabled,
  clientStatus: (id) => client(id).getStatus(),
  async clientResources(id) {
    const list = await client(id).listResources();
    return {
      ok: list.ok,
      count: list.resources.length,
      urls: list.resources.map((r) => r.url),
    };
  },
  agentId: () => chrome.runtime.id,
  async pageTab() {
    const tabs = await chrome.tabs.query({});
    const pages = tabs
      .filter((tab) => tab.id !== undefined && /^https?:/.test(tab.url ?? ""))
      .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    const tab = pages[0];
    return tab?.id !== undefined && tab.url
      ? { id: tab.id, url: tab.url }
      : null;
  },
  frames,
  async bridgeRegistered() {
    const scripts = await chrome.scripting.getRegisteredContentScripts({
      ids: [CONSOLE_BRIDGE_SCRIPT_ID],
    });
    return scripts.length > 0;
  },
  bridgeAllowedOn: pageHooksAllowedOn,
  async clipboardPermission() {
    try {
      const status = await navigator.permissions.query({
        name: "clipboard-write" as PermissionName,
      });
      return status.state;
    } catch {
      return "unsupported";
    }
  },
  async contentScriptStorage(tabId) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        // Reads a key that never exists: the question is only whether the
        // read is allowed from a content script.
        func: async () => {
          try {
            await chrome.storage.local.get("apty-preflight-probe");
            return "readable";
          } catch {
            return "blocked";
          }
        },
      });
      return result?.result === "readable" || result?.result === "blocked"
        ? result.result
        : "unknown";
    } catch {
      return "unknown";
    }
  },
};
