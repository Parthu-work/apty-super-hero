import { beforeEach, describe, expect, it, vi } from "vitest";
import { lockdownStorageAccess } from "./storage-lockdown";

const mockLocalSetAccessLevel = vi.fn();
const mockSessionSetAccessLevel = vi.fn();

beforeEach(() => {
  mockLocalSetAccessLevel.mockReset().mockResolvedValue(undefined);
  mockSessionSetAccessLevel.mockReset().mockResolvedValue(undefined);
  (global as any).chrome = {
    storage: {
      AccessLevel: {
        TRUSTED_CONTEXTS: "TRUSTED_CONTEXTS",
        TRUSTED_AND_UNTRUSTED_CONTEXTS: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
      },
      local: { setAccessLevel: mockLocalSetAccessLevel },
      session: { setAccessLevel: mockSessionSetAccessLevel },
    },
  };
});

describe("lockdownStorageAccess", () => {
  it("restricts both local and session storage to trusted contexts only", () => {
    lockdownStorageAccess();

    expect(mockLocalSetAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    expect(mockSessionSetAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  });

  it("never throws even if the API rejects (e.g. called from a non-trusted context)", async () => {
    mockLocalSetAccessLevel.mockRejectedValue(new Error("not trusted"));
    mockSessionSetAccessLevel.mockRejectedValue(new Error("not trusted"));

    expect(() => lockdownStorageAccess()).not.toThrow();
    // Let the rejected promises' .catch handlers run before the test ends.
    await Promise.resolve();
    await Promise.resolve();
  });
});
