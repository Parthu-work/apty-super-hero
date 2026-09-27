import type {
  DomHealthSnapshot,
  ElementSelectorReport,
} from "@apty/dom-snapshot";
import { describe, expect, it } from "vitest";
import {
  buildApplicationAuditResult,
  type PageAuditRecord,
} from "./application-scoring";
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
    winningAttribute: "id",
    hasAccessibleName: true,
    hitTest: { pointsPassed: 9, classification: "fully-targetable" },
    stability: "DIRECT_STABLE",
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
      case "POSITIONAL_ONLY":
        agg.positionalOnly++;
        break;
      default:
        break;
    }
  }
  return agg;
}

function makeSnapshot(reports: ElementSelectorReport[]): DomHealthSnapshot {
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
    analysisCoverage: {
      candidatesFound: reports.length,
      candidatesAnalyzed: reports.length,
      capped: false,
      capReason: null,
    },
    selectorAnalysis: aggregateSelectorAnalysis(reports),
    dynamicAttributes: {
      idsObserved: 0,
      idsDynamicByHeuristic: 0,
      idsChangedAcrossSnapshots: 0,
      classesObserved: 0,
      classesDynamicByHeuristic: 0,
      classesChangedAcrossSnapshots: 0,
      hasMultiSnapshotEvidence: false,
    },
    stability: {
      trackedFromPrevious: 0,
      directStable: 0,
      recoveredStable: 0,
      positionalStable: 0,
      wrongTarget: 0,
      notResolved: 0,
      detached: 0,
      new: 0,
      unknown: reports.length,
      nodeReplacedButLogicallyStable: 0,
      ambiguous: 0,
      inaccessible: 0,
    },
    hitTesting: {
      tested: reports.length,
      fullyTargetable: reports.length,
      partiallyTargetable: 0,
      mostlyOccluded: 0,
      fullyOccluded: 0,
      zeroSize: 0,
      outsideViewport: 0,
      hidden: 0,
    },
    ancestorTraversal: {
      contextualRecoveryCount: 0,
      deepTraversalCount: 0,
      maxAncestorDepthObserved: 0,
    },
    positionalDependency: {
      positionalCount: reports.filter((r) => r.usesPositionalSelector).length,
      stableAcrossSnapshots: 0,
      changedAcrossSnapshots: 0,
    },
    accessibility: {
      totalInteractive: reports.length,
      missingAccessibleName: 0,
    },
    iframes: {
      total: 0,
      accessible: 0,
      crossOrigin: 0,
      byTag: { iframe: 0, frame: 0 },
    },
    shadowDom: { roots: 0, elements: 0 },
    zIndex: { maxZIndex: 0, highZIndexElementCount: 0 },
  };
}

function completedPage(
  url: string,
  reports: ElementSelectorReport[],
): PageAuditRecord {
  const snapshot = makeSnapshot(reports);
  return {
    url,
    title: url,
    discoverySource: "seed",
    status: "completed",
    result: buildDomHealthAuditResult([snapshot], `audit-${url}`),
  };
}

/** Like `completedPage`, but with an explicit cross-state stability aggregate — for calibration tests that need to prove same-DOM resolution and cross-state stability are scored independently. */
function completedPageWithStability(
  url: string,
  reports: ElementSelectorReport[],
  stability: DomHealthSnapshot["stability"],
): PageAuditRecord {
  const snapshot = { ...makeSnapshot(reports), stability };
  return {
    url,
    title: url,
    discoverySource: "seed",
    status: "completed",
    result: buildDomHealthAuditResult([snapshot], `audit-${url}`),
  };
}

describe("buildApplicationAuditResult — scope honesty", () => {
  it("never reports scope 'application' from a single audited page", () => {
    const pages: PageAuditRecord[] = [
      completedPage("https://a.example/page1", [makeReport()]),
    ];

    const result = buildApplicationAuditResult(pages, "app-1");

    expect(result.scope).toBe("page");
  });

  it("reports scope 'application' once two or more pages are actually audited", () => {
    const pages: PageAuditRecord[] = [
      completedPage("https://a.example/page1", [makeReport()]),
      completedPage("https://a.example/page2", [makeReport()]),
    ];

    const result = buildApplicationAuditResult(pages, "app-2");

    expect(result.scope).toBe("application");
  });
});

describe("buildApplicationAuditResult — element-weighted aggregation, not a page average", () => {
  it("does not let one excellent page hide a catastrophic one", () => {
    const excellentReports = Array.from({ length: 90 }, () => makeReport());
    const catastrophicReports = Array.from({ length: 10 }, () =>
      makeReport({
        outcome: "NOT_RESOLVED",
        strategy: "none",
        bestSelector: null,
        matchCount: 0,
      }),
    );
    const pages: PageAuditRecord[] = [
      completedPage("https://a.example/excellent", excellentReports),
      completedPage("https://a.example/bad", catastrophicReports),
    ];

    const result = buildApplicationAuditResult(pages, "app-3");

    // Element-weighted: 90 successes + 10 failures out of 100 total, not a
    // 50/50 average of the two pages' own (very different) scores.
    expect(result.metrics.automaticSelection).toBe(90);
  });
});

