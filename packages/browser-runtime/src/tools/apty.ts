/**
 * Apty integration tools
 *
 * These tools are the bridge between the AI agent and Apty-specific context
 * on the current page: console/error logs captured by
 * `apty-console-bridge.ts` (a MAIN-world content script), and — once the
 * Apty widget exposes it — a richer structured debug snapshot.
 *
 * This is a starting scaffold, not a finished integration: it works against
 * any page today (generic console/error capture), and has an extension
 * point ready for a real Apty-widget contract once one exists.
 */

import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";
import { getActiveTab } from "./tab-utils";

interface AptyConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  message: string;
  timestamp: number;
  source: "console" | "window-error" | "unhandled-rejection";
}

/**
 * Read the console/error log buffer captured by apty-console-bridge.ts.
 *
 * Must run in the MAIN world (not the default isolated content-script
 * world) because that's where the buffer lives — it's attached to the
 * page's own `window`, not the extension's isolated one.
 */
export const getAptyDebugLogsTool = tool({
  name: "get_apty_debug_logs",
  description:
    "Get recent console output and unhandled errors captured on the current page (useful for debugging an Apty workflow/widget issue). " +
    "Returns up to `limit` most recent entries, optionally filtered to a minimum severity level.",
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

    const filtered = buffer
      .filter((entry) => severityOrder.indexOf(entry.level) >= minIndex)
      .slice(-limit)
      .reverse();

    return {
      available: true,
      url: tab.url,
      count: filtered.length,
      entries: filtered,
    };
  },
});

/**
 * Read a structured debug snapshot from the Apty widget, if the widget
 * exposes one.
 *
 * CONTRACT (not yet implemented by the Apty widget — this is the extension
 * point for that integration): the widget should set
 * `window.__APTY_WIDGET__.getDebugSnapshot()` returning a JSON-serializable
 * object, e.g. `{ tenantId, workflowId, currentStepId, lastError, ... }`.
 * Until the widget implements this, the tool reports `available: false`.
 */
export const getAptyWidgetSnapshotTool = tool({
  name: "get_apty_widget_snapshot",
  description:
    "Get structured state from the Apty widget on the current page (active workflow, current step, last error), if the widget exposes a debug snapshot. " +
    "Returns available: false if no Apty widget debug bridge is present on this page.",
  parameters: z.object({}),
  execute: async () => {
    const tab = await getActiveTab();
    if (!tab.id) {
      return { available: false };
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: () => {
        const bridge = (
          window as {
            __APTY_WIDGET__?: { getDebugSnapshot?: () => unknown };
          }
        ).__APTY_WIDGET__;

        if (!bridge || typeof bridge.getDebugSnapshot !== "function") {
          return { available: false };
        }

        try {
          return { available: true, snapshot: bridge.getDebugSnapshot() };
        } catch (error) {
          return {
            available: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    });

    return results[0]?.result ?? { available: false };
  },
});

export const aptyTools = [getAptyDebugLogsTool, getAptyWidgetSnapshotTool];
