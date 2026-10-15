import { STORAGE_KEYS } from "@apty/agent-core";
import { describe, expect, it, vi } from "vitest";
import {
  LEGACY_KEY_RENAMES,
  legacyKeyFor,
  migrateLegacyStorageKeys,
  type StorageAreaLike,
} from "./legacy-storage.js";

function memoryArea(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = structuredClone(initial);
  const area: StorageAreaLike = {
    get: vi.fn(async (keys: string | string[]) => {
      const out: Record<string, unknown> = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (key in data) out[key] = structuredClone(data[key]);
      }
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, structuredClone(items));
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }),
  };
  return { area, data };
}

const settings = { aiToken: "kept", redactionMode: "standard" };
const grants = [{ tool: "click", origin: "https://a.example" }];

describe("migrateLegacyStorageKeys", () => {
  it("renames every key the Agent stored under an AIPex name to its Apty name", () => {
    expect(STORAGE_KEYS.SETTINGS).toBe("apty_settings");
    for (const [oldKey, newKey] of Object.entries(LEGACY_KEY_RENAMES)) {
      expect(oldKey.startsWith("aipex")).toBe(true);
      expect(newKey).toMatch(/^apty[_-]/);
    }
    expect(Object.values(LEGACY_KEY_RENAMES)).toEqual(
      expect.arrayContaining(Object.values(STORAGE_KEYS)),
    );
  });

  it("copies, verifies, then deletes each old key", async () => {
    const { area, data } = memoryArea({
      aipex_settings: settings,
      aipex_risky_origin_grants: grants,
      unrelated: 1,
    });

    const moved = await migrateLegacyStorageKeys(area);

    expect(data).toEqual({
      apty_settings: settings,
      apty_risky_origin_grants: grants,
      unrelated: 1,
    });
    expect(moved.sort()).toEqual([
      "aipex_risky_origin_grants",
      "aipex_settings",
    ]);
    const setOrder = vi.mocked(area.set).mock.invocationCallOrder[0];
    const removeOrder = vi.mocked(area.remove).mock.invocationCallOrder[0];
    expect(setOrder).toBeLessThan(removeOrder);
  });

  it("is idempotent", async () => {
    const { area, data } = memoryArea({ aipex_settings: settings });
    await migrateLegacyStorageKeys(area);
    const after = structuredClone(data);

    expect(await migrateLegacyStorageKeys(area)).toEqual([]);
    expect(data).toEqual(after);
  });

  it("finishes a migration interrupted after the copy, keeping the new value", async () => {
    const newer = { ...settings, aiToken: "changed since" };
    const { area, data } = memoryArea({
      aipex_settings: settings,
      apty_settings: newer,
    });

    await migrateLegacyStorageKeys(area);

    expect(data).toEqual({ apty_settings: newer });
  });

  it("keeps the old key when the copy fails, and moves it on the next run", async () => {
    const { area, data } = memoryArea({ aipex_settings: settings });
    vi.mocked(area.set).mockRejectedValueOnce(new Error("quota"));

    await expect(migrateLegacyStorageKeys(area)).rejects.toThrow();
    expect(data).toEqual({ aipex_settings: settings });

    await migrateLegacyStorageKeys(area);
    expect(data).toEqual({ apty_settings: settings });
  });

  it("keeps the old key when the copy reads back different", async () => {
    const { area, data } = memoryArea({ aipex_settings: settings });
    vi.mocked(area.set).mockImplementationOnce(async () => {
      data.apty_settings = { torn: true };
    });

    await expect(migrateLegacyStorageKeys(area)).rejects.toThrow(
      "legacy_storage_verify_failed",
    );
    expect(data.aipex_settings).toEqual(settings);
  });

  it("maps a new key back to the old one it replaced", () => {
    expect(legacyKeyFor(STORAGE_KEYS.THEME)).toBe("aipex_theme");
    expect(legacyKeyFor("apty_unrelated")).toBeUndefined();
  });
});
