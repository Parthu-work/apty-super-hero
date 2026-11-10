import type { AgentInputItem } from "@openai/agents";
import { describe, expect, it } from "vitest";
import {
  kbCardsIn,
  kbSourceTag,
  kbTagOf,
  kbWithheldForMcp,
  withholdKbText,
} from "./egress.js";

const CARD_TEXT = "Turn on the FIXTURE Zorblaxian setting.";
const kbResult = {
  status: "ok",
  ...kbSourceTag([
    { pageId: "101", layer: 1 },
    { pageId: "202", layer: 3 },
  ]),
  results: [{ cite: "kb://101#L1", text: CARD_TEXT }],
};

const result = (callId: string, output: unknown): AgentInputItem =>
  ({
    type: "function_call_result",
    callId,
    name: "search_kb",
    status: "completed",
    output,
  }) as AgentInputItem;

describe("the KB tag", () => {
  it("reads the tag from a result or its JSON, and nothing else", () => {
    expect(kbTagOf(kbResult)?.cards).toHaveLength(2);
    expect(kbTagOf(JSON.stringify(kbResult))?.source).toBe("kb");
    expect(kbTagOf(JSON.stringify({ ...kbResult, source: "page" }))).toBe(
      undefined,
    );
    expect(kbTagOf(`not json ${CARD_TEXT}`)).toBeUndefined();
    expect(kbTagOf({ text: CARD_TEXT })).toBeUndefined();
  });

  it("acts on the tag, not on the text: untagged card wording passes", () => {
    const items = [result("c1", { type: "text", text: CARD_TEXT })];
    expect(withholdKbText(items)).toEqual(items);
  });
});

describe("withholdKbText", () => {
  it("replaces each tagged result's text, keeping the output shape and order", () => {
    const items: AgentInputItem[] = [
      { type: "message", role: "user", content: "banner glow?" },
      result("local-1", { type: "text", text: JSON.stringify(kbResult) }),
      result("c2", JSON.stringify(kbResult)),
    ];
    const out = withholdKbText(items);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(items[0]);
    const body = JSON.stringify(out);
    expect(body).not.toContain("Zorblaxian");
    expect(out[1]).toMatchObject({
      callId: "local-1",
      output: {
        type: "text",
        text: "KB card text withheld by organization policy. Cards shown to the user: 101, 202.",
      },
    });
    expect((out[2] as { output: unknown }).output).toBe(
      "KB card text withheld by organization policy. Cards shown to the user: 101, 202.",
    );
  });

  it("leaves a tagged result with no cards alone", () => {
    const items = [
      result("c1", JSON.stringify({ status: "no_pack", ...kbSourceTag([]) })),
    ];
    expect(withholdKbText(items)).toEqual(items);
  });

  it("lists the cards the items carry, for the send record", () => {
    expect(kbCardsIn([result("c1", JSON.stringify(kbResult))])).toEqual([
      { pageId: "101", layer: 1 },
      { pageId: "202", layer: 3 },
    ]);
  });

  it("words the MCP replacement with the card ids", () => {
    expect(kbWithheldForMcp([{ pageId: "7" }, { pageId: "7" }])).toBe(
      "KB result withheld by policy. Cards: 7.",
    );
  });
});
