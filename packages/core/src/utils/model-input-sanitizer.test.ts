import type { AgentInputItem } from "@openai/agents";
import { describe, expect, it } from "vitest";
import { sanitizeReasoningItemsForModel } from "./model-input-sanitizer.js";

function reasoningItem(providerModel?: string): AgentInputItem {
  return {
    type: "reasoning",
    content: [{ type: "input_text", text: "thinking..." }],
    ...(providerModel !== undefined
      ? { providerData: { model: providerModel } }
      : {}),
  } as unknown as AgentInputItem;
}

function userMessage(text: string): AgentInputItem {
  return { type: "message", role: "user", content: text } as AgentInputItem;
}

describe("sanitizeReasoningItemsForModel", () => {
  it("keeps a reasoning item produced by the exact current model", () => {
    const items = [reasoningItem("groq.chat:llama-3.3-70b-versatile")];
    const result = sanitizeReasoningItemsForModel(
      items,
      "llama-3.3-70b-versatile",
    );
    expect(result).toEqual(items);
  });

  it("matches case-insensitively", () => {
    const items = [reasoningItem("Groq.Chat:Llama-3.3-70B-Versatile")];
    const result = sanitizeReasoningItemsForModel(
      items,
      "LLAMA-3.3-70B-VERSATILE",
    );
    expect(result).toHaveLength(1);
  });

  it("drops a reasoning item produced by a different model (provider switch)", () => {
    const items = [
      reasoningItem("anthropic.messages:claude-sonnet-4-20250514"),
    ];
    const result = sanitizeReasoningItemsForModel(
      items,
      "llama-3.3-70b-versatile",
    );
    expect(result).toHaveLength(0);
  });

  it("drops a reasoning item with no provider/model tag (legacy or foreign data)", () => {
    const items = [reasoningItem(undefined)];
    const result = sanitizeReasoningItemsForModel(items, "gpt-4o");
    expect(result).toHaveLength(0);
  });

  it("drops all reasoning items when the current model is unknown", () => {
    const items = [reasoningItem("openai.chat:gpt-4o")];
    const result = sanitizeReasoningItemsForModel(items, undefined);
    expect(result).toHaveLength(0);
  });

  it("never touches non-reasoning items", () => {
    const items = [
      userMessage("hi"),
      reasoningItem("openai.chat:gpt-4o"),
      userMessage("get flow.json"),
    ];
    const result = sanitizeReasoningItemsForModel(
      items,
      "claude-sonnet-4-20250514",
    );
    expect(result).toEqual([items[0], items[2]]);
  });

  it("preserves ordering of surviving items", () => {
    const items = [
      userMessage("first"),
      reasoningItem("openai.chat:gpt-4o"),
      userMessage("second"),
      reasoningItem("openai.chat:gpt-4o"),
      userMessage("third"),
    ];
    const result = sanitizeReasoningItemsForModel(items, "gpt-4o");
    expect(result).toEqual(items);
  });

  it("returns an empty array unchanged", () => {
    expect(sanitizeReasoningItemsForModel([], "gpt-4o")).toEqual([]);
  });
});
