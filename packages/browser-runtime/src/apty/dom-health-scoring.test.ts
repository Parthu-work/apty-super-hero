import type {
  DomHealthSnapshot,
  ElementSelectorReport,
} from "@aipexstudio/dom-snapshot";
import { describe, expect, it } from "vitest";
import { buildDomHealthAuditResult } from "./dom-health-scoring";

function makeReport(
  overrides: Partial<ElementSelectorReport> = {},
): ElementSelectorReport {
  return {
    tagName: "button",
    classification: "interactive",
    attributes: { dataAttributes: {} },
    outcome: "DIRECT_SUCCESS",
    strategy: "direct",
    bestSelector: "#x",
    matchCount: 1,
    ancestorDepthUsed: 0,
    usesPositionalSelector: false,
    dynamicAttributeNames: [],
    stableAttributeNames: ["id"],
    hasAccessibleName: true,
    hitTest: { pointsPassed: 9, classification: "fully-targetable" },
    stability: "STABLE",
    ...overrides,
  };
}

function aggregateSelectorAnalysis(reports: ElementSelectorReport[]) {
  const agg = {
    totalAnalyzed: reports.length,
    directSuccess: 0,
    recoveredByIgnore: 0,
    recoveredByPartial: 0,
    recoveredByContext: 0,
    positionalOnly: 0,
    ambiguous: 0,
    wrongTarget: 0,
    notResolved: 0,
    inaccessible: 0,
  };
  for (const r of reports) {
    switch (r.outcome) {
      case "DIRECT_SUCCESS":
        agg.directSuccess++;
        break;
      case "RECOVERED_BY_IGNORE":
        agg.recoveredByIgnore++;
        break;
      case "RECOVERED_BY_PARTIAL":
        agg.recoveredByPartial++;
        break;
      case "RECOVERED_BY_CONTEXT":
        agg.recoveredByContext++;
        break;
      case "POSITIONAL_ONLY":
        agg.positionalOnly++;
        break;
      case "AMBIGUOUS":
        agg.ambiguous++;
        break;
      case "WRONG_TARGET":
        agg.wrongTarget++;
        break;
      case "NOT_RESOLVED":
        agg.notResolved++;
        break;
      case "INACCESSIBLE":
        agg.inaccessible++;
        break;
    }
  }
  return agg;
}

function aggregateStability(reports: ElementSelectorReport[]) {
  const tracked = reports.filter((r) => r.stability !== "UNKNOWN");
  return {
    trackedFromPrevious: tracked.length,
    stable: tracked.filter((r) => r.stability === "STABLE").length,
    unstable: tracked.filter((r) => r.stability === "UNSTABLE").length,
    detached: tracked.filter((r) => r.stability === "DETACHED").length,
    unknown: reports.filter((r) => r.stability === "UNKNOWN").length,
  };
}

function aggregateHitTesting(reports: ElementSelectorReport[]) {
  const tested = reports.filter((r) => r.hitTest);
  return {
    tested: tested.length,
    fullyTargetable: tested.filter(
      (r) => r.hitTest?.classification === "fully-targetable",
    ).length,
    partiallyTargetable: tested.filter(
      (r) => r.hitTest?.classification === "partially-targetable",
    ).length,
    mostlyOccluded: tested.filter(
      (r) => r.hitTest?.classification === "mostly-occluded",
    ).length,
    fullyOccluded: tested.filter(
      (r) => r.hitTest?.classification === "fully-occluded",
    ).length,
    zeroSize: 0,
    outsideViewport: 0,
    hidden: 0,
  };
}

