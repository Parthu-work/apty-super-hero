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
      stable: 0,
      changed: 0,
      detached: 0,
      new: 0,
      unknown: reports.length,
      nodeReplacedButLogicallyStable: 0,
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
    iframes: { total: 0, accessible: 0, crossOrigin: 0 },
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
