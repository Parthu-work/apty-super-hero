import { STORAGE_KEYS } from "@apty/agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChromeStorageAdapter } from "./storage-adapter.js";

function stubLocalArea(data: Record<string, unknown>) {
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) =>
          Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys])
              .filter((key) => key in data)
              .map((key) => [key, data[key]]),
          ),
        ),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(data, items);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete data[key];
          }
        }),
      },
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("ChromeStorageAdapter.load", () => {
  it("moves a value still stored under its old AIPex name on first read", async () => {
    const data: Record<string, unknown> = { aipex_theme: "dark" };
    stubLocalArea(data);

    const theme = await new ChromeStorageAdapter<string>().load(
      STORAGE_KEYS.THEME,
    );

    expect(theme).toBe("dark");
    expect(data).toEqual({ apty_theme: "dark" });
  });

  it("returns null for a key that is stored under neither name", async () => {
    const data: Record<string, unknown> = {};
    stubLocalArea(data);

    expect(
      await new ChromeStorageAdapter().load(STORAGE_KEYS.SETTINGS),
    ).toBeNull();
    expect(data).toEqual({});
  });
});
