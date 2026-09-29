/**
 * Apty integration tools
 *
 * The bridge between the AI agent and Apty-specific runtime state:
 * - `get_apty_page_logs`: generic console/error capture (works on any page,
 *   via the MAIN-world content script in
 *   apps/browser-extension/src/entrypoints/content/console-bridge.ts).
 * - `get_apty_widget_diagnostics` / `get_apty_client_diagnostics`: probe a
 *   documented `window.__APTY_WIDGET__` / `window.__APTY_CLIENT__` contract
 *   that the Widget/Client do not yet implement — see
 *   packages/browser-runtime/src/apty/widget-diagnostics.ts and
 *   client-diagnostics.ts for the exact contract and current status.
 * - `get_apty_studio_diagnostics` / `get_apty_service_worker_diagnostics`:
 *   require a configured extension ID or diagnostic endpoint (see
 *   apps/browser-extension/.env.example) and Apty-side messaging support that
 *   does not exist yet — these report `status: "not_configured"` until
 *   that's wired up on both sides.
 *
 * All log output is redacted (see @apty/debug-contract/src/redact.ts) before being returned to
 * the model — the page is untrusted and may contain secrets in console
 * output or Apty's own log messages.
 */

import { tool } from "@apty/agent-core";
import { z } from "zod";
import {
  ConfiguredServiceWorkerDiagnosticsProvider,
  classifyLogEntry,
  type EvidenceSource,
  ExternalMessageStudioDiagnosticsProvider,
  getAptyIntegrationConfig,
  NotConfiguredServiceWorkerDiagnosticsProvider,
  NotConfiguredStudioDiagnosticsProvider,
  recordEvidence,
  recordToolCall,
  redactLogs,
  ScriptingClientDiagnosticsProvider,
  ScriptingWidgetDiagnosticsProvider,
  summarizeLogCategories,
} from "../apty/index.js";
import {
  getActiveTab,
  resolveDiagnosticTab,
  type ToolRunContext,
} from "./tab-utils";

type AptyConsoleLevel =
  | "log"
  | "info"
  | "warn"
  | "error"
  | "debug"
  | "trace"
  | "dir"
  | "table"
  | "assert";

type AptyConsoleSource =
  | "console"
  | "window-error"
  | "resource-error"
  | "unhandled-rejection"
  | "csp-violation";

interface AptyConsoleEntry {
  seq: number;
  level: AptyConsoleLevel;
  message: string;
  timestamp: number;
  source: AptyConsoleSource;
  repeat?: number;
}

interface MergedAptyConsoleEntry extends AptyConsoleEntry {
  frameId: number;
  frameUrl?: string;
  coverage: "installed" | "from-injection";
}

/** A frame's console-log read result, or the reason it couldn't be read. */
interface FrameReadResult {
  frameId: number;
  entries: AptyConsoleEntry[];
  url?: string;
  coverage: "installed" | "from-injection" | "unavailable";
}

type PageLogsErrorCode = "restricted_page" | "no_permission" | "tab_closed";

interface PageLogsFailure {
  code: PageLogsErrorCode | "bound_tab_closed";
  message: string;
  nextSteps: string[];
}

// Pages Chrome never allows script injection into — reported as an honest
// `restricted_page` failure rather than a silently empty result.
const RESTRICTED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "chrome-untrusted://",
  "edge://",
  "about:",
  "devtools://",
  "view-source:",
];

function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  if (RESTRICTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix)))
    return true;
  if (url.startsWith("https://chrome.google.com/webstore")) return true;
  if (url.startsWith("https://chromewebstore.google.com")) return true;
  return false;
}

/** The `content_scripts` entry (from the *resolved* runtime manifest, so it works whatever the build renamed the file to) that installs the console bridge in the page's MAIN world. */
function findConsoleBridgeFiles(): string[] | undefined {
  try {
    const manifest = chrome.runtime.getManifest() as unknown as {
      content_scripts?: Array<{
        js?: string[];
        world?: string;
      }>;
    };
    const entry = manifest.content_scripts?.find(
      (cs) => cs.world === "MAIN" && (cs.js?.length ?? 0) > 0,
    );
    return entry?.js;
  } catch {
    return undefined;
  }
}

