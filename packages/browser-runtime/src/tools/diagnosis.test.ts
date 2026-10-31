import { describe, expect, it } from "vitest";

(globalThis as { chrome?: unknown }).chrome = {
  runtime: { id: "agent", onMessage: { addListener() {} } },
  storage: {
    local: { get: async () => ({}) },
    onChanged: { addListener() {} },
  },
  tabs: { onRemoved: { addListener() {} } },
};

const { runDiagnosisTool } = await import("./diagnosis.js");

type Schema = {
  properties: Record<string, { description?: string }>;
};

describe("run_diagnosis, as the model sees it (N15)", () => {
  const tool = runDiagnosisTool as unknown as {
    description: string;
    parameters: Schema;
  };

  it("says in words what the schema cannot carry in strict mode: a whole step from 1, a lowercase two-letter language", () => {
    const { properties } = tool.parameters;

    expect(properties.step?.description).toMatch(/whole number, 1 or more/);
    expect(properties.language?.description).toMatch(/two lowercase letters/);
  });

  it("costs fewer tokens than its first version, 537", () => {
    const sent = JSON.stringify({
      name: "run_diagnosis",
      description: tool.description,
      parameters: tool.parameters,
    });

    expect(Math.ceil(sent.length / 4)).toBeLessThan(450);
  });
});
