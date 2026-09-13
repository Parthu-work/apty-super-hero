/**
 * Apty integration tools
 *
 * The bridge between the AI agent and Apty-specific runtime state:
 * - `get_apty_page_logs`: generic console/error capture (works on any page,
 *   via the MAIN-world content script in apty-console-bridge.ts).
 * - `get_apty_widget_diagnostics` / `get_apty_client_diagnostics`: probe a
 *   documented `window.__APTY_WIDGET__` / `window.__APTY_CLIENT__` contract
 *   that the Widget/Client do not yet implement — see
 *   packages/browser-runtime/src/apty/widget-diagnostics.ts and
 *   client-diagnostics.ts for the exact contract and current status.
 * - `get_apty_studio_diagnostics` / `get_apty_service_worker_diagnostics`:
 *   require a configured extension ID or diagnostic endpoint (see
 *   packages/browser-ext/.env.example) and Apty-side messaging support that
 *   does not exist yet — these report `status: "not_configured"` until
 *   that's wired up on both sides.
 *
 * All log output is redacted (see apty/redact.ts) before being returned to
 * the model — the page is untrusted and may contain secrets in console
 * output or Apty's own log messages.
 */

import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";
import {
  ConfiguredServiceWorkerDiagnosticsProvider,
  ExternalMessageStudioDiagnosticsProvider,
  getAptyIntegrationConfig,
  NotConfiguredServiceWorkerDiagnosticsProvider,
  NotConfiguredStudioDiagnosticsProvider,
  redactLogs,
  ScriptingClientDiagnosticsProvider,
  ScriptingWidgetDiagnosticsProvider,
} from "../apty/index.js";
import { getActiveTab } from "./tab-utils";

interface AptyConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  message: string;
  timestamp: number;
  source: "console" | "window-error" | "unhandled-rejection";
}

async function getActiveTabId(): Promise<number> {
  const tab = await getActiveTab();
  if (!tab.id) {
    throw new Error("No active tab found");
  }
  return tab.id;
}

/**
 * Read the console/error log buffer captured by apty-console-bridge.ts.
 *
 * Must run in the MAIN world (not the default isolated content-script
 * world) because that's where the buffer lives — it's attached to the
 * page's own `window`, not the extension's isolated one.
 */
export const getAptyPageLogsTool = tool({
  name: "get_apty_page_logs",
  description:
    "Get recent console output and unhandled errors captured on the current page (useful for debugging any Apty issue — widget, studio, or the host application). " +
    "Returns up to `limit` most recent entries, optionally filtered to a minimum severity level. Sensitive values (tokens, cookies, passwords) are redacted.",
  parameters: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe("Maximum number of log entries to return (most recent first)"),
    minLevel: z
      .enum(["debug", "log", "info", "warn", "error"])
      .default("log")
      .describe("Minimum severity to include"),
  }),
  execute: async ({ limit, minLevel }) => {
    const tab = await getActiveTab();
    if (!tab.id) {
      return { available: false, entries: [] };
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: () => {
        return (
          (window as { __aptyAgentConsoleBuffer?: AptyConsoleEntry[] })
            .__aptyAgentConsoleBuffer ?? []
        );
      },
    });

    const buffer = (results[0]?.result as AptyConsoleEntry[] | undefined) ?? [];

    const severityOrder = ["debug", "log", "info", "warn", "error"];
    const minIndex = severityOrder.indexOf(minLevel);

    const filtered = redactLogs(
      buffer
        .filter((entry) => severityOrder.indexOf(entry.level) >= minIndex)
        .slice(-limit)
        .reverse(),
    );

    return {
      available: true,
      url: tab.url,
      count: filtered.length,
      entries: filtered,
    };
  },
});

export const getAptyWidgetDiagnosticsTool = tool({
  name: "get_apty_widget_diagnostics",
  description:
    "Get the Apty Widget's status (loaded, initialized, visible, last error) and recent logs on the current page. " +
    "Returns status: 'not_configured' if the Widget hasn't implemented the diagnostic bridge on this page yet — that is an expected result, not necessarily evidence the Widget is broken.",
  parameters: z.object({}),
  execute: async () => {
    const provider = new ScriptingWidgetDiagnosticsProvider(getActiveTabId);
    const [status, logs] = await Promise.all([
      provider.getStatus(),
      provider.getLogs(),
    ]);
    return { status, logs };
  },
});

export const getAptyClientDiagnosticsTool = tool({
  name: "get_apty_client_diagnostics",
  description:
    "Get the Apty Client's status (loaded, initialized, version) and recent logs on the current page. " +
    "Returns status: 'not_configured' if the Client hasn't implemented the diagnostic bridge on this page yet.",
  parameters: z.object({}),
  execute: async () => {
    const provider = new ScriptingClientDiagnosticsProvider(getActiveTabId);
    const [status, logs] = await Promise.all([
      provider.getStatus(),
      provider.getLogs(),
    ]);
    return { status, logs };
  },
});

export const getAptyStudioDiagnosticsTool = tool({
  name: "get_apty_studio_diagnostics",
  description:
    "Get Apty Studio's status (active, selection mode, last selected selector) and recent logs, via cross-extension messaging. " +
    "Requires studioExtensionId to be configured (see packages/browser-ext/.env.example) AND Studio to implement the corresponding message handler — until both exist, returns status: 'not_configured' or 'unavailable'.",
  parameters: z.object({}),
  execute: async () => {
    const config = await getAptyIntegrationConfig();
    const provider = config.studioExtensionId
      ? new ExternalMessageStudioDiagnosticsProvider(config.studioExtensionId)
      : new NotConfiguredStudioDiagnosticsProvider();
    const [status, logs] = await Promise.all([
      provider.getStatus(),
      provider.getLogs(),
    ]);
    return { status, logs };
  },
});

export const getAptyServiceWorkerDiagnosticsTool = tool({
  name: "get_apty_service_worker_diagnostics",
  description:
    "Get Apty's service-worker status and recent logs, via a configured extension message channel or diagnostic HTTP endpoint. " +
    "Chrome does not allow one extension to read another's private service-worker memory directly, so this always returns status: 'not_configured' until Apty exposes one of those channels (see packages/browser-ext/.env.example). " +
    "IMPORTANT: the service worker is a single global process shared by every tab, not specific to the current page — do not assume these logs are about the tab you're currently investigating unless a timestamp or message content actually ties them to it.",
  parameters: z.object({}),
  execute: async () => {
    const config = await getAptyIntegrationConfig();
    const provider =
      config.serviceWorkerExtensionId || config.serviceWorkerDiagnosticEndpoint
        ? new ConfiguredServiceWorkerDiagnosticsProvider({
            extensionId: config.serviceWorkerExtensionId,
            diagnosticEndpoint: config.serviceWorkerDiagnosticEndpoint,
          })
        : new NotConfiguredServiceWorkerDiagnosticsProvider();
    const [status, logs] = await Promise.all([
      provider.getStatus(),
      provider.getLogs(),
    ]);
    return {
      status,
      logs,
      scope: "shared-global" as const,
      scopeNote:
        "These logs come from Apty's service worker, which is shared across all tabs and browser windows — they are not specific to the current tab.",
    };
  },
});

export const aptyTools = [
  getAptyPageLogsTool,
  getAptyWidgetDiagnosticsTool,
  getAptyClientDiagnosticsTool,
  getAptyStudioDiagnosticsTool,
  getAptyServiceWorkerDiagnosticsTool,
];
