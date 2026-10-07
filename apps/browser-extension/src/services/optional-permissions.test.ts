import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasOptionalPermission,
  removeOptionalPermission,
  requestOptionalPermission,
} from "./optional-permissions";

const mockContains = vi.fn();
const mockRequest = vi.fn();
const mockRemove = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (global as any).chrome = {
    permissions: {
      contains: mockContains,
      request: mockRequest,
      remove: mockRemove,
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hasOptionalPermission", () => {
  it("returns true when chrome.permissions.contains resolves true", async () => {
    mockContains.mockResolvedValue(true);
    expect(await hasOptionalPermission("bookmarks")).toBe(true);
    expect(mockContains).toHaveBeenCalledWith({ permissions: ["bookmarks"] });
  });

  it("returns false when chrome.permissions.contains rejects", async () => {
    mockContains.mockRejectedValue(new Error("boom"));
    expect(await hasOptionalPermission("history")).toBe(false);
  });
});

describe("requestOptionalPermission", () => {
  it("returns true when the user grants the permission", async () => {
    mockRequest.mockResolvedValue(true);
    expect(await requestOptionalPermission("management")).toBe(true);
    expect(mockRequest).toHaveBeenCalledWith({ permissions: ["management"] });
  });

  it("returns false when the user declines", async () => {
    mockRequest.mockResolvedValue(false);
    expect(await requestOptionalPermission("management")).toBe(false);
  });

  it("returns false (never throws) when request rejects outside a user gesture", async () => {
    mockRequest.mockRejectedValue(new Error("not a user gesture"));
    expect(await requestOptionalPermission("bookmarks")).toBe(false);
  });
});

describe("removeOptionalPermission", () => {
  it("returns true when the permission is removed", async () => {
    mockRemove.mockResolvedValue(true);
    expect(await removeOptionalPermission("history")).toBe(true);
  });

  it("returns false when remove rejects", async () => {
    mockRemove.mockRejectedValue(new Error("boom"));
    expect(await removeOptionalPermission("history")).toBe(false);
  });
});
