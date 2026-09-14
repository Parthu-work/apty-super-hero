/**
 * DevTools (CDP) diagnostic tools
 *
 * These exist because content scripts genuinely cannot see this
 * information — there is no DOM/JS API for network request/response
 * status, headers, or timing, and no reliable way to retroactively read
 * browser-level log entries (CSP violations, deprecation warnings, uncaught
 * exceptions with stack traces) the way `get_apty_page_logs` reads
 * console.* calls. Only the Chrome DevTools Protocol (via the `debugger`
 * permission) exposes that.
 *
 * IMPORTANT LIMITATION: CDP only observes events from the moment a domain
 * is enabled onward — it cannot retroactively return network requests or
 * log entries that already happened before this tool was called. Each tool
 * attaches the debugger, opens a short capture window, and returns
 * whatever occurred during that window. If nothing relevant happened while
 * it was running, ask the user to reproduce the issue, then call again.
 *
 * All response/request headers are redacted before being returned to the
 * model (see apty/redact.ts) — the page is untrusted and may pass secrets
 * in headers.
 */

import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";
import { recordEvidence } from "../apty/index.js";
import { redactHeaders, redactSensitiveText } from "../apty/redact.js";
import { CdpCommander } from "../automation/cdp-commander.js";
import { debuggerManager } from "../automation/debugger-manager.js";
import { resolveDiagnosticTab, type ToolRunContext } from "./tab-utils";

const MIN_WINDOW_MS = 500;
const MAX_WINDOW_MS = 15000;
const DEFAULT_WINDOW_MS = 3000;

function clampWindow(windowMs: number): number {
  return Math.min(MAX_WINDOW_MS, Math.max(MIN_WINDOW_MS, windowMs));
}

/**
 * Runs `body` with a temporary chrome.debugger.onEvent listener scoped to
 * `tabId`, collecting every event into `events`, then always detaches —
 * even if `body` throws.
 */
async function withDebuggerEventCapture<T>(
  tabId: number,
  body: (
    cdp: CdpCommander,
    onEvent: (handler: (method: string, params: unknown) => void) => void,
  ) => Promise<T>,
): Promise<T> {
  const attached = await debuggerManager.safeAttachDebugger(tabId);
  if (!attached) {
    throw new Error("Failed to attach debugger to the active tab");
  }

  let handler: ((method: string, params: unknown) => void) | undefined;
  const listener = (
    source: chrome.debugger.Debuggee,
    method: string,
    params?: object,
  ) => {
    if (source.tabId === tabId) {
      handler?.(method, params);
    }
  };

  chrome.debugger.onEvent.addListener(listener);
  try {
    const cdp = new CdpCommander(tabId);
    return await body(cdp, (h) => {
      handler = h;
    });
  } finally {
    chrome.debugger.onEvent.removeListener(listener);
    await debuggerManager.safeDetachDebugger(tabId);
  }
}

interface CapturedRequest {
  requestId: string;
  url: string;
  method: string;
  requestHeaders?: Record<string, string>;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  mimeType?: string;
  failed?: boolean;
  errorText?: string;
  timestamp: number;
}

