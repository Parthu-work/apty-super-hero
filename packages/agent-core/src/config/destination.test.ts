import { describe, expect, it } from "vitest";
import {
  destinationAllowed,
  destinationOf,
  kbEgressAllowed,
  requestUrlAllowed,
} from "./destination.js";
import type { OrgPolicy, OrgPolicyState } from "./org-policy.js";

const active = (policy: OrgPolicy): OrgPolicyState => ({
  kind: "active",
  policy,
});
const NONE: OrgPolicyState = { kind: "none" };
const INVALID: OrgPolicyState = { kind: "invalid", reason: "x" };

describe("destinationOf", () => {
  it("normalizes the host to its origin", () => {
    expect(
      destinationOf({
        aiProvider: "azure",
        aiHost: "https://Tenant.OpenAI.Azure.com:443/openai/v1",
        aiModel: "gpt-5",
      }),
    ).toEqual({
      provider: "azure",
      origin: "https://tenant.openai.azure.com",
      model: "gpt-5",
    });
  });

  it("uses the provider's default origin when no host is set", () => {
    expect(destinationOf({ aiProvider: "google" }).origin).toBe(
      "https://generativelanguage.googleapis.com",
    );
    expect(destinationOf({ aiProvider: "anthropic" }).origin).toBe(
      "https://api.anthropic.com",
    );
    expect(destinationOf({}).provider).toBe("openai");
    expect(destinationOf({ aiProvider: "custom" }).origin).toBeUndefined();
  });
});

describe("destinationAllowed", () => {
  const policy = active({
    allowedProviders: ["azure", "custom"],
    allowedOrigins: ["https://ai.example.com", "http://localhost:11434"],
    allowedModels: ["gpt-5"],
  });
  const ok = {
    provider: "azure" as const,
    origin: "https://ai.example.com",
    model: "gpt-5",
  };

  it("allows a destination on every list", () => {
    expect(destinationAllowed(policy, ok)).toEqual({ allowed: true });
  });

  it("refuses a provider, origin or model off its list, naming the list", () => {
    expect(destinationAllowed(policy, { ...ok, provider: "openai" })).toEqual({
      allowed: false,
      reason: "provider",
      allowedValues: ["azure", "custom"],
    });
    expect(
      destinationAllowed(policy, { ...ok, model: "gpt-mini" }),
    ).toMatchObject({ allowed: false, reason: "model" });
    expect(
      destinationAllowed(policy, { ...ok, model: undefined }),
    ).toMatchObject({ allowed: false, reason: "model" });
  });

  it("matches origins exactly: scheme, host and port", () => {
    for (const origin of [
      "https://ai.example.com.evil.test",
      "http://ai.example.com",
      "https://ai.example.com:8443",
      "https://evil.ai.example.com",
      "http://localhost:8080",
      "http://127.0.0.1:11434",
    ]) {
      expect(destinationAllowed(policy, { ...ok, origin })).toMatchObject({
        allowed: false,
        reason: "origin",
      });
    }
    expect(
      destinationAllowed(policy, { ...ok, origin: "http://localhost:11434" }),
    ).toEqual({ allowed: true });
    expect(
      destinationAllowed(policy, { ...ok, origin: undefined }),
    ).toMatchObject({ allowed: false, reason: "origin" });
  });

  it("does not restrict with a list left out, or with no policy", () => {
    expect(destinationAllowed(active({ kbToModel: "approved" }), ok)).toEqual({
      allowed: true,
    });
    expect(destinationAllowed(NONE, ok)).toEqual({ allowed: true });
  });

  it("refuses everything under an invalid policy", () => {
    expect(destinationAllowed(INVALID, ok)).toMatchObject({
      allowed: false,
      reason: "invalid-policy",
    });
    expect(requestUrlAllowed(INVALID, "https://ai.example.com/v1")).toBe(false);
  });

  it("checks a request URL's origin against the list", () => {
    expect(
      requestUrlAllowed(policy, "https://ai.example.com/v1/chat/completions"),
    ).toBe(true);
    expect(
      requestUrlAllowed(policy, "https://ai.example.com.evil.test/v1"),
    ).toBe(false);
    expect(requestUrlAllowed(NONE, "https://anything.test")).toBe(true);
  });
});

describe("kbEgressAllowed (D-SEC1)", () => {
  const dest = {
    provider: "azure" as const,
    origin: "https://ai.example.com",
    model: "gpt-5",
  };
  const real = [{ site: "synthetic.atlassian.example" }];
  const demo = [{ site: "demo.atlassian.invalid" }];

  it("withholds KB text with no policy and a non-demo pack", () => {
    expect(kbEgressAllowed(NONE, dest, real)).toEqual({
      allowed: false,
      reason: "policy-off",
    });
  });

  it("sends KB text when every pack is a demo pack", () => {
    expect(kbEgressAllowed(NONE, dest, demo)).toEqual({
      allowed: true,
      reason: "demo",
    });
    expect(kbEgressAllowed(NONE, dest, [...demo, ...real]).allowed).toBe(false);
  });

  it("sends KB text only to a destination an approving policy allows", () => {
    const approved = active({
      kbToModel: "approved",
      allowedOrigins: ["https://ai.example.com"],
    });
    expect(kbEgressAllowed(approved, dest, real)).toEqual({
      allowed: true,
      reason: "approved",
    });
    expect(
      kbEgressAllowed(
        approved,
        { ...dest, origin: "https://other.test" },
        real,
      ),
    ).toEqual({ allowed: false, reason: "destination" });
    expect(kbEgressAllowed(active({ kbToModel: "off" }), dest, real)).toEqual({
      allowed: false,
      reason: "policy-off",
    });
  });

  it("withholds under an invalid policy, and has nothing to send with no pack", () => {
    expect(kbEgressAllowed(INVALID, dest, real)).toEqual({
      allowed: false,
      reason: "invalid-policy",
    });
    expect(kbEgressAllowed(NONE, dest, [])).toEqual({
      allowed: false,
      reason: "no-pack",
    });
  });
});
