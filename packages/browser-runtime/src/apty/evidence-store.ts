/**
 * Per-conversation diagnostic evidence store.
 *
 * Every diagnostic tool (`apty.ts`, `devtools.ts`) records what it found
 * here, keyed by conversation id, so a later tool call in the same
 * conversation can ask for a deterministically correlated view (see
 * `evidence-correlation.ts`) instead of the model having to reconstruct
 * relationships across scattered raw tool outputs on its own.
 *
 * Deliberately `Map<conversationId, DiagnosticEvidence[]>`, not a single
 * global array — the same isolation principle as
 * `packages/browser-ext/src/lib/conversation-tab-binding.ts`'s
 * `Map<sessionId, tabId>`. Evidence collected for one conversation must
 * never appear when a different conversation asks for its timeline.
 */
import { generateId } from "@aipexstudio/aipex-core";
import type { DiagnosticEvidence, NewDiagnosticEvidence } from "./types.js";

/** Evidence collected outside any bound conversation (e.g. via the MCP bridge) is kept here — still bounded, but not attributable to a specific chat. */
const UNSCOPED_KEY = "__unscoped__";

/** Max evidence records kept per conversation before the oldest are dropped. */
const MAX_EVIDENCE_PER_CONVERSATION = 500;

const evidenceByConversation = new Map<string, DiagnosticEvidence[]>();

function keyFor(conversationId: string | undefined): string {
  return conversationId && conversationId !== "pending"
    ? conversationId
    : UNSCOPED_KEY;
}

/**
 * Record a new piece of evidence. Returns the fully-constructed record
 * (with a generated `evidenceId`) so a caller can reference it further
 * (e.g. include the id in a tool's own return value).
 */
export function recordEvidence(
  evidence: NewDiagnosticEvidence,
): DiagnosticEvidence {
  const full: DiagnosticEvidence = {
    ...evidence,
    evidenceId: generateId(),
    scope: evidence.scope ?? (evidence.tabId != null ? "tab" : "unknown"),
  };

  const key = keyFor(evidence.conversationId);
  const list = evidenceByConversation.get(key) ?? [];
  list.push(full);
  if (list.length > MAX_EVIDENCE_PER_CONVERSATION) {
    list.splice(0, list.length - MAX_EVIDENCE_PER_CONVERSATION);
  }
  evidenceByConversation.set(key, list);

  return full;
}

/** All evidence recorded for one conversation, oldest first. Empty array if none. */
export function getEvidence(
  conversationId: string | undefined,
): DiagnosticEvidence[] {
  return [...(evidenceByConversation.get(keyFor(conversationId)) ?? [])];
}

/** Drop all evidence for one conversation — call when a conversation/session ends. */
export function clearEvidence(conversationId: string | undefined): void {
  evidenceByConversation.delete(keyFor(conversationId));
}

/** Test/debug helper: how many conversations currently have stored evidence. */
export function getTrackedConversationCount(): number {
  return evidenceByConversation.size;
}