/** Reads `window.__aptyReadConsoleBuffer()` in every frame of a tab, in the page's MAIN world. Never throws — a failure to inject at all is reported via the returned `errorCode`. */
async function readFrameConsoleLogs(tabId: number): Promise<{
  frames: FrameReadResult[];
  errorCode?: PageLogsErrorCode;
  errorMessage?: string;
}> {
  let initialResults: chrome.scripting.InjectionResult<
    { entries: AptyConsoleEntry[]; url: string } | undefined
  >[];
  try {
    initialResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: () => {
        const read = (
          window as unknown as {
            __aptyReadConsoleBuffer?: () => unknown[];
          }
        ).__aptyReadConsoleBuffer;
        if (typeof read !== "function") return undefined;
        return { entries: read() as AptyConsoleEntry[], url: location.href };
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code: PageLogsErrorCode =
      /cannot access|extensions gallery|chrome:\/\/|cannot be scripted|no tab with id/i.test(
        message,
      )
        ? "restricted_page"
        : "no_permission";
    return { frames: [], errorCode: code, errorMessage: message };
  }

  const frames: FrameReadResult[] = [];
  const missingFrameIds: number[] = [];
  for (const result of initialResults) {
    if (result.result) {
      frames.push({
        frameId: result.frameId,
        entries: result.result.entries,
        url: result.result.url,
        coverage: "installed",
      });
    } else {
      missingFrameIds.push(result.frameId);
    }
  }

  // Frames with no bridge installed — typically a tab that was already open
  // before the extension was installed/updated. Inject the bridge's actual
  // content-script files on demand rather than guessing at a duplicate
  // implementation, then re-read.
  if (missingFrameIds.length > 0) {
    frames.push(...(await injectBridgeIntoFrames(tabId, missingFrameIds)));
  }

  return { frames };
}

async function injectBridgeIntoFrames(
  tabId: number,
  frameIds: number[],
): Promise<FrameReadResult[]> {
  const files = findConsoleBridgeFiles();
  if (!files || files.length === 0) {
    return frameIds.map((frameId) => ({
      frameId,
      entries: [],
      coverage: "unavailable" as const,
    }));
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds },
      world: "MAIN",
      files,
    });
  } catch {
    return frameIds.map((frameId) => ({
      frameId,
      entries: [],
      coverage: "unavailable" as const,
    }));
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds },
      world: "MAIN",
      func: () => {
        const read = (
          window as unknown as {
            __aptyReadConsoleBuffer?: () => unknown[];
          }
        ).__aptyReadConsoleBuffer;
        if (typeof read !== "function") return undefined;
        return { entries: read() as AptyConsoleEntry[], url: location.href };
      },
    });
    return results.map((result) => ({
      frameId: result.frameId,
      entries: result.result?.entries ?? [],
      url: result.result?.url,
      coverage: result.result
        ? ("from-injection" as const)
        : ("unavailable" as const),
    }));
  } catch {
    return frameIds.map((frameId) => ({
      frameId,
      entries: [],
      coverage: "unavailable" as const,
    }));
  }
}

// Console-bridge entries don't map onto the plain 5-level console severity
// the tool's `minLevel` filter was written against (trace/dir/table/assert
// didn't exist yet) — treat the non-standard ones as "informational" for
// filtering purposes so `minLevel: "log"` (the default) still includes them.
const LEVEL_SEVERITY: Record<AptyConsoleLevel, number> = {
  debug: 0,
  trace: 1,
  dir: 1,
  table: 1,
  log: 1,
  info: 1,
  assert: 2,
  warn: 3,
  error: 4,
};

/**
 * Record warn/error-level logs as diagnostic evidence for this
 * conversation's correlated timeline (`get_investigation_timeline`).
 * Routine log/info/debug entries are deliberately not recorded — they'd
 * flood the bounded per-conversation evidence store without adding
 * diagnostic signal.
 */
function recordAptyLogsAsEvidence<
  T extends { level: string; message: string; timestamp: number },
