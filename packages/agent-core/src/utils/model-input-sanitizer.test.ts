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

function assistantMessage(text: string): AgentInputItem {
  return {
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text }],
  } as unknown as AgentInputItem;
}

function toolCall(callId: string): AgentInputItem {
  return {
    type: "function_call",
    callId,
    name: "get_current_tab",
    arguments: "{}",
    status: "completed",
  } as unknown as AgentInputItem;
}

describe("sanitizeReasoningItemsForModel", () => {
  describe("providers/models where reasoning replay is not known-safe (the default — Groq, OpenAI, Anthropic, Google, ...)", () => {
    it("drops reasoning even when produced by the exact same model — Groq gpt-oss regression (reasoning_content is unsupported)", () => {
      // Reproduces the reported bug: Groq's openai/gpt-oss-20b rejects
      // reasoning_content being replayed even for the model that produced
      // it. Same-model matching alone is not a safe replay signal.
      const items = [
        userMessage("hi"),
        reasoningItem("openai.chat:openai/gpt-oss-20b"),
        assistantMessage("Hi! What Apty issue are you seeing?"),
        userMessage("hello"),
      ];
      const result = sanitizeReasoningItemsForModel(
        items,
        "openai/gpt-oss-20b",
        "groq",
      );
      expect(result).toEqual([items[0], items[2], items[3]]);
      expect(result.some((i) => i.type === "reasoning")).toBe(false);
    });

    it("drops reasoning for the same model when no provider is passed at all (conservative default)", () => {
      const items = [reasoningItem("groq.chat:llama-3.3-70b-versatile")];
      const result = sanitizeReasoningItemsForModel(
        items,
        "llama-3.3-70b-versatile",
      );
      expect(result).toHaveLength(0);
    });

    it("drops reasoning for a plain OpenAI model (not a documented reasoning-replay-safe target)", () => {
      const items = [reasoningItem("openai.chat:gpt-4o")];
      const result = sanitizeReasoningItemsForModel(items, "gpt-4o", "openai");
      expect(result).toHaveLength(0);
    });

    it("preserves the final assistant answer when reasoning preceded it", () => {
      const items = [
        reasoningItem("openai.chat:openai/gpt-oss-20b"),
        assistantMessage("Hi! What can I help you debug?"),
      ];
      const result = sanitizeReasoningItemsForModel(
        items,
        "openai/gpt-oss-20b",
        "groq",
      );
      expect(result).toEqual([items[1]]);
    });

    it("preserves a tool call that followed reasoning in the same turn", () => {
      const items = [
        reasoningItem("openai.chat:openai/gpt-oss-20b"),
        toolCall("call_1"),
      ];
      const result = sanitizeReasoningItemsForModel(
        items,
        "openai/gpt-oss-20b",
        "groq",
      );
      expect(result).toEqual([items[1]]);
      expect(result[0]).toMatchObject({
        type: "function_call",
        callId: "call_1",
      });
    });

    it("drops a reasoning item with no provider/model tag (legacy or foreign data)", () => {
      const items = [reasoningItem(undefined)];
      const result = sanitizeReasoningItemsForModel(items, "gpt-4o", "openai");
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
        "anthropic",
      );
      expect(result).toEqual([items[0], items[2]]);
    });
  });

  describe("providers/models where reasoning replay is known-safe (DeepSeek reasoner)", () => {
    it("keeps a reasoning item produced by the exact current model", () => {
      const items = [reasoningItem("deepseek.chat:deepseek-reasoner")];
      const result = sanitizeReasoningItemsForModel(
        items,
        "deepseek-reasoner",
        "deepseek",
      );
      expect(result).toEqual(items);
    });

    it("matches case-insensitively", () => {
      const items = [reasoningItem("DeepSeek.Chat:DeepSeek-Reasoner")];
      const result = sanitizeReasoningItemsForModel(
        items,
        "DEEPSEEK-REASONER",
        "DeepSeek",
      );
      expect(result).toHaveLength(1);
    });

    it("drops a reasoning item produced by a different model (provider switch)", () => {
      const items = [
        reasoningItem("anthropic.messages:claude-sonnet-4-20250514"),
      ];
      const result = sanitizeReasoningItemsForModel(
        items,
        "deepseek-reasoner",
        "deepseek",
      );
      expect(result).toHaveLength(0);
    });

    it("drops a reasoning item with no provider/model tag even within the safe zone", () => {
      const items = [reasoningItem(undefined)];
      const result = sanitizeReasoningItemsForModel(
        items,
        "deepseek-reasoner",
        "deepseek",
      );
      expect(result).toHaveLength(0);
    });

    it("also recognizes a deepseek-reasoner model id without an explicit provider", () => {
      const items = [reasoningItem("deepseek.chat:deepseek-reasoner")];
      const result = sanitizeReasoningItemsForModel(items, "deepseek-reasoner");
      expect(result).toEqual(items);
    });

    it("preserves ordering of surviving items", () => {
      const items = [
        userMessage("first"),
        reasoningItem("deepseek.chat:deepseek-reasoner"),
        userMessage("second"),
        reasoningItem("deepseek.chat:deepseek-reasoner"),
        userMessage("third"),
      ];
      const result = sanitizeReasoningItemsForModel(
        items,
        "deepseek-reasoner",
        "deepseek",
      );
      expect(result).toEqual(items);
    });
  });

  it("returns an empty array unchanged", () => {
    expect(sanitizeReasoningItemsForModel([], "gpt-4o", "openai")).toEqual([]);
  });
});
