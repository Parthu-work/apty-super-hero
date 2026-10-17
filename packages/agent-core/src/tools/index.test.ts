import { RunContext } from "@openai/agents";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { tool } from "./index.js";

const echo = () =>
  tool({
    name: "echo",
    description: "Echo",
    parameters: z.object({
      text: z.string().optional().describe("What to echo"),
      items: z
        .array(
          z.object({
            label: z.string().optional().describe("A label"),
          }),
        )
        .optional()
        .describe("Items"),
    }),
    execute: async (args) => JSON.stringify(args),
  });

describe("tool", () => {
  it("describes an optional field once, not again inside its nullable variant", () => {
    const schema = JSON.stringify(echo().parameters);
    expect(schema.match(/What to echo/g)).toHaveLength(1);
    expect(schema.match(/A label/g)).toHaveLength(1);
    expect(schema.match(/"Items"/g)).toHaveLength(1);
  });

  it("still accepts null for an optional field and drops it", async () => {
    await expect(
      echo().invoke(
        new RunContext(),
        JSON.stringify({ text: null, items: [{ label: null }] }),
      ),
    ).resolves.toBe(JSON.stringify({ items: [{}] }));
  });

  it("tells the model why a tool failed", async () => {
    const failing = tool({
      name: "fails",
      description: "Fails",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("disabled in background mode");
      },
    });
    await expect(failing.invoke(new RunContext(), "{}")).resolves.toMatch(
      /disabled in background mode/,
    );
  });
});
