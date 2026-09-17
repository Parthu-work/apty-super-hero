/**
 * Per-conversation browser-tab binding.
 *
 * Each chat session is bound to the browser tab it is debugging, so
 * diagnostic tool calls (`resolveDiagnosticTab` in
 * `@apty/browser-runtime`) target that specific tab instead of
 * "whichever tab happens to be focused right now" — the mechanism that
 * would otherwise let a conversation's diagnostic evidence silently leak
 * onto (or from) a different tab if the user switches tabs mid-conversation.
 *
 * Deliberately keyed by conversation (core `Session`) id, `Map<sessionId,
 * tabId>`, rather than a single module-level `currentTabId` — so this
 * state cannot be shared between conversations even within one side panel
 * window. Each side panel window already has its own JS realm (and so its
 * own instance of this module), so this map only ever needs to isolate
 * conversations *within* one window, not across windows.
 */
import {
  type ConversationRunContext,
  getActiveTab,
} from "@apty/browser-runtime";

const boundTabs = new Map<string, number>();

/**
 * Resolve the run context to pass as `ChatOptions.runContext` for the next
 * message in this conversation, binding the conversation to its tab the
 * first time a real session id is available.
 *
 * Before a session exists (the very first message of a new conversation),
 * there is no id to key the binding by yet — this resolves against
 * whichever tab is active at send time, same as the pre-existing
 * behavior, and the binding is established as soon as a session id shows
 * up on a later turn.
 */
export async function resolveConversationRunContext(
  sessionId: string | null,
): Promise<ConversationRunContext | undefined> {
  const activeTabId = await safeGetActiveTabId();

  if (!sessionId) {
    return { conversationId: "pending", tabId: activeTabId };
  }

  const bound = boundTabs.get(sessionId);
  if (typeof bound === "number") {
    return { conversationId: sessionId, tabId: bound };
  }

  if (typeof activeTabId === "number") {
    boundTabs.set(sessionId, activeTabId);
  }
  return { conversationId: sessionId, tabId: activeTabId };
}

/**
 * Release a conversation's tab binding. Call when a session is deleted
 * (e.g. "New Chat" resetting the previous session) so this map doesn't
 * grow unbounded across a long-lived side panel session.
 */
export function releaseConversationTabBinding(sessionId: string): void {
  boundTabs.delete(sessionId);
}

/**
 * Read-only peek at a conversation's bound tab, without resolving or
 * mutating anything. For UI display only (e.g. "what tab is this
 * investigation debugging") — diagnostic tools must keep using
 * `resolveConversationRunContext`/`resolveDiagnosticTab`, not this.
 */
export function peekConversationTabBinding(
  sessionId: string | null,
): number | null {
  if (!sessionId) return null;
  return boundTabs.get(sessionId) ?? null;
}

async function safeGetActiveTabId(): Promise<number | null> {
  try {
    const tab = await getActiveTab();
    return tab.id ?? null;
  } catch {
    return null;
  }
}