function makeSnapshot(
  reports: ElementSelectorReport[],
  overrides: Partial<DomHealthSnapshot> = {},
): DomHealthSnapshot {
  return {
    collectedAt: Date.now(),
    url: "https://example.com/app",
    title: "Test App",
    counts: {
      totalElements: 100,
      interactiveElements: reports.length,
      buttons: reports.length,
      inputs: 0,
      selects: 0,
      textareas: 0,
      links: 0,
      forms: 0,
      contentEditable: 0,
    },
    elementUniverse: {
      totalElements: 100,
      meaningfulElements: 100,
      interactiveElements: reports.length,
      hiddenElements: 0,
      inaccessibleElements: 0,
      iframeElements: 0,
      shadowDomElements: 0,
    },
    elementReports: reports,
    selectorAnalysis: aggregateSelectorAnalysis(reports),
    dynamicAttributes: {
      idsObserved: 0,
      idsDynamicByHeuristic: 0,
      idsChangedAcrossSnapshots: 0,
      classesObserved: 0,
      classesDynamicByHeuristic: 0,
      classesChangedAcrossSnapshots: 0,
      hasMultiSnapshotEvidence: reports.some((r) => r.stability !== "UNKNOWN"),
    },
    stability: aggregateStability(reports),
    hitTesting: aggregateHitTesting(reports),
    ancestorTraversal: {
      contextualRecoveryCount: reports.filter((r) => r.strategy === "context")
        .length,
      deepTraversalCount: reports.filter((r) => r.ancestorDepthUsed >= 2)
        .length,
      maxAncestorDepthObserved: Math.max(
        0,
        ...reports.map((r) => r.ancestorDepthUsed),
      ),
    },
    positionalDependency: {
      positionalCount: reports.filter((r) => r.usesPositionalSelector).length,
      stableAcrossSnapshots: 0,
      unstableAcrossSnapshots: 0,
    },
    accessibility: {
      totalInteractive: reports.length,
      missingAccessibleName: reports.filter((r) => !r.hasAccessibleName).length,
    },
    iframes: { total: 0, accessible: 0, crossOrigin: 0 },
    shadowDom: { roots: 0, elements: 0 },
    zIndex: { maxZIndex: 0, highZIndexElementCount: 0 },
    ...overrides,
  };
}

describe("buildDomHealthAuditResult — determinism", () => {
  it("is deterministic — identical inputs always produce identical scores", () => {
    const snapshot = makeSnapshot([makeReport(), makeReport(), makeReport()]);
    const first = buildDomHealthAuditResult([snapshot, snapshot], "audit-a");
    const second = buildDomHealthAuditResult([snapshot, snapshot], "audit-b");

    expect(second.score).toBe(first.score);
    expect(second.metrics).toEqual(first.metrics);
    expect(second.grade).toBe(first.grade);
  });
});

describe("buildDomHealthAuditResult — the core regression: repeated non-unique attributes must not inflate the score", () => {
  it("does NOT give a high score to a DOM where every element shares the same non-unique id/class", () => {
    // Every element "has an id" and "has a class" — the old presence-based
    // scorer would have called this healthy. None of them are unique, so a
    // real selector-verification pass must fall back to positional
    // recovery for all of them, which is exactly what should suppress the
    // score.
    const reports = Array.from({ length: 30 }, () =>
      makeReport({
        outcome: "POSITIONAL_ONLY",
        strategy: "positional",
        usesPositionalSelector: true,
        ancestorDepthUsed: 2,
        bestSelector: "body > button:nth-of-type(1)",
        stability: "UNKNOWN",
      }),
    );
    const snapshot = makeSnapshot(reports);

    const result = buildDomHealthAuditResult([snapshot], "regression");

    expect(result.score).toBeLessThan(60);
    expect(["NEEDS_ATTENTION", "HIGH_RISK", "FAIR"]).toContain(result.grade);
    expect(result.manualSelectorDependency).toBeGreaterThan(50);
  });

  it("scores a genuinely well-identified DOM highly", () => {
    const reports = Array.from({ length: 30 }, (_, i) =>
      makeReport({
        bestSelector: `[data-testid="action-${i}"]`,
        stableAttributeNames: ["data-testid"],
      }),
    );
    const snapshot = makeSnapshot(reports);

    const result = buildDomHealthAuditResult([snapshot, snapshot], "good-dom");

    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(["EXCELLENT", "GOOD"]).toContain(result.grade);
  });
});

