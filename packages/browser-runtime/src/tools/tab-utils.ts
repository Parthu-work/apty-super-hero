/**
 * Get the currently active tab
 * @throws Error if no active tab is found
 */
export async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id) {
    throw new Error("No active tab found");
  }

  return tab;
}

/**
 * Per-conversation execution context passed to `AIPex.chat()` as
 * `ChatOptions.runContext` and forwarded by `@openai/agents` to every tool's
 * `execute(input, context)` as `context.context`.
 *
 * Binds a conversation to the specific browser tab it is debugging, so
 * diagnostic tools can target that tab instead of silently operating on
 * "whichever tab happens to be focused right now" — the mechanism that
 * would otherwise let one conversation's diagnostic evidence leak from (or
 * into) a tab another concurrent conversation is actually about.
 */
export interface ConversationRunContext {
  /** The `core.Session` id (== the conversation this tool call belongs to). */
  conversationId: string;
  /** The tab this conversation is bound to, or `null` if not yet bound. */
  tabId: number | null;
}

/**
 * The shape a tool's `execute(input, context)` second argument actually has:
 * `@openai/agents` wraps whatever was passed to `run({ context })` in a
 * `RunContext`, exposing the original value under `.context`.
 */
export interface ToolRunContext {
  context?: ConversationRunContext;
}

/** Why `resolveDiagnosticTab` could not resolve a tab to target. */
export type DiagnosticTabFailureCode = "no_bound_tab" | "bound_tab_closed";

export type DiagnosticTabResolution =
  | { ok: true; tab: chrome.tabs.Tab }
  | { ok: false; code: DiagnosticTabFailureCode };

/**
 * Resolve which tab a diagnostic tool call should target.
 *
 * Only ever returns the tab bound to the calling conversation
 * (`context.context.tabId`) — it never falls back to "whichever tab
 * happens to be active right now". A tool call made with no bound tab at
 * all (e.g. via the MCP bridge, which does not thread a conversation's
 * `ConversationRunContext` through) or one whose bound tab has since been
 * closed gets an explicit `{ok: false, code: ...}` instead of a plausible-
 * looking but potentially wrong tab — this is exactly the class of bug
 * that once ran a network capture against the side panel's own claude.ai
 * tab instead of the application tab the user was actually looking at.
 *
 * Callers should surface `no_bound_tab`/`bound_tab_closed` as a real
 * failure (see `describeTabResolutionFailure`), not paper over it.
 */
export async function resolveDiagnosticTab(
  runContext?: ToolRunContext,
): Promise<DiagnosticTabResolution> {
  const boundTabId = runContext?.context?.tabId;
  if (typeof boundTabId !== "number") {
    return { ok: false, code: "no_bound_tab" };
  }

  try {
    const tab = await chrome.tabs.get(boundTabId);
    if (tab?.id) {
      return { ok: true, tab };
    }
  } catch {
    // Bound tab no longer exists (closed).
  }

  return { ok: false, code: "bound_tab_closed" };
}

/**
 * Turn a `resolveDiagnosticTab` failure into the `{code, message,
 * nextSteps}` shape every diagnostic tool's failure result should use
 * (see the accuracy contract in the master prompt: "never return `[]`
 * where the truth is failed/unknown").
 */
export function describeTabResolutionFailure(code: DiagnosticTabFailureCode): {
  code: DiagnosticTabFailureCode;
  message: string;
  nextSteps: string[];
} {
  if (code === "no_bound_tab") {
    return {
      code,
      message:
        "This conversation has no bound tab yet, so this tool has no specific tab to target.",
      nextSteps: [
        "Send a message while a tab is open and active so this conversation binds to it, then retry.",
      ],
    };
  }
  return {
    code,
    message:
      "The tab this conversation was bound to has been closed, so this tool has no tab to target.",
    nextSteps: [
      "Open the application tab you want to debug and send another message to re-bind, then retry.",
    ],
  };
}

/** The `tab` field every diagnostic tool's successful result should carry. */
export interface DiagnosticTabMeta {
  id: number;
  origin: string | null;
  title: string | null;
}

export function describeTabForMeta(tab: chrome.tabs.Tab): DiagnosticTabMeta {
  let origin: string | null = null;
  if (tab.url) {
    try {
      origin = new URL(tab.url).origin;
    } catch {
      origin = null;
    }
  }
  return { id: tab.id ?? -1, origin, title: tab.title ?? null };
}

/**
 * Execute a script in a specific tab
 */
export async function executeScriptInTab<T, Args extends any[]>(
  tabId: number,
  func: (...args: Args) => T,
  args: Args,
): Promise<T> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });

  return results[0]?.result as T;
}

/**
 * Execute a script in the active tab
 */
export async function executeScriptInActiveTab<T, Args extends any[]>(
  func: (...args: Args) => T,
  args: Args,
): Promise<T> {
  const tab = await getActiveTab();
  return await executeScriptInTab(tab.id!, func, args);
}
