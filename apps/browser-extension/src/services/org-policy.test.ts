import {
  loadOrgPolicy,
  resetOrgPolicyForTests,
} from "@apty/browser-runtime/runtime/org-policy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installOrgPolicySource } from "./org-policy";

const managedGet = vi.fn();
const localGet = vi.fn();

describe("installOrgPolicySource", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetOrgPolicyForTests();
    vi.stubGlobal("chrome", {
      storage: {
        managed: { get: managedGet },
        local: { get: localGet },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });
  });

  afterEach(() => {
    resetOrgPolicyForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps managed storage as the source outside an E2E build", async () => {
    managedGet.mockResolvedValue({ kbToModel: "approved" });
    localGet.mockResolvedValue({
      "apty-e2e-org-policy": { kbToModel: "off" },
    });
    installOrgPolicySource();
    expect(await loadOrgPolicy()).toEqual({
      kind: "active",
      policy: { kbToModel: "approved" },
    });
    expect(localGet).not.toHaveBeenCalled();
  });

  it("reads the test key in an E2E build", async () => {
    vi.stubEnv("VITE_APTY_E2E_POLICY_SEAM", "1");
    localGet.mockResolvedValue({
      "apty-e2e-org-policy": { redactionFloor: "strict" },
    });
    installOrgPolicySource();
    expect(await loadOrgPolicy()).toEqual({
      kind: "active",
      policy: { redactionFloor: "strict" },
    });
    expect(managedGet).not.toHaveBeenCalled();
  });
});
