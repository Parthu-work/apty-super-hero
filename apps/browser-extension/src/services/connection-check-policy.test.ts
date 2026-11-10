import type { OrgPolicyState } from "@apty/agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText,
}));
const policy = vi.hoisted(() => ({
  state: { kind: "none" } as OrgPolicyState,
}));
vi.mock("@apty/browser-runtime/runtime/org-policy", () => ({
  peekOrgPolicy: () => policy.state,
  loadOrgPolicy: async () => policy.state,
}));

import { testConnection } from "./connection-check";

describe("testConnection under the organization policy (KB-RAG K22)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("makes no request to a refused destination, and says why", async () => {
    policy.state = {
      kind: "active",
      policy: { allowedProviders: ["azure"] },
    };
    await expect(
      testConnection({ aiProvider: "openai", aiModel: "m", aiToken: "k" }),
    ).rejects.toThrow(
      "This AI provider is not allowed by your organization. Allowed: azure.",
    );
    expect(generateText).not.toHaveBeenCalled();
  });

  it("makes no request under an invalid policy", async () => {
    policy.state = { kind: "invalid", reason: "typo" };
    await expect(
      testConnection({ aiProvider: "openai", aiModel: "m", aiToken: "k" }),
    ).rejects.toThrow(/cannot be used \(typo\)/);
    expect(generateText).not.toHaveBeenCalled();
  });
});
