import { describe, expect, it } from "vitest";
import {
  effectiveSettings,
  isDemoKbPack,
  settingsForWrite,
  strongerRedaction,
} from "./effective-settings.js";
import type { OrgPolicy, OrgPolicyState } from "./org-policy.js";
import type { AppSettings, CustomModelConfig } from "./settings.js";

const NONE: OrgPolicyState = { kind: "none" };
const active = (policy: OrgPolicy): OrgPolicyState => ({
  kind: "active",
  policy,
});
const INVALID: OrgPolicyState = { kind: "invalid", reason: "typo" };

const model = (id: string): CustomModelConfig => ({
  id,
  providerType: "openai",
  aiToken: "t",
  aiModel: "m",
  enabled: true,
});

const LOCAL: AppSettings = {
  aiProvider: "openai",
  aiHost: "https://api.openai.com/v1",
  aiModel: "gpt-local",
  aiToken: "sk-local",
  redactionMode: "off",
  customModels: [model("builtin-openai"), model("mine")],
};

describe("effectiveSettings", () => {
  it("is the stored settings with no policy and no non-demo pack", () => {
    const result = effectiveSettings(LOCAL, NONE);
    expect(result.settings).toEqual(LOCAL);
    expect(result.locked.size).toBe(0);
    expect(result.redactionFloor).toBeUndefined();
    expect(result.customModelsAllowed).toBe(true);
  });

  it("writes each preset field in and locks it", () => {
    const result = effectiveSettings(
      LOCAL,
      active({
        preset: {
          aiProvider: "azure",
          aiHost: "https://t.openai.azure.com/openai/v1",
          aiModel: "gpt-org",
          aiToken: "org-token",
          aiWorkspaceId: "wrkspc_org",
        },
      }),
    );
    expect(result.settings).toMatchObject({
      aiProvider: "azure",
      aiHost: "https://t.openai.azure.com/openai/v1",
      aiModel: "gpt-org",
      aiToken: "org-token",
      aiWorkspaceId: "wrkspc_org",
    });
    expect([...result.locked].sort()).toEqual([
      "aiHost",
      "aiModel",
      "aiProvider",
      "aiToken",
      "aiWorkspaceId",
    ]);
  });

  it("raises redaction to Standard while a non-demo pack is loaded (D-SEC3)", () => {
    const result = effectiveSettings(LOCAL, NONE, { nonDemoPackLoaded: true });
    expect(result.settings.redactionMode).toBe("standard");
    expect(result.redactionFloor).toEqual({
      mode: "standard",
      reason: "kb-pack",
    });
    expect(result.locked.has("redactionMode")).toBe(false);
    expect(
      effectiveSettings({ ...LOCAL, redactionMode: "strict" }, NONE, {
        nonDemoPackLoaded: true,
      }).settings.redactionMode,
    ).toBe("strict");
  });

  it("restores the SE's choice once the pack is gone", () => {
    expect(
      effectiveSettings(LOCAL, NONE, { nonDemoPackLoaded: false }).settings
        .redactionMode,
    ).toBe("off");
  });

  it("applies a policy floor, and locks the mode when the floor is strict", () => {
    const standard = effectiveSettings(
      LOCAL,
      active({ redactionFloor: "standard" }),
    );
    expect(standard.settings.redactionMode).toBe("standard");
    expect(standard.redactionFloor).toEqual({
      mode: "standard",
      reason: "policy",
    });
    const strict = effectiveSettings(
      LOCAL,
      active({ redactionFloor: "strict" }),
      { nonDemoPackLoaded: true },
    );
    expect(strict.settings.redactionMode).toBe("strict");
    expect(strict.redactionFloor).toEqual({ mode: "strict", reason: "policy" });
    expect(strict.locked.has("redactionMode")).toBe(true);
  });

  it("reads an unset or unknown stored mode as strict", () => {
    expect(
      effectiveSettings({}, NONE, { nonDemoPackLoaded: true }).settings
        .redactionMode,
    ).toBe("strict");
  });

  it("drops the SE's own custom models when the policy does not allow them", () => {
    const result = effectiveSettings(LOCAL, active({ allowedModels: ["m"] }));
    expect(result.customModelsAllowed).toBe(false);
    expect(result.settings.customModels?.map((m) => m.id)).toEqual([
      "builtin-openai",
    ]);
    expect(
      effectiveSettings(LOCAL, active({ allowCustomModels: true })).settings
        .customModels,
    ).toHaveLength(2);
  });

  it("acts as the restrictive policy when the policy is invalid", () => {
    const result = effectiveSettings(LOCAL, INVALID);
    expect(result.settings.redactionMode).toBe("strict");
    expect(result.locked.has("redactionMode")).toBe(true);
    expect(result.customModelsAllowed).toBe(false);
  });
});

describe("settingsForWrite", () => {
  const policy = active({
    preset: { aiProvider: "azure", aiModel: "gpt-org" },
    redactionFloor: "strict",
  });

  it("keeps the stored value of a locked field and reports the attempt", () => {
    const effective = effectiveSettings(LOCAL, policy);
    const { settings, ignored } = settingsForWrite(
      LOCAL,
      {
        ...LOCAL,
        aiProvider: "deepseek",
        redactionMode: "off",
        language: "zh",
      },
      effective,
    );
    expect(settings.aiProvider).toBe("openai");
    expect(settings.redactionMode).toBe("off");
    expect(settings.language).toBe("zh");
    expect(ignored).toEqual(["aiProvider"]);
    expect(effectiveSettings(settings, policy).settings.aiProvider).toBe(
      "azure",
    );
  });

  it("does not report writing back the effective value", () => {
    const effective = effectiveSettings(LOCAL, policy);
    const { settings, ignored } = settingsForWrite(
      LOCAL,
      effective.settings,
      effective,
    );
    expect(ignored).toEqual([]);
    expect(settings.aiModel).toBe("gpt-local");
    expect(settings.redactionMode).toBe("off");
  });

  it("does not store custom models the policy forbids", () => {
    const effective = effectiveSettings(LOCAL, active({ allowedModels: [] }));
    const { settings } = settingsForWrite(LOCAL, LOCAL, effective);
    expect(settings.customModels?.map((m) => m.id)).toEqual(["builtin-openai"]);
  });
});

describe("helpers", () => {
  it("orders redaction strict, standard, off", () => {
    expect(strongerRedaction("off", "standard")).toBe("standard");
    expect(strongerRedaction("strict", "standard")).toBe("strict");
    expect(strongerRedaction("off", "off")).toBe("off");
  });

  it("knows a demo pack by its .invalid site", () => {
    expect(isDemoKbPack({ site: "demo.atlassian.invalid" })).toBe(true);
    expect(isDemoKbPack({ site: "Demo.Atlassian.INVALID." })).toBe(true);
    expect(isDemoKbPack({ site: "synthetic.atlassian.example" })).toBe(false);
    expect(isDemoKbPack({ site: "invalid.atlassian.net" })).toBe(false);
  });
});
