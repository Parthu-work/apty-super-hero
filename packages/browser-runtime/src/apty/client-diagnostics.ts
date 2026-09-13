/**
 * Apty Client diagnostics
 *
 * STATUS: not yet implemented against a real contract. The Apty Client is
 * assumed to be page-injected JS (like the Widget), so the same
 * MAIN-world-probe approach applies once the Client team exposes a global.
 *
 * CONTRACT (not yet implemented by Apty Client — coordinate with that team):
 *
 *   window.__APTY_CLIENT__ = {
 *     loaded: boolean,
 *     initialized: boolean,
 *     version?: string,
 *     getLogs?: () => Array<{ level: string; message: string; timestamp: number }>,
 *   }
 *
 * Until that global exists, this always reports `status: "not_configured"`.
 * This file intentionally does not guess a DOM selector for the Client the
 * way widget-diagnostics.ts does for the Widget — the Client isn't
 * necessarily a visible DOM element, so there is nothing safe to probe for
 * short of the documented global.
 */

import { redactLogs } from "./redact";
import type {
  AptyClientDiagnosticsProvider,
  AptyClientStatus,
  AptyLog,
} from "./types";

interface RawAptyClientBridge {
  loaded?: boolean;
  initialized?: boolean;
  version?: string;
  getLogs?: () => Array<{ level: string; message: string; timestamp: number }>;
}

export class ScriptingClientDiagnosticsProvider
  implements AptyClientDiagnosticsProvider
{
  constructor(private readonly getTabId: () => Promise<number>) {}

  async getStatus(): Promise<AptyClientStatus> {
    const tabId = await this.getTabId();
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () =>
          (window as { __APTY_CLIENT__?: RawAptyClientBridge })
            .__APTY_CLIENT__ ?? null,
      });

      const bridge = results[0]?.result as RawAptyClientBridge | null;
      if (!bridge) {
        return { status: "not_configured" };
      }

      return {
        status: "ok",
        loaded: bridge.loaded,
        initialized: bridge.initialized,
        version: bridge.version,
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
          const bridge = (window as { __APTY_CLIENT__?: RawAptyClientBridge })
            .__APTY_CLIENT__;
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

export class NotConfiguredClientDiagnosticsProvider
  implements AptyClientDiagnosticsProvider
{
  async getStatus(): Promise<AptyClientStatus> {
    return { status: "not_configured" };
  }
  async getLogs(): Promise<AptyLog[]> {
    return [];
  }
}
