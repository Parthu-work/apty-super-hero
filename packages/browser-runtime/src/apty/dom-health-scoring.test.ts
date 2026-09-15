import type {
  DomHealthElement,
  DomHealthSnapshot,
} from "@aipexstudio/dom-snapshot";
import { describe, expect, it } from "vitest";
import { buildDomHealthAuditResult } from "./dom-health-scoring";

function makeSnapshot(
  overrides: Partial<DomHealthSnapshot> = {},
): DomHealthSnapshot {
  return {
    collectedAt: Date.now(),
    url: "https://example.com/app",
    title: "Test App",
    counts: {
      totalElements: 100,
      interactiveElements: 10,
      buttons: 3,
      inputs: 3,
      selects: 1,
      textareas: 1,
      links: 2,
      forms: 1,
      contentEditable: 0,
    },
    interactiveElements: [],
    iframes: { total: 0, accessible: 0, crossOrigin: 0 },
    shadowDom: { roots: 0, elements: 0 },
    zIndex: { maxZIndex: 0, highZIndexElementCount: 0 },
    ...overrides,
  };
}

function stableElements(n: number): DomHealthElement[] {
  return Array.from({ length: n }, (_, i) => ({
    tagName: "button",
    attributes: { dataAttributes: { testid: `action-${i}` } },
  }));
}

function dynamicElements(n: number, seedOffset: number): DomHealthElement[] {
  return Array.from({ length: n }, (_, i) => ({
    tagName: "button",
    attributes: { id: `btn-${seedOffset + i * 7}`, dataAttributes: {} },
  }));
}

function bareElements(n: number): DomHealthElement[] {
  return Array.from({ length: n }, () => ({
    tagName: "div",
    attributes: { dataAttributes: {} },
  }));
}

describe("buildDomHealthAuditResult — classification", () => {
  it("classifies each attribute-signal tier correctly and averages them", () => {
    const elements: DomHealthElement[] = [
      { tagName: "button", attributes: { dataAttributes: { testid: "save" } } }, // strong
      {
        tagName: "button",
        attributes: { className: "save-btn", dataAttributes: {} },
      }, // medium
      {
        tagName: "button",
        attributes: { className: "css-1x93k2", dataAttributes: {} },
      }, // risky (dynamic-looking class)
      { tagName: "button", attributes: { dataAttributes: {} } }, // very-risky (no signal)
    ];
    const snapshot = makeSnapshot({ interactiveElements: elements });
    const result = buildDomHealthAuditResult(snapshot, snapshot, "audit-1");

    expect(result.metricDetails.selectorQuality).toEqual({
      totalAnalyzed: 4,
      strongCount: 1,
      mediumCount: 1,
      riskyCount: 1,
      veryRiskyCount: 1,
    });
    // (100 + 70 + 35 + 0) / 4 = 51.25 -> rounds to 51
    expect(result.metrics.selectorQuality).toBe(51);
  });

  it("is deterministic — identical inputs always produce identical scores", () => {
    const elements = stableElements(5);
    const snapshot = makeSnapshot({ interactiveElements: elements });
    const first = buildDomHealthAuditResult(snapshot, snapshot, "audit-a");
    const second = buildDomHealthAuditResult(snapshot, snapshot, "audit-b");

    expect(second.score).toBe(first.score);
    expect(second.metrics).toEqual(first.metrics);
    expect(second.grade).toBe(first.grade);
  });
});