describe("buildApplicationAuditResult — incomplete coverage is reported, never hidden", () => {
  it("surfaces a coverage risk when some discovered pages failed or were skipped", () => {
    const pages: PageAuditRecord[] = [
      completedPage("https://a.example/page1", [makeReport()]),
      completedPage("https://a.example/page2", [makeReport()]),
      {
        url: "https://a.example/page3",
        title: null,
        discoverySource: "same-origin-link",
        status: "failed",
        failureReason: "Navigation timed out",
      },
      {
        url: "https://a.example/logout",
        title: null,
        discoverySource: "same-origin-link",
        status: "skipped-unsafe",
      },
    ];

    const result = buildApplicationAuditResult(pages, "app-4");

    expect(result.coverage.pagesDiscovered).toBe(4);
    expect(result.coverage.pagesAudited).toBe(2);
    expect(result.coverage.pagesFailed).toBe(1);
    expect(result.coverage.pagesSkippedUnsafe).toBe(1);
    expect(result.coverage.coveragePercent).toBe(50);
    expect(
      result.risks.some((r) => r.id === "incomplete-application-coverage"),
    ).toBe(true);
  });

  it("reports zero coverage and a LOW confidence, never a fabricated score, when nothing could be audited", () => {
    const pages: PageAuditRecord[] = [
      {
        url: "https://a.example/",
        title: null,
        discoverySource: "seed",
        status: "failed",
        failureReason: "Tab navigation failed",
      },
    ];

    const result = buildApplicationAuditResult(pages, "app-5");

    expect(result.coverage.pagesAudited).toBe(0);
    expect(result.confidence).toBe("LOW");
    expect(result.summary).toContain("No pages could be audited");
  });
});

describe("buildApplicationAuditResult — confidence requires real multi-page coverage", () => {
  it("requires several audited pages and good coverage for HIGH confidence", () => {
    const manyReports = Array.from({ length: 20 }, () => makeReport());
    const pages: PageAuditRecord[] = [
      completedPage("https://a.example/1", manyReports),
      completedPage("https://a.example/2", manyReports),
    ];

    const result = buildApplicationAuditResult(pages, "app-6");

    expect(result.confidence).not.toBe("HIGH");
  });
});

describe("buildApplicationAuditResult — evidence state, never a fabricated application score", () => {
  it("reports NO_EVIDENCE and a null score when every audited page genuinely had zero interactive elements", () => {
    const pages: PageAuditRecord[] = [
      completedPage("https://a.example/shell", []),
    ];

    const result = buildApplicationAuditResult(pages, "app-7");

    expect(result.evidenceState).toBe("NO_EVIDENCE");
    expect(result.score).toBeNull();
    expect(result.grade).toBe("NOT_ASSESSED");
  });

  it("reports INACCESSIBLE when zero elements were found and a frame across the audited pages could not be inspected", () => {
    const page = completedPage("https://a.example/shell", []);
    page.frameAccessibility = {
      framesTotal: 3,
      framesAccessible: 2,
      framesFailed: 1,
      framesInaccessible: 0,
    };

    const result = buildApplicationAuditResult([page], "app-8");

    expect(result.evidenceState).toBe("INACCESSIBLE");
    expect(result.score).toBeNull();
    expect(result.risks.some((r) => r.id === "evidence-inaccessible")).toBe(
      true,
    );
  });

  it("reports OBSERVED_COVERAGE, never a claim of total application coverage", () => {
    const pages: PageAuditRecord[] = [
      completedPage("https://a.example/1", [makeReport()]),
    ];

    const result = buildApplicationAuditResult(pages, "app-9");

    expect(result.coverage.coverageLabel).toBe("OBSERVED_COVERAGE");
  });

  it("reports pagesNotDiscovered explicitly, never silently folded into pagesDiscovered", () => {
    const pages: PageAuditRecord[] = [
      completedPage("https://a.example/1", [makeReport()]),
      {
        url: "https://a.example/1#menu:orders",
        title: null,
        discoverySource: "safe-navigation-control",
        status: "not-discovered",
      },
    ];

    const result = buildApplicationAuditResult(pages, "app-10");

    expect(result.coverage.pagesNotDiscovered).toBe(1);
    expect(
      result.risks.some((r) => r.id === "navigation-candidates-not-explored"),
    ).toBe(true);
  });
});

