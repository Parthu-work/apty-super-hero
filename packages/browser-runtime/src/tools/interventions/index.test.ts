import { beforeEach, describe, expect, it, vi } from "vitest";

const manager = vi.hoisted(() => ({
  isInitialized: vi.fn(() => true),
  initialize: vi.fn(),
  getConversationMode: vi.fn(() => "passive"),
  requestIntervention: vi.fn(async () => ({
    success: true,
    data: { picked: "a" },
    status: "completed",
    duration: 5,
  })),
}));

vi.mock("../../interventions/intervention-manager.js", () => ({
  interventionManager: manager,
}));

import { requestInterventionTool } from "./index.js";

beforeEach(() => vi.clearAllMocks());

describe("request_intervention", () => {
  it("has a schema the model API accepts in strict mode", () => {
    const schema = JSON.stringify(
      (requestInterventionTool as { parameters: unknown }).parameters,
    );
    expect(schema).toContain('"additionalProperties":false');
    expect(schema).not.toMatch(/"additionalProperties":\{\}/);
  });

  it("hands the intervention only the parameters the model set", async () => {
    await requestInterventionTool.invoke(
      {} as never,
      JSON.stringify({
        type: "user-selection",
        params: {
          reason: null,
          highlightColor: null,
          question: "Which tenant?",
          options: [
            { id: "a", label: "Alpha", description: null },
            { id: "b", label: "Beta", description: "Second" },
          ],
          mode: "single",
          allowOther: null,
        },
        timeout: 60,
        reason: "Need the tenant",
      }),
    );

    expect(manager.requestIntervention).toHaveBeenCalledWith(
      "user-selection",
      {
        question: "Which tenant?",
        options: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta", description: "Second" },
        ],
        mode: "single",
      },
      60,
      "Need the tenant",
    );
  });

  it("passes no parameters when the model set none", async () => {
    await requestInterventionTool.invoke(
      {} as never,
      JSON.stringify({
        type: "monitor-operation",
        params: null,
        timeout: 30,
        reason: "",
      }),
    );

    expect(manager.requestIntervention).toHaveBeenCalledWith(
      "monitor-operation",
      undefined,
      30,
      undefined,
    );
  });
});