>(
  logs: T[],
  source: EvidenceSource,
  runContext: ToolRunContext | undefined,
  tabId: number | null,
): void {
  const conversationId = runContext?.context?.conversationId;
  for (const log of logs) {
    if (log.level !== "warn" && log.level !== "error") continue;
    recordEvidence({
      conversationId,
      source,
      type: `${source}-${log.level}`,
      timestamp: log.timestamp,
      tabId,
      data: log,
    });
  }
}

/**
 * Build a `getActiveTabId` callback bound to this tool call's conversation
 * context, so widget/client diagnostics providers target the tab the
 * calling conversation is actually about instead of whatever tab is
 * currently focused.
 */
function makeGetTabId(runContext?: ToolRunContext): () => Promise<number> {
  return async () => {
    const tab = await resolveDiagnosticTab(runContext);
    if (!tab.id) {
      throw new Error("No active tab found");
    }
    return tab.id;
  };
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
    frames: z
      .enum(["all", "top"])
      .default("all")
      .describe(
        "Include console output from every iframe on the page ('all'), or only the top-level frame ('top')",
      ),
  }),
  execute: async ({ limit, minLevel, frames }, context) => {
    recordToolCall(
      (context as ToolRunContext)?.context?.conversationId,
      "get_apty_page_logs",
      { limit, minLevel, frames },
    );
    const runContext = context as ToolRunContext;
    const boundTabId = runContext?.context?.tabId;

    let tab: chrome.tabs.Tab;
    if (typeof boundTabId === "number") {
      try {
        tab = await chrome.tabs.get(boundTabId);
      } catch {
        return pageLogsFailure({
          code: "bound_tab_closed",
          message:
            "The tab this conversation was bound to has been closed, so its console logs are no longer available.",
          nextSteps: [
            "Ask the user to reopen the app, then retry (this will bind to whichever tab you're actively investigating next).",
          ],
        });
      }
    } else {
      tab = await getActiveTab();
    }

    if (!tab.id) {
      return pageLogsFailure({
        code: "tab_closed",
        message: "No open tab is available to read console logs from.",
        nextSteps: ["Open a tab on the app being debugged and retry."],
      });
    }

    if (isRestrictedUrl(tab.url)) {
      return pageLogsFailure({
        code: "restricted_page",
        message: `Cannot read console logs on this page (${tab.url ?? "unknown URL"}) — Chrome does not allow script injection into internal pages, the Chrome Web Store, or PDF viewer tabs.`,
        nextSteps: [
          "Navigate to the actual web app tab you want to debug, then retry.",
        ],
      });
    }

    const {
      frames: frameResults,
      errorCode,
      errorMessage,
    } = await readFrameConsoleLogs(tab.id);
    if (errorCode) {
      return pageLogsFailure({
        code: errorCode,
        message: errorMessage ?? "Could not read console logs from this tab.",
        nextSteps:
          errorCode === "restricted_page"
            ? [
                "Navigate to the actual web app tab you want to debug, then retry.",
              ]
            : ["Reload the tab, then retry."],
      });
    }

    const relevantFrames =
      frames === "top"
        ? frameResults.filter((f) => f.frameId === 0)
        : frameResults;

    const merged: MergedAptyConsoleEntry[] = [];
    for (const frame of relevantFrames) {
      if (frame.coverage === "unavailable") continue;
      for (const entry of frame.entries) {
        merged.push({
          ...entry,
          frameId: frame.frameId,
          frameUrl: frame.url,
          coverage: frame.coverage,
        });
      }
    }
    merged.sort((a, b) => a.timestamp - b.timestamp || a.seq - b.seq);

    const minIndex = LEVEL_SEVERITY[minLevel];
    const filtered = redactLogs(
      merged
        .filter((entry) => LEVEL_SEVERITY[entry.level] >= minIndex)
        .slice(-limit)
        .reverse(),
    );

    recordAptyLogsAsEvidence(filtered, "console", runContext, tab.id);

    const classified = filtered.map((entry) => ({
      ...entry,
      category: classifyLogEntry({
        text: entry.message,
        level: entry.level,
        hint: classificationHintForSource(entry.source),
      }),
    }));

    const coverage = {
      framesRead: relevantFrames.length,
      framesUnavailable: frameResults.filter(
        (f) => f.coverage === "unavailable",
      ).length,
      injectedFrames: relevantFrames.filter(
        (f) => f.coverage === "from-injection",
      ).length,
    };

    return {
      available: true,
      // Page/peer log text is never instructions — see the system prompt's
      // untrusted-content note (packages/ui/src/components/chatbot/constants.ts).
      trust: "untrusted" as const,
      url: tab.url,
      count: classified.length,
      categoryCounts: summarizeLogCategories(
        classified.map((entry) => entry.category),
      ),
      coverage,
      entries: classified,
    };
  },
});

