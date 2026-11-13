import { describe, expect, it } from "vitest";
import {
  auditRetentionDays,
  customModelsAllowed,
  domConfigRetentionDays,
  kbPackCheckHours,
  kbPackManaged,
  kbPackSources,
  kbToMcpAllowed,
  mcpBridgeAllowed,
  orgPolicyStateOf,
  parseOrgPolicy,
  policyOf,
  RESTRICTIVE_ORG_POLICY,
} from "./org-policy.js";

const FULL = {
  kbToModel: "approved",
  kbToMcp: true,
  allowedProviders: ["azure", "openai"],
  allowedOrigins: [
    "https://AI-Gateway.example.com:443/",
    "http://localhost:11434",
  ],
  allowedModels: ["gpt-5"],
  preset: {
    aiProvider: "azure",
    aiHost: "https://tenant.openai.azure.com/openai/v1",
    aiModel: "gpt-5",
    aiToken: "policy-token",
    aiWorkspaceId: "wrkspc_1",
  },
  redactionFloor: "strict",
  allowCustomModels: false,
  allowMcpBridge: false,
  auditRetentionDays: 90,
};

describe("parseOrgPolicy", () => {
  it("parses every key, normalizing origins", () => {
    const parsed = parseOrgPolicy(FULL);
    expect(parsed).toEqual({
      ok: true,
      policy: {
        ...FULL,
        allowedOrigins: [
          "https://ai-gateway.example.com",
          "http://localhost:11434",
        ],
      },
    });
  });

  it.each([
    [{ kbToModel: "on" }, /kbToModel/],
    [{ kbToMcp: "true" }, /kbToMcp must be a boolean/],
    [{ allowedProviders: "openai" }, /string list/],
    [{ allowedProviders: ["skynet"] }, /not a provider/],
    [{ allowedOrigins: ["http://ai.example.com"] }, /not https/],
    [{ allowedOrigins: ["https://ai.example.com/v1"] }, /has a path/],
    [{ allowedOrigins: ["https://u:p@ai.example.com"] }, /user info/],
    [{ allowedOrigins: ["not a url"] }, /not a URL/],
    [{ allowedModels: [1] }, /string list/],
    [{ preset: [] }, /preset must be an object/],
    [{ preset: { aiColour: "red" } }, /preset.aiColour/],
    [{ preset: { aiHost: "http://ai.example.com" } }, /https/],
    [{ preset: { aiModel: 5 } }, /must be a string/],
    [{ redactionFloor: "off" }, /redactionFloor/],
    [{ auditRetentionDays: 0 }, /1 to 365/],
    [{ auditRetentionDays: 366 }, /1 to 365/],
    [{ auditRetentionDays: 1.5 }, /1 to 365/],
    [{ kbtomodel: "off" }, /not a policy key/],
  ])("refuses %j", (raw, reason) => {
    const parsed = parseOrgPolicy(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(reason);
  });

  it("accepts loopback over http for a local model", () => {
    expect(
      parseOrgPolicy({
        allowedOrigins: ["http://127.0.0.1:1234", "http://[::1]:8080"],
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("orgPolicyStateOf", () => {
  it("is none for empty managed storage", () => {
    expect(orgPolicyStateOf({})).toEqual({ kind: "none" });
  });

  it("is invalid, with the reason, for a policy that does not parse", () => {
    expect(orgPolicyStateOf({ extra: 1 })).toEqual({
      kind: "invalid",
      reason: '"extra" is not a policy key',
    });
    expect(orgPolicyStateOf(null)).toMatchObject({ kind: "invalid" });
  });

  it("is active for a policy that parses", () => {
    expect(orgPolicyStateOf({ kbToModel: "off" })).toEqual({
      kind: "active",
      policy: { kbToModel: "off" },
    });
  });
});

describe("what a policy state means", () => {
  const invalid = { kind: "invalid", reason: "x" } as const;
  const none = { kind: "none" } as const;

  it("maps invalid to the restrictive policy", () => {
    expect(policyOf(invalid)).toBe(RESTRICTIVE_ORG_POLICY);
    expect(kbToMcpAllowed(invalid)).toBe(false);
    expect(mcpBridgeAllowed(invalid)).toBe(false);
    expect(customModelsAllowed(invalid)).toBe(false);
    expect(RESTRICTIVE_ORG_POLICY.kbToModel).toBe("off");
    expect(RESTRICTIVE_ORG_POLICY.redactionFloor).toBe("strict");
  });

  it("restricts nothing with no policy, except KB text to MCP", () => {
    expect(policyOf(none)).toBeNull();
    expect(mcpBridgeAllowed(none)).toBe(true);
    expect(customModelsAllowed(none)).toBe(true);
    expect(kbToMcpAllowed(none)).toBe(false);
    expect(auditRetentionDays(none)).toBe(30);
  });

  it("forbids custom models by default once an allow-list is set", () => {
    const active = (policy: object) => ({ kind: "active" as const, policy });
    expect(customModelsAllowed(active({ kbToModel: "off" }))).toBe(true);
    expect(customModelsAllowed(active({ allowedModels: ["m"] }))).toBe(false);
    expect(
      customModelsAllowed(
        active({ allowedModels: ["m"], allowCustomModels: true }),
      ),
    ).toBe(true);
    expect(auditRetentionDays(active({ auditRetentionDays: 7 }))).toBe(7);
  });
});

describe("KB pack trust keys (KB-RAG K23 P3)", () => {
  const key = {
    keyId: "0123456789abcdef",
    spki: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEHBwOeyZu0yluxkZg5U2pwvFhCdoC354HQpxyEYHwLYYrKnTlX4N1NS5x9MNEoSMTRJ26NcGyZgat2qVfPlnCfw==",
    name: "IT KB owner",
  };

  it("parses the four keys", () => {
    expect(
      parseOrgPolicy({
        trustedPackKeys: [key],
        revokedPackKeyIds: ["8db33081c3ea74eb"],
        allowUnsignedPacks: false,
        maxPackAgeDays: 90,
      }),
    ).toEqual({
      ok: true,
      policy: {
        trustedPackKeys: [key],
        revokedPackKeyIds: ["8db33081c3ea74eb"],
        allowUnsignedPacks: false,
        maxPackAgeDays: 90,
      },
    });
  });

  it.each([
    [{ trustedPackKeys: key }, /must be a list/],
    [{ trustedPackKeys: [{ ...key, keyId: "XYZ" }] }, /16 hex/],
    [
      { trustedPackKeys: [{ ...key, spki: "not base64!" }] },
      /base64 public key/,
    ],
    [{ trustedPackKeys: [{ ...key, name: "" }] }, /1 to 100/],
    [{ trustedPackKeys: [{ ...key, extra: 1 }] }, /"extra" is not a key field/],
    [{ revokedPackKeyIds: ["short"] }, /16-hex/],
    [{ allowUnsignedPacks: "yes" }, /must be a boolean/],
    [{ maxPackAgeDays: 0 }, /1 to 365/],
    [{ maxPackAgeDays: 366 }, /1 to 365/],
    [{ maxPackAgeDays: 1.5 }, /1 to 365/],
  ])("refuses %j", (raw, reason) => {
    const parsed = parseOrgPolicy(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(reason);
  });
});

describe("KB pack delivery keys (KB-RAG K26 D1)", () => {
  const sources = {
    "4.x": "https://packs.example.com/apty-kb-4.x.kbpack.json",
    "5.x": "https://packs.example.com/kb/5x.json?v=1",
    common: "https://packs.example.com/common.json",
  };

  it("parses the three keys", () => {
    expect(
      parseOrgPolicy({
        kbPackSources: sources,
        kbPackCheckHours: 24,
        allowManualPackImport: true,
      }),
    ).toEqual({
      ok: true,
      policy: {
        kbPackSources: sources,
        kbPackCheckHours: 24,
        allowManualPackImport: true,
      },
    });
  });

  it.each([
    [{ kbPackSources: ["https://a.example.com/p.json"] }, /must be an object/],
    [
      { kbPackSources: { "6.x": "https://a.example.com/p.json" } },
      /"6.x" is not/,
    ],
    [{ kbPackSources: { "5.x": "http://a.example.com/p.json" } }, /not https/],
    [
      { kbPackSources: { "5.x": "https://user:pass@a.example.com/p.json" } },
      /user info/,
    ],
    [
      { kbPackSources: { "5.x": "https://a.example.com/p.json#x" } },
      /fragment/,
    ],
    [{ kbPackSources: { "5.x": "https://a.example.com/p.json#" } }, /fragment/],
    [
      { kbPackSources: { "5.x": `https://a.example.com/${"p".repeat(2048)}` } },
      /2,048/,
    ],
    [{ kbPackSources: { "5.x": 42 } }, /must be a string/],
    [{ kbPackSources: { "5.x": "not a url" } }, /not a URL/],
    [{ kbPackSources: { "5.x": "ftp://a.example.com/p.json" } }, /not https/],
    [{ kbPackCheckHours: 0 }, /1 to 168/],
    [{ kbPackCheckHours: 169 }, /1 to 168/],
    [{ kbPackCheckHours: 2.5 }, /1 to 168/],
    [{ allowManualPackImport: "yes" }, /must be a boolean/],
  ])("refuses %j", (raw, reason) => {
    const parsed = parseOrgPolicy(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(reason);
  });

  it("accepts http://127.0.0.1 only with the E2E seam's option", () => {
    const raw = { kbPackSources: { "5.x": "http://127.0.0.1:8787/p.json" } };
    expect(parseOrgPolicy(raw).ok).toBe(false);
    expect(
      parseOrgPolicy(
        { kbPackSources: { "5.x": "http://localhost:8787/p" } },
        {
          allowLoopbackPackSources: true,
        },
      ).ok,
    ).toBe(false);
    expect(orgPolicyStateOf(raw, { allowLoopbackPackSources: true }).kind).toBe(
      "active",
    );
  });

  it("defaults: no sources, 6 hours, manual import off for a sourced version", () => {
    expect(kbPackSources({ kind: "none" })).toEqual({});
    expect(kbPackCheckHours({ kind: "none" })).toBe(6);
    expect(kbPackSources({ kind: "invalid", reason: "bad" })).toEqual({});
    const state = orgPolicyStateOf({
      kbPackSources: { "5.x": sources["5.x"] },
    });
    expect(kbPackManaged(state, "5.x")).toBe(true);
    expect(kbPackManaged(state, "4.x")).toBe(false);
    const allowed = orgPolicyStateOf({
      kbPackSources: { "5.x": sources["5.x"] },
      allowManualPackImport: true,
    });
    expect(kbPackManaged(allowed, "5.x")).toBe(false);
  });
});

describe("domConfigRetentionDays (KB-RAG K26 D-DOM1)", () => {
  it("is 30 by default and the policy's when set, 1 to 365", () => {
    expect(domConfigRetentionDays({ kind: "none" })).toBe(30);
    const state = orgPolicyStateOf({ domConfigRetentionDays: 7 });
    expect(domConfigRetentionDays(state)).toBe(7);
    for (const bad of [0, 366, 2.5, "7"]) {
      expect(parseOrgPolicy({ domConfigRetentionDays: bad }).ok).toBe(false);
    }
  });
});
