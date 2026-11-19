import { describe, expect, it } from "vitest";
import { AI_PROVIDERS, type AIProviderKey } from "./ai-providers.js";
import {
  DEFAULT_PROVIDER_REQUEST_CAP,
  PROVIDER_REQUEST_CAPS,
  providerRequestCap,
  REQUEST_TOKEN_BUDGET_RANGE,
} from "./settings.js";

describe("providerRequestCap (KB-RAG K27, E6)", () => {
  it("gives each provider a budget under its context window", () => {
    expect(providerRequestCap({ aiProvider: "anthropic" })).toBe(150_000);
    expect(providerRequestCap({ aiProvider: "google" })).toBe(780_000);
    expect(providerRequestCap({ aiProvider: "groq" })).toBe(
      DEFAULT_PROVIDER_REQUEST_CAP,
    );
    expect(providerRequestCap({})).toBe(DEFAULT_PROVIDER_REQUEST_CAP);
  });

  it("is a budget Settings would accept for every preset", () => {
    for (const provider of Object.keys(AI_PROVIDERS) as AIProviderKey[]) {
      const cap = providerRequestCap({ aiProvider: provider });
      expect(cap).toBeGreaterThanOrEqual(REQUEST_TOKEN_BUDGET_RANGE.min);
      expect(cap).toBeLessThanOrEqual(REQUEST_TOKEN_BUDGET_RANGE.max);
    }
    for (const provider of Object.keys(PROVIDER_REQUEST_CAPS)) {
      expect(Object.hasOwn(AI_PROVIDERS, provider)).toBe(true);
    }
  });
});