describe("buildDomHealthAuditResult — product spec scenarios", () => {
  it("Scenario A: stable ids/data attributes, no mutation, no iframes -> high score", () => {
    const elements = stableElements(20);
    const snapshot = makeSnapshot({
      counts: {
        ...makeSnapshot().counts,
        totalElements: 300,
        interactiveElements: 20,
      },
      interactiveElements: elements,
    });

    const result = buildDomHealthAuditResult(snapshot, snapshot, "scenario-a");

    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(["EXCELLENT", "GOOD"]).toContain(result.grade);
    expect(result.risks).toHaveLength(0);
  });

  it("Scenario B: dynamic ids/classes with high DOM churn -> lower score than Scenario A", () => {
    const before = makeSnapshot({
      counts: {
        ...makeSnapshot().counts,
        totalElements: 100,
        interactiveElements: 20,
      },
      interactiveElements: dynamicElements(20, 100000),
    });
    const after = makeSnapshot({
      counts: {
        ...makeSnapshot().counts,
        totalElements: 150,
        interactiveElements: 20,
      },
      interactiveElements: dynamicElements(20, 900000),
    });

    const scenarioA = buildDomHealthAuditResult(
      makeSnapshot({ interactiveElements: stableElements(20) }),
      makeSnapshot({ interactiveElements: stableElements(20) }),
      "scenario-a-ref",
    );
    const result = buildDomHealthAuditResult(before, after, "scenario-b");

    expect(result.score).toBeLessThan(scenarioA.score);
    expect(result.metrics.selectorQuality).toBeLessThan(60);
    expect(result.metrics.selectorStability).toBeLessThan(70);
    expect(result.risks.map((r) => r.id)).toEqual(
      expect.arrayContaining(["generated-selectors", "selector-volatility"]),
    );
    expect(result.recommendations.map((r) => r.id)).toContain(
      "attribute-priority",
    );
  });

  it("Scenario C: large enterprise DOM with mostly stable selectors and several iframes/shadow roots -> NOT penalized just for size", () => {
    const snapshot = makeSnapshot({
      counts: {
        totalElements: 20000,
        interactiveElements: 40,
        buttons: 10,
        inputs: 10,
        selects: 5,
        textareas: 5,
        links: 8,
        forms: 2,
        contentEditable: 0,
      },
      interactiveElements: stableElements(40),
      iframes: { total: 3, accessible: 3, crossOrigin: 0 },
      shadowDom: { roots: 2, elements: 500 },
    });

    const result = buildDomHealthAuditResult(snapshot, snapshot, "scenario-c");

    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.metricDetails.domComplexity.totalElements).toBe(20000);
  });

  it("Scenario D: weak selectors, cross-origin frames, high volatility -> lower readiness score", () => {
    const before = makeSnapshot({
      counts: {
        ...makeSnapshot().counts,
        totalElements: 100,
        interactiveElements: 15,
      },
      interactiveElements: bareElements(15),
      iframes: { total: 2, accessible: 0, crossOrigin: 2 },
    });
    const after = makeSnapshot({
      counts: {
        ...makeSnapshot().counts,
        totalElements: 140,
        interactiveElements: 15,
      },
      interactiveElements: bareElements(15),
      iframes: { total: 2, accessible: 0, crossOrigin: 2 },
    });

    const result = buildDomHealthAuditResult(before, after, "scenario-d");
    const scenarioA = buildDomHealthAuditResult(
      makeSnapshot({ interactiveElements: stableElements(20) }),
      makeSnapshot({ interactiveElements: stableElements(20) }),
      "scenario-a-ref-2",
    );

    expect(result.score).toBeLessThan(scenarioA.score);
    expect(["NEEDS_ATTENTION", "HIGH_RISK", "FAIR"]).toContain(result.grade);
    expect(result.metricDetails.selectorQuality.veryRiskyCount).toBe(15);
  });
});

describe("buildDomHealthAuditResult — iframe/shadow-DOM boundary handling", () => {
  it("does not treat cross-origin iframes as a full-penalty defect", () => {
    const withCrossOrigin = makeSnapshot({
      interactiveElements: stableElements(10),
      iframes: { total: 2, accessible: 0, crossOrigin: 2 },
    });
    const withNoIframes = makeSnapshot({
      interactiveElements: stableElements(10),
    });

    const resultCrossOrigin = buildDomHealthAuditResult(
      withCrossOrigin,
      withCrossOrigin,
      "x",
    );
    const resultNoIframes = buildDomHealthAuditResult(
      withNoIframes,
      withNoIframes,
      "y",
    );

    // Some reduction is expected (iframeAccessibility metric), but it must
    // stay small relative to the overall score given the metric's 5% weight.
    expect(resultNoIframes.score - resultCrossOrigin.score).toBeLessThanOrEqual(
      5,
    );
    expect(
      resultCrossOrigin.risks.find((r) => r.id === "cross-origin-iframes")
        ?.severity,
    ).toBe("low");
  });

  it("caps the Shadow DOM penalty so heavy Shadow DOM use alone cannot crater the score", () => {
    const snapshot = makeSnapshot({
      interactiveElements: stableElements(10),
      counts: { ...makeSnapshot().counts, totalElements: 100 },
      shadowDom: { roots: 5, elements: 90 },
    });

    const result = buildDomHealthAuditResult(
      snapshot,
      snapshot,
      "shadow-heavy",
    );

    expect(result.metrics.shadowDomAccessibility).toBeGreaterThanOrEqual(70);
  });
});

describe("buildDomHealthAuditResult — overlay/z-index interpretation", () => {
  it("does not penalize a single high z-index element", () => {
    const snapshot = makeSnapshot({
      interactiveElements: stableElements(10),
      zIndex: { maxZIndex: 999999, highZIndexElementCount: 1 },
    });

    const result = buildDomHealthAuditResult(snapshot, snapshot, "one-overlay");

    expect(result.metrics.overlayRisk).toBeGreaterThanOrEqual(80);
  });

  it("reduces (but never zeroes) the score when many elements compete at high z-index", () => {
    const snapshot = makeSnapshot({
      interactiveElements: stableElements(10),
      zIndex: { maxZIndex: 5000, highZIndexElementCount: 10 },
    });

    const result = buildDomHealthAuditResult(
      snapshot,
      snapshot,
      "many-overlays",
    );

    expect(result.metrics.overlayRisk).toBeLessThan(100);
    expect(result.metrics.overlayRisk).toBeGreaterThanOrEqual(50);
  });
});
