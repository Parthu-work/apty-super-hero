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

/**
 * Resolve which tab a diagnostic tool call should target.
 *
 * Prefers the tab bound to the calling conversation (`context.context.tabId`)
 * so evidence collection stays scoped to the conversation that asked for
 * it. Falls back to `getActiveTab()` — same as before this existed — when
 * no context was threaded through (e.g. tools invoked outside the chat
 * agent loop, such as via the MCP bridge) or when the bound tab has since
 * been closed.
 */
export async function resolveDiagnosticTab(
  runContext?: ToolRunContext,
): Promise<chrome.tabs.Tab> {
  const boundTabId = runContext?.context?.tabId;
  if (typeof boundTabId === "number") {
    try {
      const tab = await chrome.tabs.get(boundTabId);
      if (tab?.id) {
        return tab;
      }
    } catch {
      // Bound tab no longer exists (closed) — fall back to the active tab
      // below rather than failing the tool call outright.
    }
  }

  return getActiveTab();
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
