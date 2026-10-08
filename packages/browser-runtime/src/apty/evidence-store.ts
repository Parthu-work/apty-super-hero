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
 * `apps/browser-extension/src/lib/conversation-tab-binding.ts`'s
 * `Map<sessionId, tabId>`. Evidence collected for one conversation must
 * never appear when a different conversation asks for its timeline.
 */
import { generateId } from "@apty/agent-core";
import type {
  DiagnosticEvidence,
  EvidenceSource,
  NewDiagnosticEvidence,
} from "./types.js";

/** Evidence collected outside any bound conversation (e.g. via the MCP bridge) is kept here — still bounded, but not attributable to a specific chat. */
const UNSCOPED_KEY = "__unscoped__";

/** Max evidence records kept per conversation before the oldest are dropped. */
const MAX_EVIDENCE_PER_CONVERSATION = 500;

/**
 * Max evidence records kept per (conversation, source) before that
 * source's own oldest entries are dropped — strictly less than the
 * overall cap above, so a single noisy source (e.g. hundreds of network
 * failures during one capture) can only evict its OWN old entries, never
 * a different, rarer source's evidence (e.g. a single widget-status
 * record).
 */
const MAX_EVIDENCE_PER_SOURCE = 150;

interface ConversationEvidence {
  list: DiagnosticEvidence[];
  /** `dedupeKeys[i]` is the key that produced `list[i]` — kept in lockstep so an evicted entry's key can be forgotten too (see `enforceQuotas`), not just the entry itself. */
  dedupeKeys: string[];
  /** The set of keys currently present in `list`/`dedupeKeys`, for O(1) "have we already recorded this" lookups. */
  seenKeys: Set<string>;
}

const evidenceByConversation = new Map<string, ConversationEvidence>();

function keyFor(conversationId: string | undefined): string {
  return conversationId && conversationId !== "pending"
    ? conversationId
    : UNSCOPED_KEY;
}

/**
 * De-duplication key for one piece of evidence: `(source, type, tabId,
 * frameId, requestId ?? serialized data)`. `requestId` is preferred over
 * content when present (network evidence) since it uniquely identifies
 * one request/response pair even if two capture windows happen to
 * overlap and both observe it.
 *
 * Non-network evidence falls back to a content hash (`JSON.stringify
 * (data)`), not `timestamp` — two independent tool calls that both
 * observe the *same real-world event* (e.g. a CDP log line captured by
 * two overlapping runtime-diagnostics windows) each stamp it with their
 * own `Date.now()` at observation time, so timestamps can differ even
 * for a genuine duplicate. Content is what actually distinguishes "the
 * same log line recorded twice" from "two different log lines that
 * happen to land in the same millisecond" — the latter is a real,
 * observed failure mode of a timestamp-only key (two distinct captured
 * log entries synchronously fired in the same test/turn collided and one
 * was incorrectly dropped).
 */
function dedupeKey(evidence: NewDiagnosticEvidence): string {
  let contentKey: unknown;
  if (evidence.requestId !== undefined) {
    contentKey = evidence.requestId;
  } else {
    try {
      contentKey = JSON.stringify(evidence.data);
    } catch {
      // Non-serializable payload (shouldn't happen — evidence must already
      // be JSON-safe to eventually reach an LLM — but never let a
      // stringify failure crash evidence recording); fall back to
      // timestamp so this record simply isn't de-duplicated.
      contentKey = evidence.timestamp;
    }
  }
  return JSON.stringify([
    evidence.source,
    evidence.type,
    evidence.tabId ?? null,
    evidence.frameId ?? null,
    contentKey,
  ]);
}

/**
 * Enforce `MAX_EVIDENCE_PER_SOURCE` by dropping this source's own oldest
 * entries (never another source's) until it fits, then enforce the
 * overall `MAX_EVIDENCE_PER_CONVERSATION` cap the same way, oldest-first
 * across all sources.
 */
function evictAt(entry: ConversationEvidence, index: number): void {
  entry.list.splice(index, 1);
  const [droppedKey] = entry.dedupeKeys.splice(index, 1);
  if (droppedKey !== undefined) {
    entry.seenKeys.delete(droppedKey);
  }
}

function enforceQuotas(entry: ConversationEvidence, source: EvidenceSource) {
  const sourceCount = entry.list.reduce(
    (count, e) => count + (e.source === source ? 1 : 0),
    0,
  );
  let excess = sourceCount - MAX_EVIDENCE_PER_SOURCE;
  if (excess > 0) {
    for (let i = 0; i < entry.list.length && excess > 0; ) {
      if (entry.list[i]?.source === source) {
        evictAt(entry, i);
        excess--;
      } else {
        i++;
      }
    }
  }

  while (entry.list.length > MAX_EVIDENCE_PER_CONVERSATION) {
    evictAt(entry, 0);
  }
}

/**
 * Record a new piece of evidence. Returns the fully-constructed record
 * (with a generated `evidenceId`) so a caller can reference it further
 * (e.g. include the id in a tool's own return value) — including when an
 * identical record already existed (de-duplication only affects what is
 * stored, never what is returned to the caller that just recorded it).
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
  const entry = evidenceByConversation.get(key) ?? {
    list: [],
    dedupeKeys: [],
    seenKeys: new Set<string>(),
  };

  const dedupe = dedupeKey(evidence);
  if (!entry.seenKeys.has(dedupe)) {
    entry.seenKeys.add(dedupe);
    entry.list.push(full);
    entry.dedupeKeys.push(dedupe);
    enforceQuotas(entry, evidence.source);
  }

  evidenceByConversation.set(key, entry);

  return full;
}

/** All evidence recorded for one conversation, oldest first. Empty array if none. */
export function getEvidence(
  conversationId: string | undefined,
): DiagnosticEvidence[] {
  return [...(evidenceByConversation.get(keyFor(conversationId))?.list ?? [])];
}

/** One evidence record by id, scoped to a conversation — `undefined` if not found (never fabricated). */
export function getEvidenceById(
  conversationId: string | undefined,
  evidenceId: string,
): DiagnosticEvidence | undefined {
  return evidenceByConversation
    .get(keyFor(conversationId))
    ?.list.find((e) => e.evidenceId === evidenceId);
}

/** One evidence record by its (random, unguessable) id in any conversation of this context — used by the UI, which shows the user their own data. */
export function findEvidenceById(
  evidenceId: string,
): DiagnosticEvidence | undefined {
  for (const entry of evidenceByConversation.values()) {
    const found = entry.list.find((e) => e.evidenceId === evidenceId);
    if (found) return found;
  }
  return undefined;
}

/** Drop all evidence for one conversation — call when a conversation/session ends. */
export function clearEvidence(conversationId: string | undefined): void {
  evidenceByConversation.delete(keyFor(conversationId));
}

/** Test/debug helper: how many conversations currently have stored evidence. */
export function getTrackedConversationCount(): number {
  return evidenceByConversation.size;
}
