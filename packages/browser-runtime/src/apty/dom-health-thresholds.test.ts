import { afterEach, describe, expect, it } from "vitest";
import {
  collectorThresholdOptions,
  DOM_HEALTH_THRESHOLDS,
  resolveThresholds,
  threshold,
  thresholdReport,
  useThresholdOverrides,
} from "./dom-health-thresholds";
import {
  chooseTraversalMode,
  EMPTY_TRAVERSAL_EVIDENCE,
} from "./traversal-strategy";

afterEach(() => {
  useThresholdOverrides({});
});

describe("resolveThresholds", () => {
  it("uses every default when there are no overrides", () => {
    for (const input of [undefined, null, {}, [], "x"]) {
      const resolved = resolveThresholds(input);
      expect(resolved.active).toEqual([]);
      expect(resolved.rejected).toEqual([]);
      expect(resolved.values.sameUrlRatioForClickFirst).toBe(
        DOM_HEALTH_THRESHOLDS.sameUrlRatioForClickFirst.default,
      );
    }
  });

  it("applies an in-range override and lists it with its default", () => {
    const resolved = resolveThresholds({ sameUrlRatioForClickFirst: 0.3 });
    expect(resolved.values.sameUrlRatioForClickFirst).toBe(0.3);
    expect(resolved.active).toEqual([
      { name: "sameUrlRatioForClickFirst", value: 0.3, default: 0.5 },
    ]);
  });

  it("rejects unknown names, non-numbers and values outside the bounds, keeping the default", () => {
    const resolved = resolveThresholds({
      noSuchThreshold: 1,
      maxUnreadableFrameShare: "0.2",
      collectorTimeBudgetMs: 10,
      maxUnseenVirtualizedShare: Number.NaN,
    });
    expect(resolved.active).toEqual([]);
    expect(resolved.rejected.map((r) => [r.name, r.reason])).toEqual([
      ["noSuchThreshold", "unknown threshold"],
      ["maxUnreadableFrameShare", "not a number"],
      ["collectorTimeBudgetMs", "outside 500–60000"],
      ["maxUnseenVirtualizedShare", "not a number"],
    ]);
    expect(resolved.values.collectorTimeBudgetMs).toBe(
      DOM_HEALTH_THRESHOLDS.collectorTimeBudgetMs.default,
    );
  });

  it("does not list an override equal to the default as active", () => {
    expect(resolveThresholds({ minEdgesForSameUrlRatio: 3 }).active).toEqual(
      [],
    );
  });
});

describe("useThresholdOverrides", () => {
  it("changes the decision a threshold drives, and resets with no overrides", () => {
    const evidence = {
      ...EMPTY_TRAVERSAL_EVIDENCE,
      seedLinkTemplates: 2,
      seedNavigationCandidates: 6,
    };
    expect(chooseTraversalMode(evidence).mode).toBe("url-first");

    useThresholdOverrides({ minSeedLinksForUrlFirst: 3 });
    expect(threshold("minSeedLinksForUrlFirst")).toBe(3);
    expect(chooseTraversalMode(evidence).mode).toBe("click-first");

    useThresholdOverrides(undefined);
    expect(chooseTraversalMode(evidence).mode).toBe("url-first");
  });

  it("hands the collector budget and virtualization thresholds to the content side", () => {
    const resolved = useThresholdOverrides({
      collectorTimeBudgetMs: 9000,
      virtualizedSpacerMinPx: 800,
    });
    expect(collectorThresholdOptions(resolved)).toMatchObject({
      timeBudgetMs: 9000,
      virtualizationThresholds: { spacerMinPx: 800 },
    });
  });
});

describe("thresholdReport", () => {
  it("lists every threshold with its value, default, verification and whether it is overridden", () => {
    const report = thresholdReport(
      resolveThresholds({ maxUnreadableFrameShare: 0.25 }),
    );
    expect(report).toHaveLength(Object.keys(DOM_HEALTH_THRESHOLDS).length);
    expect(
      report.find((r) => r.name === "maxUnreadableFrameShare"),
    ).toMatchObject({ value: 0.25, default: 0.5, overridden: true });
    expect(
      report.find((r) => r.name === "minEdgesForSameUrlRatio"),
    ).toMatchObject({ unverified: false, overridden: false });
  });
});