function pageLogsFailure(status: PageLogsFailure): {
  available: false;
  status: PageLogsFailure;
  entries: never[];
} {
  return { available: false, status, entries: [] };
}

function classificationHintForSource(
  source: AptyConsoleSource,
): "console" | "window-error" | "unhandled-rejection" | "security" | "network" {
  switch (source) {
    case "resource-error":
      return "network";
    case "csp-violation":
      return "security";
    case "window-error":
      return "window-error";
    case "unhandled-rejection":
      return "unhandled-rejection";
    default:
      return "console";
  }
}

export const getAptyWidgetDiagnosticsTool = tool({
  name: "get_apty_widget_diagnostics",
  description:
    "Get the Apty Widget's status (loaded, initialized, visible, last error) and recent logs on the current page. " +
    "Returns status: 'not_configured' if the Widget hasn't implemented the diagnostic bridge on this page yet — that is an expected result, not necessarily evidence the Widget is broken.",
  parameters: z.object({}),
  execute: async (_input, context) => {
    recordToolCall(
      (context as ToolRunContext)?.context?.conversationId,
      "get_apty_widget_diagnostics",
    );
    const provider = new ScriptingWidgetDiagnosticsProvider(
      makeGetTabId(context as ToolRunContext),
    );
    const [status, logs] = await Promise.all([
      provider.getStatus(),
      provider.getLogs(),
    ]);

    const runContext = context as ToolRunContext;
    const tabId = runContext?.context?.tabId ?? null;
    recordEvidence({
      conversationId: runContext?.context?.conversationId,
      source: "apty-widget",
      type: "widget-status",
      timestamp: Date.now(),
      tabId,
      data: status,
    });
    recordAptyLogsAsEvidence(logs, "apty-widget", runContext, tabId);

    return { status, logs };
  },
});

export const getAptyClientDiagnosticsTool = tool({
  name: "get_apty_client_diagnostics",
  description:
    "Get the Apty Client's status (loaded, initialized, version) and recent logs on the current page. " +
    "Returns status: 'not_configured' if the Client hasn't implemented the diagnostic bridge on this page yet.",
  parameters: z.object({}),
  execute: async (_input, context) => {
    recordToolCall(
      (context as ToolRunContext)?.context?.conversationId,
      "get_apty_client_diagnostics",
    );
    const provider = new ScriptingClientDiagnosticsProvider(
      makeGetTabId(context as ToolRunContext),
    );
    const [status, logs] = await Promise.all([
      provider.getStatus(),
      provider.getLogs(),
    ]);

    const runContext = context as ToolRunContext;
    const tabId = runContext?.context?.tabId ?? null;
    recordEvidence({
      conversationId: runContext?.context?.conversationId,
      source: "apty-client",
      type: "client-status",
      timestamp: Date.now(),
      tabId,
      data: status,
    });
    recordAptyLogsAsEvidence(logs, "apty-client", runContext, tabId);

    return { status, logs };
  },
});

