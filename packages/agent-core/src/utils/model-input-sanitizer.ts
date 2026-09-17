/**
 * Provider-metadata isolation for the model input boundary.
 *
 * Generic conversation state (`Session`/`EphemeralSession`) persists and
 * replays `AgentInputItem[]` unchanged across turns, including "reasoning"
 * items produced by whichever model answered a previous turn. Some
 * OpenAI-compatible providers reject an incoming assistant message that
 * carries reasoning content it did not itself produce (observed as
 * "property reasoning_content is unsupported" on the *next* turn after a
 * model that streamed back reasoning).
 *
 * IMPORTANT — same-model matching alone is NOT a safe replay signal.
 * Reproduced directly against Groq's `openai/gpt-oss-20b`: the model that
 * *produced* the reasoning still rejects that same reasoning being replayed
 * back to it on the next turn ("property reasoning_content is unsupported").
 * `@openai/agents-extensions`' aisdk() adapter itself only forwards
 * `reasoning_content` for DeepSeek's reasoner models
 * (`shouldIncludeReasoningContent()`, gated on `isDeepSeekModel()`) —
 * every other OpenAI-compatible provider it supports (OpenAI itself, Groq,
 * Together, OpenRouter, Fireworks, ...) either ignores an unrecognized
 * `reasoning_content` field or rejects the request outright. This module
 * mirrors that same policy at our own boundary: `isKnownReasoningReplaySafe`
 * decides whether reasoning replay is even worth considering for the
 * current model/provider at all; only within that safe zone does
 * same-model matching (via `@openai/agents-extensions`' own
 * `providerData.model = "<provider>:<modelId>"` tag, see its
 * `buildBaseProviderData()`) additionally guard against replaying *stale*
 * reasoning from a *different* model/provider after a switch.
 */

import type { AgentInputItem } from "@openai/agents";

/**
 * Whether reasoning replay is known-safe for `modelId`/`provider` at all,
 * regardless of which model produced the reasoning. Deliberately an
 * allowlist, not an inference from the model name: only DeepSeek's reasoner
 * models are documented to require and accept `reasoning_content` being
 * replayed in a request (matching `@openai/agents-extensions`'
 * `shouldIncludeReasoningContent()`). Everything else — OpenAI, Groq,
 * Anthropic, Google, and any other OpenAI-compatible provider — is treated
 * as unsafe until shown otherwise.
 */
function isKnownReasoningReplaySafe(
  modelId: string | undefined,
  provider: string | undefined,
): boolean {
  if (provider?.trim().toLowerCase() === "deepseek") return true;
  return (modelId?.trim().toLowerCase() ?? "").includes("deepseek-reasoner");
}

/**
 * Remove "reasoning" items that are not safe to replay to the model about
 * to be called.
 *
 * Applied via `callModelInputFilter` immediately before every model call, so
 * it never mutates persisted session state — only what is sent as this
 * turn's model input. Reasoning items produced earlier in the *same*
 * execution (e.g. think -> tool call -> think -> answer) are unaffected —
 * they're part of the current run's own output, not replayed session
 * history.
 *
 * Two gates apply, in order:
 * 1. `currentProvider`/`currentModelId` must be a combination known to
 *    support reasoning replay at all (see `isKnownReasoningReplaySafe`) —
 *    if not, every reasoning item is dropped, even ones produced by this
 *    exact model on an earlier turn.
 * 2. Within that safe zone, a reasoning item is kept only if it was
 *    produced by this exact model (via its `providerData.model` tag) —
 *    guarding against replaying stale reasoning from a different
 *    model/provider after a switch. An untagged item (legacy/foreign data)
 *    is dropped rather than risk forwarding metadata to an incompatible
 *    provider.
 */
export function sanitizeReasoningItemsForModel(
  items: AgentInputItem[],
  currentModelId: string | undefined,
  currentProvider?: string,
): AgentInputItem[] {
  if (!isKnownReasoningReplaySafe(currentModelId, currentProvider)) {
    return items.filter((item) => item.type !== "reasoning");
  }

  const target = currentModelId?.trim().toLowerCase();

  return items.filter((item) => {
    if (item.type !== "reasoning") {
      return true;
    }
    if (!target) {
      return false;
    }

    const providerData = (item as { providerData?: Record<string, unknown> })
      .providerData;
    const producedByModel =
      typeof providerData?.model === "string"
        ? providerData.model.toLowerCase()
        : undefined;

    return producedByModel?.endsWith(target);
  });
}