describe("buildDomHealthAuditResult — selector stability", () => {
  it("penalizes the score when previously-resolved selectors break across snapshots", () => {
    const stableReports = Array.from({ length: 20 }, () =>
      makeReport({ stability: "STABLE" }),
    );
    const unstableReports = Array.from({ length: 20 }, () =>
      makeReport({ stability: "UNSTABLE" }),
    );

    const stableResult = buildDomHealthAuditResult(
      [makeSnapshot(stableReports), makeSnapshot(stableReports)],
      "stable",
    );
    const unstableResult = buildDomHealthAuditResult(
      [makeSnapshot(unstableReports), makeSnapshot(unstableReports)],
      "unstable",
    );

    expect(unstableResult.score).toBeLessThan(stableResult.score);
    expect(unstableResult.metrics.selectorStability).toBeLessThan(
      stableResult.metrics.selectorStability,
    );
  });
});

describe("buildDomHealthAuditResult — ambiguity and wrong-target risk", () => {
  it("never treats an AMBIGUOUS or WRONG_TARGET outcome as a success", () => {
    const reports = [
      makeReport({ outcome: "AMBIGUOUS", bestSelector: null, matchCount: 4 }),
      makeReport({
        outcome: "WRONG_TARGET",
        bestSelector: null,
        matchCount: 1,
      }),
      makeReport(),
    ];
    const snapshot = makeSnapshot(reports);

    const result = buildDomHealthAuditResult([snapshot], "ambiguous");

    expect(result.metricDetails.automaticSelection.directSuccess).toBe(1);
    expect(result.metrics.ambiguityRisk).toBeLessThan(100);
  });
});

describe("buildDomHealthAuditResult — hit testing", () => {
  it("reduces the score when many elements fail hit testing despite unique selectors", () => {
    const reports = Array.from({ length: 10 }, () =>
      makeReport({
        hitTest: { pointsPassed: 0, classification: "fully-occluded" },
      }),
    );
    const snapshot = makeSnapshot(reports);

    const result = buildDomHealthAuditResult([snapshot], "occluded");

    expect(result.metrics.hitTestTargetability).toBeLessThan(50);
    // Even though every selector resolved uniquely, hit-test failure must
    // still reduce the overall score — a perfect selector on an
    // unclickable element is not healthy. hitTestTargetability carries an
    // 8% weight, so a total wipeout on it alone caps the score below 100.
    expect(result.score).toBeLessThan(95);
    expect(result.risks.map((r) => r.id)).toContain("hit-test-failures");
  });
});

describe("buildDomHealthAuditResult — DOM volatility", () => {
  it("penalizes a large relative element-count swing between snapshots", () => {
    const reports = Array.from({ length: 10 }, () => makeReport());
    const before = makeSnapshot(reports, {
      counts: { ...makeSnapshot(reports).counts, totalElements: 100 },
    });
    const after = makeSnapshot(reports, {
      counts: { ...makeSnapshot(reports).counts, totalElements: 400 },
    });

    const result = buildDomHealthAuditResult([before, after], "volatile");

    expect(result.metrics.domVolatility).toBeLessThan(70);
  });
});

describe("buildDomHealthAuditResult — confidence", () => {
  it("reports LOW confidence when nothing could be analyzed", () => {
    const snapshot = makeSnapshot([]);
    const result = buildDomHealthAuditResult([snapshot], "empty");

    expect(result.confidence).toBe("LOW");
  });

  it("reports HIGH confidence with a large, multi-snapshot, mostly-tracked sample", () => {
    const reports = Array.from({ length: 40 }, () =>
      makeReport({ stability: "STABLE" }),
    );
    const snapshot = makeSnapshot(reports);

    const result = buildDomHealthAuditResult(
      [snapshot, snapshot, snapshot],
      "confident",
    );

    expect(result.confidence).toBe("HIGH");
  });

  it("never reports HIGH confidence from a single snapshot", () => {
    const reports = Array.from({ length: 40 }, () => makeReport());
    const snapshot = makeSnapshot(reports);

    const result = buildDomHealthAuditResult([snapshot], "single-snapshot");

    expect(result.confidence).not.toBe("HIGH");
  });
});

describe("buildDomHealthAuditResult — scope and coverage are honest", () => {
  it("always reports scope 'page', never 'application', for a single-page audit", () => {
    const snapshot = makeSnapshot([makeReport()]);
    const result = buildDomHealthAuditResult([snapshot], "scope-check");

    expect(result.scope).toBe("page");
    expect(result.coverage.snapshotsCompared).toBe(1);
  });
});
