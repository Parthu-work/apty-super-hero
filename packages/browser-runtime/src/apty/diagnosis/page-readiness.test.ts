import { describe, expect, it } from "vitest";
import type { DomHealthAuditOutcome } from "../dom-health.js";
import { diagnosePageReadiness } from "./page-readiness.js";

/** The fields of a DOM Health result the pack reads, as a clean page has them. */
function audit(overrides: Record<string, unknown> = {}): DomHealthAuditOutcome {
  return {
    available: true,
    url: "https://app.example/orders?tenant=7",
    pageTitle: "Orders for Jane Doe",
    score: 91,
    grade: "EXCELLENT",
    confidence: "HIGH",
    evidenceState: "HEALTHY_EVIDENCE",
    frameAccessibility: {
      framesTotal: 1,
      framesAccessible: 1,
      framesFailed: 0,
      framesInaccessible: 0,
    },
    iframes: {
      total: 0,
      accessible: 0,
      crossOrigin: 0,
      byTag: { iframe: 0, frame: 0 },
    },
    shadowDom: { roots: 0, elements: 0 },
    zIndex: { maxZIndex: 10, highZIndexElementCount: 0 },
    duplicateIds: {
      valuesDuplicatedWithinARoot: 0,
      valuesDuplicatedPageWide: 0,
      elementsWithDuplicatedId: 0,
      sampleValues: [],
    },
    virtualized: {
      containers: 0,
      observedItems: 0,
      declaredTotal: null,
      samples: [],
    },
    manualSelectorDependency: 4,
    metadata: { interactiveElementsAnalyzed: 120 },
    risks: [],
    ...overrides,
  } as unknown as DomHealthAuditOutcome;
}

const risk = (id: string) => ({
  id,
  severity: "medium",
  title: id,
  evidence: "",
});

describe("diagnosePageReadiness", () => {
  it("names a tab with no web page, and an audit that could not run", () => {
    expect(diagnosePageReadiness(undefined).verdict).toMatchObject({
      status: "no_data",
      nextCheck: "openItemPage",
    });
    expect(
      diagnosePageReadiness({
        available: false,
        error: "This page does not allow DOM inspection.",
      }).verdict.headline,
    ).toBe("This page does not allow DOM inspection.");
    expect(
      diagnosePageReadiness(audit({ evidenceState: "FAILED" })).verdict,
    ).toMatchObject({ status: "no_data", nextCheck: "reload" });
  });

  it("finds nothing on a clean page and keeps the page's address and title out", () => {
    const result = diagnosePageReadiness(audit());

    expect(result.verdict.status).toBe("no_cause_in_data");
    expect(result.gates.map((g) => [g.id, g.status])).toEqual([
      ["data", "info"],
      ["frames", "pass"],
      ["virtualized", "pass"],
      ["overlays", "pass"],
      ["duplicate-ids", "pass"],
      ["automatic-selection", "pass"],
      ["shadow-dom", "info"],
    ]);
    expect(JSON.stringify(result)).not.toMatch(/app\.example|Jane/);
  });

  it("names each DOM Health risk with its KB card, in the card's order", () => {
    const result = diagnosePageReadiness(
      audit({
        frameAccessibility: {
          framesTotal: 3,
          framesAccessible: 2,
          framesFailed: 1,
          framesInaccessible: 0,
        },
        iframes: {
          total: 2,
          accessible: 0,
          crossOrigin: 0,
          byTag: { iframe: 2, frame: 0 },
          selectors: { analyzed: 2, positional: 1, onSrc: 0 },
        },
        shadowDom: { roots: 4, elements: 37 },
        zIndex: { maxZIndex: 2147483647, highZIndexElementCount: 2 },
        duplicateIds: {
          valuesDuplicatedWithinARoot: 1,
          valuesDuplicatedPageWide: 1,
          elementsWithDuplicatedId: 2,
          sampleValues: ["save"],
        },
        virtualized: {
          containers: 1,
          observedItems: 40,
          declaredTotal: 900,
          samples: [],
        },
        manualSelectorDependency: 35,
        risks: [
          risk("evidence-partial"),
          risk("frame-selectors"),
          risk("hit-test-failures"),
          risk("duplicate-ids"),
          risk("manual-selector-dependency"),
        ],
      }),
    );

    expect(result.verdict.status).toBe("candidates");
    expect(result.verdict.causes.map((c) => [c.ruleId, c.cardPageId])).toEqual([
      ["DOM-01", "1496973375"],
      ["DOM-07", "1496286117"],
      ["DOM-03", "1496678537"],
      ["DOM-04", "1496351596"],
      ["DOM-05", "1496580223"],
      ["DOM-06", "1496286045"],
    ]);
    expect(result.gates.find((g) => g.id === "shadow-dom")).toMatchObject({
      reason: "shadowRoots",
      params: { count: 4, elements: 37 },
    });
    expect(result.notChecked).toEqual(["canvas", "closed-shadow-roots"]);
  });
});
