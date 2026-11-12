import { describe, expect, it, vi } from "vitest";

vi.mock("@apty/browser-runtime", () => ({}));
vi.mock("@apty/browser-runtime/hooks", () => ({}));

import { combineResponders } from "./browser-agent-config";

const decision = {
  route: "model" as const,
  version: "unknown" as const,
  versionSource: "unknown" as const,
  packs: [],
  kb: { kind: "how_to" as const },
};
const fileAnswer = {
  toolName: "inspect_extension_network",
  params: {},
  result: {},
  transcript: "{}",
};

describe("combineResponders (KB-RAG K25, A2)", () => {
  it("a later responder's answer is a file fetch with the earlier decision", async () => {
    const respond = combineResponders([
      async () => ({ decision }),
      async () => fileAnswer,
    ]);
    expect(await respond("get segments.json", {})).toEqual({
      ...fileAnswer,
      decision: { ...decision, route: "file_fetch" },
    });
  });

  it("no answer keeps the decision for the model's turn", async () => {
    const respond = combineResponders([
      async () => ({ decision }),
      async () => undefined,
    ]);
    expect(await respond("hello", {})).toEqual({ decision });
  });

  it("an answer with its own decision keeps it", async () => {
    const own = { ...decision, route: "kb" as const };
    const respond = combineResponders([
      async () => ({ ...fileAnswer, decision: own }),
    ]);
    expect(await respond("x", {})).toMatchObject({ decision: own });
  });
});
