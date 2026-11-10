import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChangeListener = (changes: object, areaName: string) => void;

const managedGet = vi.fn();
let changeListeners: ChangeListener[] = [];

vi.stubGlobal("chrome", {
  storage: {
    managed: { get: managedGet },
    onChanged: {
      addListener: (listener: ChangeListener) => changeListeners.push(listener),
      removeListener: (listener: ChangeListener) => {
        changeListeners = changeListeners.filter((l) => l !== listener);
      },
    },
  },
});

import {
  currentOrgPolicy,
  loadOrgPolicy,
  resetOrgPolicyForTests,
  watchOrgPolicy,
} from "./org-policy";

describe("org policy reader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    changeListeners = [];
    resetOrgPolicyForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads managed storage: empty is none", async () => {
    managedGet.mockResolvedValue({});
    expect(await loadOrgPolicy()).toEqual({ kind: "none" });
    expect(managedGet).toHaveBeenCalledWith(null);
  });

  it("parses an active policy", async () => {
    managedGet.mockResolvedValue({ kbToModel: "approved" });
    expect(await loadOrgPolicy()).toEqual({
      kind: "active",
      policy: { kbToModel: "approved" },
    });
  });

  it("fails closed when the policy is malformed or cannot be read", async () => {
    managedGet.mockResolvedValue({ kbToModel: "approved", typo: true });
    expect(await loadOrgPolicy()).toEqual({
      kind: "invalid",
      reason: '"typo" is not a policy key',
    });
    resetOrgPolicyForTests();
    managedGet.mockRejectedValue(new Error("managed storage unavailable"));
    expect(await loadOrgPolicy()).toEqual({
      kind: "invalid",
      reason: "the policy could not be read: managed storage unavailable",
    });
  });

  it("is invalid (not read yet) before the first read completes", () => {
    managedGet.mockReturnValue(new Promise(() => {}));
    expect(currentOrgPolicy()).toMatchObject({ kind: "invalid" });
  });

  it("re-reads and notifies when managed storage changes", async () => {
    managedGet.mockResolvedValue({});
    await loadOrgPolicy();
    const seen = vi.fn();
    watchOrgPolicy(seen);
    managedGet.mockResolvedValue({ kbToMcp: true });
    for (const listener of changeListeners) listener({}, "local");
    expect(seen).not.toHaveBeenCalled();
    for (const listener of changeListeners) listener({}, "managed");
    await vi.waitFor(() =>
      expect(seen).toHaveBeenCalledWith({
        kind: "active",
        policy: { kbToMcp: true },
      }),
    );
    expect(currentOrgPolicy()).toEqual({
      kind: "active",
      policy: { kbToMcp: true },
    });
  });
});