export const getNetworkDiagnosticsTool = tool({
  name: "get_network_diagnostics",
  description:
    "Watch network requests on the current tab for a short window and return what happened — correlated request/response pairs, status codes, and failures. " +
    "Use this to check for failed API calls (4xx/5xx), CORS errors, or missing requests when debugging an Apty widget/workflow issue. " +
    "Only sees traffic that occurs DURING the capture window — ask the user to reproduce the action (e.g. click the button again) while this runs, or call it right before the action if you expect one.",
  parameters: z.object({
    windowMs: z
      .number()
      .int()
      .min(MIN_WINDOW_MS)
      .max(MAX_WINDOW_MS)
      .default(DEFAULT_WINDOW_MS)
      .describe(
        `Capture window in milliseconds (${MIN_WINDOW_MS}-${MAX_WINDOW_MS}, default ${DEFAULT_WINDOW_MS})`,
      ),
    onlyErrors: z
      .boolean()
      .default(false)
      .describe(
        "If true, only return failed requests or responses with status >= 400",
      ),
  }),
  execute: async ({ windowMs, onlyErrors }, context) => {
    const tab = await resolveDiagnosticTab(context as ToolRunContext);
    if (!tab.id) {
      return { available: false, requests: [] };
    }
    const tabId = tab.id;

    try {
      const requests = await withDebuggerEventCapture<
        Map<string, CapturedRequest>
      >(tabId, async (cdp, onEvent) => {
        const byId = new Map<string, CapturedRequest>();

        onEvent((method, params) => {
          const p = params as Record<string, any>;
          if (method === "Network.requestWillBeSent") {
            byId.set(p.requestId, {
              requestId: p.requestId,
              url: p.request?.url,
              method: p.request?.method,
              requestHeaders: redactHeaders(p.request?.headers),
              timestamp: Date.now(),
            });
          } else if (method === "Network.responseReceived") {
            const existing = byId.get(p.requestId);
            if (existing) {
              existing.status = p.response?.status;
              existing.statusText = p.response?.statusText;
              existing.responseHeaders = redactHeaders(p.response?.headers);
              existing.mimeType = p.response?.mimeType;
            }
          } else if (method === "Network.loadingFailed") {
            const existing = byId.get(p.requestId);
            if (existing) {
              existing.failed = true;
              existing.errorText = p.errorText;
            }
          }
        });

        await cdp.sendCommand("Network.enable", {});
        await new Promise((resolve) =>
          setTimeout(resolve, clampWindow(windowMs)),
        );
        await cdp.sendCommand("Network.disable", {});

        return byId;
      });

      let list = Array.from(requests.values());
      if (onlyErrors) {
        list = list.filter(
          (r) => r.failed || (r.status !== undefined && r.status >= 400),
        );
      }

      // Record only failures as evidence — successful requests don't add
      // diagnostic signal and would flood the bounded evidence store.
      const conversationId = (context as ToolRunContext)?.context
        ?.conversationId;
      for (const request of requests.values()) {
        const isFailure =
          request.failed ||
          (request.status !== undefined && request.status >= 400);
        if (!isFailure) continue;
        recordEvidence({
          conversationId,
          source: "network",
          type: request.failed ? "network-failed" : "network-http-error",
          timestamp: request.timestamp,
          tabId,
          url: request.url,
          requestId: request.requestId,
          data: request,
        });
      }

      return {
        available: true,
        url: tab.url,
        windowMs: clampWindow(windowMs),
        count: list.length,
        requests: list,
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

interface CapturedRuntimeEvent {
  type: "log" | "exception" | "cdp-error";
  level?: string;
  text: string;
  timestamp: number;
  stackTrace?: string;
}

export const getRuntimeDiagnosticsTool = tool({
  name: "get_runtime_diagnostics",
  description:
    "Watch for browser-level runtime events on the current tab for a short window — uncaught exceptions with stack traces, CSP violations, and other browser-generated log entries that don't go through console.* (so get_apty_page_logs won't see them). " +
    "Only sees events that occur DURING the capture window.",
  parameters: z.object({
    windowMs: z
      .number()
      .int()
      .min(MIN_WINDOW_MS)
      .max(MAX_WINDOW_MS)
      .default(DEFAULT_WINDOW_MS)
      .describe(
        `Capture window in milliseconds (${MIN_WINDOW_MS}-${MAX_WINDOW_MS}, default ${DEFAULT_WINDOW_MS})`,
      ),
  }),
  execute: async ({ windowMs }, context) => {
    const tab = await resolveDiagnosticTab(context as ToolRunContext);
    if (!tab.id) {
      return { available: false, events: [] };
    }
    const tabId = tab.id;

    try {
      const events = await withDebuggerEventCapture<CapturedRuntimeEvent[]>(
        tabId,
        async (cdp, onEvent) => {
          const collected: CapturedRuntimeEvent[] = [];

          onEvent((method, params) => {
            const p = params as Record<string, any>;
            if (method === "Log.entryAdded") {
              collected.push({
                type: "log",
                level: p.entry?.level,
                text: redactSensitiveText(String(p.entry?.text ?? "")),
                timestamp: Date.now(),
              });
            } else if (method === "Runtime.exceptionThrown") {
              const details = p.exceptionDetails;
              collected.push({
                type: "exception",
                text: redactSensitiveText(
                  String(
                    details?.exception?.description ?? details?.text ?? "",
                  ),
                ),
                stackTrace: details?.stackTrace
                  ? JSON.stringify(details.stackTrace)
                  : undefined,
                timestamp: Date.now(),
              });
            }
          });

          await cdp.sendCommand("Log.enable", {});
          await cdp.sendCommand("Runtime.enable", {});
          await new Promise((resolve) =>
            setTimeout(resolve, clampWindow(windowMs)),
          );
          await cdp.sendCommand("Runtime.disable", {});
          await cdp.sendCommand("Log.disable", {});

          return collected;
        },
      );

      // Record exceptions (always significant) and warning/error-level log
      // entries as evidence; routine verbose/info log entries are skipped
      // to avoid flooding the bounded per-conversation evidence store.
      const conversationId = (context as ToolRunContext)?.context
        ?.conversationId;
      for (const event of events) {
        const isSignificant =
          event.type === "exception" ||
          event.level === "warning" ||
          event.level === "error";
        if (!isSignificant) continue;
        recordEvidence({
          conversationId,
          source: "runtime",
          type:
            event.type === "exception" ? "runtime-exception" : "runtime-log",
          timestamp: event.timestamp,
          tabId,
          url: tab.url,
          data: event,
        });
      }

      return {
        available: true,
        url: tab.url,
        windowMs: clampWindow(windowMs),
        count: events.length,
        events,
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

export const devToolsTools = [
  getNetworkDiagnosticsTool,
  getRuntimeDiagnosticsTool,
];
