/**
 * Apty Widget diagnostics
 *
 * STATUS: partially implemented. The Widget runs as page-injected JS on the
 * same page (not a separate extension), so this can probe it directly via
 * `chrome.scripting.executeScript` in the MAIN world — no extension
 * messaging or configuration is required.
 *
 * CONTRACT (not yet implemented by the Apty Widget — coordinate with the
 * Widget team to add this): the Widget should set
 * `window.__APTY_WIDGET__` to an object shaped like:
 *
 *   {
 *     loaded: boolean,
 *     initialized: boolean,
 *     visible: boolean,
 *     lastError?: string,
 *     getLogs?: () => Array<{ level: string; message: string; timestamp: number }>,
 *   }
 *
 * Until the Widget sets this, getStatus()/getLogs() report
 * `status: "not_configured"` — this is expected, not a bug, and is the
 * signal that Apty-side work is still needed (see docs/apty-integration.md).
 */

import { redactLogs } from "./redact";
import type {
  AptyLog,
  AptyWidgetDiagnosticsProvider,
  AptyWidgetStatus,
} from "./types";

interface RawAptyWidgetBridge {
  loaded?: boolean;
  initialized?: boolean;
  visible?: boolean;
  lastError?: string;
  getLogs?: () => Array<{ level: string; message: string; timestamp: number }>;
}

interface WidgetProbeResult {
  present: boolean;
  domPresent: boolean;
  bridge?: RawAptyWidgetBridge;
}

export class ScriptingWidgetDiagnosticsProvider
  implements AptyWidgetDiagnosticsProvider
{
  constructor(private readonly getTabId: () => Promise<number>) {}

  async getStatus(): Promise<AptyWidgetStatus> {
    const tabId = await this.getTabId();
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          const bridge = (
            window as { __APTY_WIDGET__?: RawAptyWidgetBridge }
          ).__APTY_WIDGET__;
          const domPresent = Boolean(
            document.querySelector('[id^="apty-"], [class*="apty-widget"]'),
          );
          return { present: Boolean(bridge), domPresent, bridge };
        },
      });

      const result = results[0]?.result as WidgetProbeResult | undefined;

      if (!result?.present) {
        return {
          status: "not_configured",
          domPresent: result?.domPresent ?? false,
        };
      }

      return {
        status: "ok",
        loaded: result.bridge?.loaded,
        initialized: result.bridge?.initialized,
        domPresent: result.domPresent,
        visible: result.bridge?.visible,
        lastError: result.bridge?.lastError,
      };
    } catch (error) {
      return {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getLogs(): Promise<AptyLog[]> {
    const tabId = await this.getTabId();
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          const bridge = (
            window as { __APTY_WIDGET__?: RawAptyWidgetBridge }
          ).__APTY_WIDGET__;
          return bridge?.getLogs ? bridge.getLogs() : [];
        },
      });

      const raw = (results[0]?.result as AptyLog[] | undefined) ?? [];
      return redactLogs(
        raw.map((entry) => ({
          level: (entry.level as AptyLog["level"]) ?? "log",
          message: entry.message,
          timestamp: entry.timestamp,
        })),
      );
    } catch {
      return [];
    }
  }
}

/** Stub used until a tab context is available (e.g. no active tab). */
export class NotConfiguredWidgetDiagnosticsProvider
  implements AptyWidgetDiagnosticsProvider
{
  async getStatus(): Promise<AptyWidgetStatus> {
    return { status: "not_configured" };
  }
  async getLogs(): Promise<AptyLog[]> {
    return [];
  }
}
