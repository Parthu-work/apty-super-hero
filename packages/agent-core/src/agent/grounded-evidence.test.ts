import type { AgentInputItem } from "@openai/agents";
import { describe, expect, it } from "vitest";
import { LOCAL_ANSWER_CALL_PREFIX } from "../conversation/compressor.js";
import { kbSourceTag } from "../kb/egress.js";
import { holdsGroundedEvidence } from "./grounded-evidence.js";

const result = (callId: string, text: string) =>
  ({
    type: "function_call_result",
    callId,
    name: "fixture_tool",
    status: "completed",
    output: { type: "text", text },
  }) as AgentInputItem;

describe("holdsGroundedEvidence (KB-RAG K27, E6)", () => {
  it("is true for a turn the runtime answered itself: a check or a KB answer", () => {
    expect(
      holdsGroundedEvidence([
        result(`${LOCAL_ANSWER_CALL_PREFIX}1`, "Check result: FIXTURE"),
      ]),
    ).toBe(true);
  });

  it("is true for a KB result that holds cards, whether or not its text was withheld", () => {
    const tagged = JSON.stringify({
      ...kbSourceTag([{ pageId: "101", layer: 1 }]),
      results: [],
    });
    expect(holdsGroundedEvidence([result("call_1", tagged)])).toBe(true);
  });

  it("is false for other tool results, a KB result with no card, and plain messages", () => {
    expect(
      holdsGroundedEvidence([
        { type: "message", role: "user", content: "hi" } as AgentInputItem,
        result("call_1", '{"page":"FIXTURE"}'),
        result("call_2", JSON.stringify(kbSourceTag([]))),
      ]),
    ).toBe(false);
  });
});
