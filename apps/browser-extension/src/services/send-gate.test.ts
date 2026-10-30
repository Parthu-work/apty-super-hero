import type { AppSettings } from "@apty/agent-core";
import { describe, expect, it } from "vitest";
import { checkAuth } from "./send-gate";

const CONFIGURED: AppSettings = {
  aiProvider: "openai",
  aiToken: "sk-test",
  aiModel: "gpt-test",
};

describe("checkAuth", () => {
  it("sends anything once a provider is set up", () => {
    expect(checkAuth(CONFIGURED, "hello")).toEqual({
      needsAuth: false,
      hasCustomConfig: true,
    });
  });

  it("without a provider, sends a message a check answers with no model, and asks for setup for anything else (8)", () => {
    expect(
      checkAuth({}, "my workflow is not visible in the widget").needsAuth,
    ).toBe(false);
    expect(checkAuth({}, "the widget is not showing").needsAuth).toBe(false);
    expect(checkAuth({}, "hello, what can you do?")).toEqual({
      needsAuth: true,
      hasCustomConfig: false,
    });
  });
});
