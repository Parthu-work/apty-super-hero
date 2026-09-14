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
 * `@openai/agents-extensions`' aisdk() adapter tags every reasoning item it
 * creates with `providerData.model = "<provider>:<modelId>"`
 * (see its `buildBaseProviderData()`). This module uses that tag to decide
 * whether a reasoning item is safe to replay to the model about to be
 * called — never by branching on a provider name, only by comparing model
 * identifiers. Tool-call/message providerData is already scoped correctly
 * by the vendor library itself; only the reasoning item type bypasses that
 * scoping, which is the gap this closes.
 */

import type { AgentInputItem } from "@openai/agents";

/**
 * Remove "reasoning" items that were not produced by `currentModelId`.
 *
 * Applied via `callModelInputFilter` immediately before every model call, so
 * it never mutates persisted session state — only what is sent as this
 * turn's model input. Reasoning items produced earlier in the *same*
 * execution (same model, e.g. think -> tool call -> think -> answer) always
 * match and pass through untouched.
 *
 * When `currentModelId` is unknown, or a reasoning item carries no model
 * tag (legacy/foreign data), the item is dropped rather than risk
 * forwarding metadata to an incompatible provider.
 */
export function sanitizeReasoningItemsForModel(
  items: AgentInputItem[],
  currentModelId: string | undefined,
): AgentInputItem[] {
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
