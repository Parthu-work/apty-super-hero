import type { DomConfigCaptureOptions } from "@apty/browser-runtime/apty/dom-config/index";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRunDomConfigCapture = vi.hoisted(() => vi.fn());

vi.mock(
  "@apty/browser-runtime/apty/dom-config/index",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@apty/browser-runtime/apty/dom-config/index")
    >()),
    runDomConfigCapture: mockRunDomConfigCapture,
  }),
);

import { createDomConfigStore } from "./dom-config-store";
import { deferred, outcome, TAB_ID } from "./dom-config-test-fixtures";

const capturing = {
  phase: "capturing" as const,
  stateIndex: 2,
  maxStates: 20,
  urlShape: "/orders",
  runIndex: 1,
  runCount: 2,
  runLabel: "initial" as const,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDomConfigStore", () => {
  it("keeps the last page captured while the crawl moves between pages, and how long the crawl took", async () => {
    const pending = deferred<ReturnType<typeof outcome>>();
    let options: DomConfigCaptureOptions = {};
    mockRunDomConfigCapture.mockImplementation((_tabId, given) => {
      options = given;
      return pending.promise;
    });
    const store = createDomConfigStore();

    const started = store.start(TAB_ID);
    options.onProgress?.(capturing);
    options.onProgress?.({ phase: "discovering", urlShape: "/orders" });
    expect(store.getState().current?.phase).toBe("discovering");
    expect(store.getState().lastCapture).toEqual(capturing);

    vi.setSystemTime(1_000_000 + 521_000);
    pending.resolve(outcome());
    await started;

    expect(store.getState()).toMatchObject({
      phase: "report",
      lastCapture: null,
      crawlMs: 521_000,
    });
  });

  it("forgets the crawl's time when the results are cleared", async () => {
    mockRunDomConfigCapture.mockResolvedValue(outcome());
    const store = createDomConfigStore();
    await store.start(TAB_ID);
    expect(store.getState().crawlMs).toBe(0);

    store.clear();
    expect(store.getState().crawlMs).toBeNull();
  });
});