export const getAptyStudioDiagnosticsTool = tool({
  name: "get_apty_studio_diagnostics",
  description:
    "Get Apty Studio's status (active, selection mode, last selected selector) and recent logs, via cross-extension messaging. " +
    "Requires studioExtensionId to be configured (see apps/browser-extension/.env.example) AND Studio to implement the corresponding message handler — until both exist, returns status: 'not_configured' or 'unavailable'.",
  parameters: z.object({}),
  execute: async (_input, context) => {
    recordToolCall(
      (context as ToolRunContext)?.context?.conversationId,
      "get_apty_studio_diagnostics",
    );
    const config = await getAptyIntegrationConfig();
    const provider = config.studioExtensionId
      ? new ExternalMessageStudioDiagnosticsProvider(config.studioExtensionId)
      : new NotConfiguredStudioDiagnosticsProvider();
    const [status, logs] = await Promise.all([
      provider.getStatus(),
      provider.getLogs(),
    ]);

    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    recordEvidence({
      conversationId,
      source: "apty-studio",
      type: "studio-status",
      timestamp: Date.now(),
      tabId: null,
      scope: "shared",
      data: status,
    });
    for (const log of logs) {
      if (log.level !== "warn" && log.level !== "error") continue;
      recordEvidence({
        conversationId,
        source: "apty-studio",
        type: `apty-studio-${log.level}`,
        timestamp: log.timestamp,
        tabId: null,
        scope: "shared",
        data: log,
      });
    }

    return {
      status,
      logs,
      // Studio is reached via cross-extension messaging, not tied to any
      // particular tab — tag which conversation asked for this evidence
      // without claiming a tab/browser-context attribution we can't prove.
      conversationId,
    };
  },
});

export const getAptyServiceWorkerDiagnosticsTool = tool({
  name: "get_apty_service_worker_diagnostics",
  description:
    "Get Apty's service-worker status and recent logs, via a configured extension message channel or diagnostic HTTP endpoint. " +
    "Chrome does not allow one extension to read another's private service-worker memory directly, so this always returns status: 'not_configured' until Apty exposes one of those channels (see apps/browser-extension/.env.example). " +
    "IMPORTANT: the service worker is a single global process shared by every tab, not specific to the current page — do not assume these logs are about the tab you're currently investigating unless a timestamp or message content actually ties them to it.",
  parameters: z.object({}),
  execute: async (_input, context) => {
    recordToolCall(
      (context as ToolRunContext)?.context?.conversationId,
      "get_apty_service_worker_diagnostics",
    );
    const config = await getAptyIntegrationConfig();
    // `serviceWorkerExtensionId` is a distinct, separately-configured field,
    // but the common real-world case is one extension (the Apty Client)
    // whose own service worker is what this tool wants to reach — fall back
    // to the same extension ID the user already configured for Client
    // resource inspection (Options → Apty Client Extension) rather than
    // reporting not_configured just because this specific field was never
    // set through a second, separate UI.
    const serviceWorkerExtensionId =
      config.serviceWorkerExtensionId ?? config.clientExtensionId;
    const provider =
      serviceWorkerExtensionId || config.serviceWorkerDiagnosticEndpoint
        ? new ConfiguredServiceWorkerDiagnosticsProvider({
            extensionId: serviceWorkerExtensionId,
            diagnosticEndpoint: config.serviceWorkerDiagnosticEndpoint,
          })
        : new NotConfiguredServiceWorkerDiagnosticsProvider();
    const [status, logs] = await Promise.all([
      provider.getStatus(),
      provider.getLogs(),
    ]);

    const requestedByConversationId = (context as ToolRunContext)?.context
      ?.conversationId;
    recordEvidence({
      conversationId: requestedByConversationId,
      source: "service-worker",
      type: "service-worker-status",
      timestamp: Date.now(),
      tabId: null,
      scope: "shared",
      data: status,
    });
    for (const log of logs) {
      if (log.level !== "warn" && log.level !== "error") continue;
      recordEvidence({
        conversationId: requestedByConversationId,
        source: "service-worker",
        type: `service-worker-${log.level}`,
        timestamp: log.timestamp,
        tabId: null,
        scope: "shared",
        data: log,
      });
    }

    return {
      status,
      logs,
      scope: "shared-global" as const,
      scopeNote:
        "These logs come from Apty's service worker, which is shared across all tabs and browser windows — they are not specific to the current tab.",
      // Which conversation retrieved this shared/unattributed evidence.
      // Do NOT read this as "these logs are about this conversation's tab"
      // — see scopeNote above.
      requestedByConversationId,
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
