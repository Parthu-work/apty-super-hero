import type { AgentInputItem } from "@openai/agents";
import { describe, expect, it } from "vitest";
import { estimateRequestTokens } from "./request-size.js";

describe("estimateRequestTokens", () => {
  it("counts a screenshot as an image, not its data URL as text (P5-3)", () => {
    const tokens = estimateRequestTokens({
      instructions: "",
      tools: [],
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_image",
              image: `data:image/png;base64,${"A".repeat(400_000)}`,
            },
          ],
        } as AgentInputItem,
      ],
    });

    expect(tokens).toBeLessThan(2_000);
  });
});