describe("buildApplicationAuditResult — score calibration (spec section 36)", () => {
  it("Case C: high same-DOM selector resolution + terrible cross-state stability must NOT score excellent", () => {
    // Every element resolves perfectly against the CURRENT DOM (the exact
    // "92/100 on an application that was never comprehensively explored"
    // shape this whole task exists to fix) — but replaying those same
    // captured paths against other real states mostly failed or landed on
    // the wrong element. A high automaticSelection score must never be
    // allowed to launder that away.
    const reports = Array.from({ length: 50 }, () => makeReport());
    const page = completedPageWithStability("https://a.example/app", reports, {
      trackedFromPrevious: 50,
      directStable: 2,
      recoveredStable: 0,
      positionalStable: 0,
      wrongTarget: 40,
      notResolved: 8,
      detached: 0,
      new: 0,
      unknown: 0,
      nodeReplacedButLogicallyStable: 0,
      ambiguous: 0,
      inaccessible: 0,
    });

    const result = buildApplicationAuditResult([page], "case-c");

    expect(result.metrics.automaticSelection).toBe(100);
    expect(result.metrics.selectorStability).toBeLessThan(20);
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeLessThan(80);
    expect(["FAIR", "NEEDS_ATTENTION", "HIGH_RISK"]).toContain(result.grade);
  });

  it("Case D: incomplete discovery (a failed backtracking restoration) must not show a clean high score", () => {
    const reports = Array.from({ length: 30 }, () => makeReport());
    const pages: PageAuditRecord[] = [
      completedPage("https://a.example/a", reports),
      completedPage("https://a.example/b", reports),
    ];

    const result = buildApplicationAuditResult(pages, "case-d", {
      restorations: [
        { targetStateId: "state-0", success: true, stepCount: 1 },
        {
          targetStateId: "state-1",
          success: false,
          stepCount: 2,
          failedAtStep: 1,
          reason: "Replay diverged from the originally-recorded state.",
        },
      ],
    });

    expect(result.evidenceState).toBe("INCOMPLETE_EVIDENCE");
    expect(result.score).toBeNull();
    expect(result.grade).toBe("NOT_ASSESSED");
    expect(
      result.risks.some(
        (r) => r.id === "evidence-incomplete-application-coverage",
      ),
    ).toBe(true);
  });

  it("gates the score to INCOMPLETE_EVIDENCE when real navigation candidates were found but this run never got beyond the seed state", () => {
    const pages: PageAuditRecord[] = [
      completedPage("https://a.example/home", [makeReport()]),
      {
        url: "https://a.example/home#control:menu-2",
        title: "Menu 2",
        discoverySource: "safe-navigation-control",
        status: "not-discovered",
        failureReason: "Click-based discovery is off by default.",
      },
    ];

    const result = buildApplicationAuditResult(pages, "case-single-state");

    expect(result.evidenceState).toBe("INCOMPLETE_EVIDENCE");
    expect(result.score).toBeNull();
  });

  it("does not gate a well-covered multi-state audit just because a couple of incidental candidates were left unexplored", () => {
    const reports = Array.from({ length: 20 }, () => makeReport());
    const pages: PageAuditRecord[] = [
      completedPage("https://a.example/a", reports),
      completedPage("https://a.example/b", reports),
      completedPage("https://a.example/c", reports),
      {
        url: "https://a.example/c#control:stray-menu",
        title: "Stray",
        discoverySource: "safe-navigation-control",
        status: "not-discovered",
      },
    ];

    const result = buildApplicationAuditResult(pages, "case-well-covered");

    expect(result.evidenceState).not.toBe("INCOMPLETE_EVIDENCE");
    expect(result.score).not.toBeNull();
  });
});

describe("buildApplicationAuditResult — cross-application-state selector replay (spec section 7)", () => {
  it("folds cross-state replay evidence into the same selectorStability totals as same-state stability, never a side channel the score can ignore", () => {
    const reports = Array.from({ length: 20 }, () => makeReport());
    const pages: PageAuditRecord[] = [
      completedPage("https://a.example/a", reports),
      completedPage("https://a.example/b", reports),
    ];

    const withoutCrossState = buildApplicationAuditResult(
      pages,
      "no-cross-state",
    );
    const withBrokenCrossState = buildApplicationAuditResult(
      pages,
      "broken-cross-state",
      {
        crossStateEvidence: {
          attempted: 20,
          directStable: 0,
          recoveredStable: 0,
          positionalStable: 0,
          wrongTarget: 15,
          notResolved: 5,
          statesTested: 1,
        },
      },
    );

    expect(withBrokenCrossState.metrics.selectorStability).toBeLessThan(
      withoutCrossState.metrics.selectorStability,
    );
    expect(withBrokenCrossState.crossStateEvidence.attempted).toBe(20);
    expect(withBrokenCrossState.crossStateEvidence.wrongTarget).toBe(15);
  });

  it("reports scopeLabel/selectorConfiguration honestly", () => {
    const pages: PageAuditRecord[] = [
      completedPage("https://a.example/a", [makeReport()]),
      completedPage("https://a.example/b", [makeReport()]),
    ];

    const result = buildApplicationAuditResult(pages, "labels");

    expect(result.scopeLabel).toBe("APPLICATION");
    expect(result.selectorConfiguration.source).toBe("default");
  });
});
