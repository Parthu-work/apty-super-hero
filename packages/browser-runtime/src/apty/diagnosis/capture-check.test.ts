import { describe, expect, it, vi } from "vitest";
import { captureAndReload, routeOfResult } from "./capture-check";
import { diagnoseContentNotVisible } from "./content-not-visible";
import { capture, evidenceFrom } from "./diagnosis-test-utils";
import { diagnoseWidgetNotVisible } from "./widget-not-visible";

function clock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

describe("captureAndReload", () => {
  it("captures the tab, reloads it and stops once no new Apty call came for 2 s", async () => {
    const time = clock();
    const counts = [0, 0, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3];
    let tick = 0;
    const start = vi.fn(async () => ({ started: true }));
    const stop = vi.fn(async () => ({ stopped: true }));
    const reload = vi.fn(async () => {});
    const result = await captureAndReload(5, {
      ...time,
      start,
      stop,
      reload,
      count: () => counts[Math.min(tick++, counts.length - 1)] ?? 0,
    });
    expect(start).toHaveBeenCalledWith("apty-check-capture-5", 5, {
      aptyContentBodies: true,
    });
    expect(reload).toHaveBeenCalledWith(5);
    expect(stop).toHaveBeenCalledWith("apty-check-capture-5");
    expect(result).toEqual({ ok: true, calls: 3 });
    expect(time.now()).toBeGreaterThanOrEqual(2000);
    expect(time.now()).toBeLessThan(5000);
  });

  it("gives up after 20 s with what it saw, and names a capture that could not start", async () => {
    const time = clock();
    const quiet = await captureAndReload(5, {
      ...time,
      start: async () => ({ started: true }),
      stop: async () => ({ stopped: true }),
      reload: async () => {},
      count: () => 0,
    });
    expect(quiet).toEqual({ ok: true, calls: 0 });
    expect(time.now()).toBeGreaterThanOrEqual(20_000);
    expect(time.now()).toBeLessThan(21_000);

    const reload = vi.fn();
    expect(
      await captureAndReload(5, {
        ...clock(),
        start: async () => ({ started: false, error: "busy" }),
        stop: async () => ({ stopped: false }),
        reload,
        count: () => 0,
      }),
    ).toEqual({ ok: false, error: "busy" });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("routeOfResult", () => {
  it("runs the same check again: the widget, or the same item", () => {
    expect(
      routeOfResult(
        diagnoseWidgetNotVisible(evidenceFrom(capture()), "https://x.example/"),
      ),
    ).toEqual({ packId: "widget-not-visible" });
    expect(
      routeOfResult(
        diagnoseContentNotVisible(
          evidenceFrom(capture()),
          "workflow",
          "Take a tour",
          "fr",
        ),
      ),
    ).toEqual({
      packId: "content-not-visible",
      kind: "workflow",
      query: "Take a tour",
      language: "fr",
    });
  });
});
