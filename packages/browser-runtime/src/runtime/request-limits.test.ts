import { STORAGE_KEYS } from "@apty/agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  listeners: [] as Array<
    (changes: Record<string, { newValue?: unknown }>, area: string) => void
  >,
}));

(globalThis as { chrome?: unknown }).chrome = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storage.value })),
    },
    onChanged: {
      addListener: vi.fn((fn) => storage.listeners.push(fn)),
    },
  },
};

import {
  currentSummaryWatermark,
  getRequestLimits,
  limitsFromSettings,
  resetRequestLimitsForTests,
  summaryWatermarkFor,
} from "./request-limits";

beforeEach(() => {
  storage.value = {};
  storage.listeners.length = 0;
  resetRequestLimitsForTests();
});

describe("limitsFromSettings", () => {
  it("keeps whole numbers inside the accepted ranges, and nothing else", () => {
    expect(
      limitsFromSettings({ requestTokenBudget: 6_000, maxOutputTokens: 1_024 }),
    ).toEqual({ requestTokenBudget: 6_000, maxOutputTokens: 1_024 });
    expect(
      limitsFromSettings({ requestTokenBudget: 1_999, maxOutputTokens: 255 }),
    ).toEqual({});
    expect(
      limitsFromSettings({
        requestTokenBudget: 6_000.5,
        maxOutputTokens: "512",
      }),
    ).toEqual({});
    expect(limitsFromSettings(undefined)).toEqual({});
  });
});

describe("getRequestLimits", () => {
  it("reads the stored settings once, then follows changes", async () => {
    storage.value = { requestTokenBudget: 6_000 };

    expect(await getRequestLimits()).toEqual({ requestTokenBudget: 6_000 });

    for (const listener of storage.listeners) {
      listener(
        {
          [STORAGE_KEYS.SETTINGS]: {
            newValue: { requestTokenBudget: 9_000, maxOutputTokens: 800 },
          },
        },
        "local",
      );
    }
    expect(await getRequestLimits()).toEqual({
      requestTokenBudget: 9_000,
      maxOutputTokens: 800,
    });
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
  });
});

describe("summaries of earlier turns", () => {
  it("are on only when the setting is true", () => {
    expect(limitsFromSettings({ summarizeEarlierTurns: true })).toEqual({
      summarizeEarlierTurns: true,
    });
    expect(limitsFromSettings({ summarizeEarlierTurns: "yes" })).toEqual({});
    expect(limitsFromSettings({ summarizeEarlierTurns: false })).toEqual({});
  });

  it("start at three quarters of the request budget, or 20,000 tokens without one, and never while off", () => {
    expect(summaryWatermarkFor({})).toBeUndefined();
    expect(summaryWatermarkFor({ requestTokenBudget: 8_000 })).toBeUndefined();
    expect(summaryWatermarkFor({ summarizeEarlierTurns: true })).toBe(20_000);
    expect(
      summaryWatermarkFor({
        summarizeEarlierTurns: true,
        requestTokenBudget: 8_000,
      }),
    ).toBe(6_000);
  });

  it("follow the setting once the limits are read, with no read of their own", async () => {
    storage.value = { summarizeEarlierTurns: true };
    const reads = vi.mocked(chrome.storage.local.get).mock.calls.length;

    expect(currentSummaryWatermark()).toBeUndefined();
    await getRequestLimits();
    expect(currentSummaryWatermark()).toBe(20_000);

    for (const listener of storage.listeners) {
      listener(
        {
          [STORAGE_KEYS.SETTINGS]: {
            newValue: { summarizeEarlierTurns: false },
          },
        },
        "local",
      );
    }
    expect(currentSummaryWatermark()).toBeUndefined();
    expect(vi.mocked(chrome.storage.local.get).mock.calls.length).toBe(
      reads + 1,
    );
  });
});
