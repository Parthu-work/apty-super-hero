/**
 * Whether a conversation already holds what a model turn should explain
 * (KB-RAG K27, E6): a turn the runtime answered itself (a check, a KB
 * answer, a file lookup) or a KB result that named cards.
 */
import type { AgentInputItem } from "@openai/agents";
import { LOCAL_ANSWER_CALL_PREFIX } from "../conversation/compressor.js";
import { kbCardsIn } from "../kb/egress.js";

function isLocalAnswerResult(item: AgentInputItem): boolean {
  if (item.type !== "function_call_result") return false;
  const callId = (item as { callId?: unknown }).callId;
  return (
    typeof callId === "string" && callId.startsWith(LOCAL_ANSWER_CALL_PREFIX)
  );
}

export function holdsGroundedEvidence(
  items: readonly AgentInputItem[],
): boolean {
  return items.some(isLocalAnswerResult) || kbCardsIn(items).length > 0;
}
