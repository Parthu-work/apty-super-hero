import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  IMAGE_TOKENS,
  measureRequest,
  toolSchemaTokens,
} from "./request-anatomy.js";

describe("request anatomy", () => {
  it("estimates one token per four characters, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("counts a tool's name, description and parameters", () => {
    const tool = { name: "t", description: "d", parameters: { a: 1 } };
    expect(toolSchemaTokens([tool])).toBe(
      estimateTokens(
        JSON.stringify({ name: "t", description: "d", parameters: { a: 1 } }),
      ),
    );
  });

  it("splits history from tool results and sums the total", () => {
    const anatomy = measureRequest({
      instructions: "x".repeat(40),
      tools: [{ name: "t" }],
      input: [
        { type: "message", role: "user", content: "y".repeat(8) },
        { type: "function_call", arguments: "z".repeat(4) },
        { type: "function_call_result", output: "r".repeat(400) },
      ],
    });
    expect(anatomy.systemPromptTokens).toBe(10);
    expect(anatomy.historyTokens).toBe(3);
    expect(anatomy.toolResultTokens).toBe(100);
    expect(anatomy.toolCount).toBe(1);
    expect(anatomy.totalTokens).toBe(
      anatomy.systemPromptTokens +
        anatomy.toolSchemaTokens +
        anatomy.historyTokens +
        anatomy.toolResultTokens,
    );
  });

  it("counts an image at a fixed estimate, not its data URL as text (5)", () => {
    const withImage = measureRequest({
      instructions: "",
      tools: [],
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "abcd" },
            {
              type: "input_image",
              image: `data:image/png;base64,${"A".repeat(400_000)}`,
            },
          ],
        },
      ],
    });

    expect(withImage.historyTokens).toBe(
      estimateTokens(JSON.stringify([{ type: "input_text", text: "abcd" }])) +
        IMAGE_TOKENS,
    );
  });
});
