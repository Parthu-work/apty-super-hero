import type { ElementSelectorReport } from "@apty/dom-snapshot";
import { describe, expect, it } from "vitest";
import {
  desEvidenceFor,
  explainElement,
  mergeDesEvidence,
} from "./element-explanation";

function report(
  overrides: Partial<ElementSelectorReport> = {},
): ElementSelectorReport {
  return {
    tagName: "button",
    classification: "interactive",
    attributes: {} as ElementSelectorReport["attributes"],
    outcome: "DIRECT_SUCCESS",
    strategy: "direct",
    bestSelector: 'button[name="save"]',
    shadowDepth: 0,
    matchCount: 1,
    ancestorDepthUsed: 0,
    usesPositionalSelector: false,
    dynamicAttributeNames: [],
    stableAttributeNames: ["name"],
    winningAttribute: "name",
    hasAccessibleName: true,
    hitTest: { pointsPassed: 9, classification: "fully-targetable" },
    stability: "DIRECT_STABLE",
    ...overrides,
  } as ElementSelectorReport;
}

describe("explainElement", () => {
  it("a direct match names the winning attribute and needs no fix", () => {
    expect(explainElement(report())).toEqual({
      howFound: "checkInitialPath: `name` alone identifies it.",
      notes: [],
      fix: null,
    });
  });

  it("an attribute combination names the combined attributes and what was left out as dynamic", () => {
    const explanation = explainElement(
      report({
        outcome: "RECOVERED_BY_IGNORE",
        winningAttribute: null,
        stableAttributeNames: ["type", "class"],
        dynamicAttributeNames: ["id"],
      }),
    );
    expect(explanation.howFound).toBe(
      "checkSimplifyDynamic: no single attribute is unique, so `type`, `class` are combined.",
    );
    expect(explanation.notes).toEqual([
      "Left out as dynamic (generated or changing values): `id`.",
    ]);
    expect(explanation.fix).toMatch(/one unique, stable attribute/);
  });

  it("context recovery says how many ancestor levels it needs", () => {
    expect(
      explainElement(
        report({ outcome: "RECOVERED_BY_CONTEXT", ancestorDepthUsed: 3 }),
      ).howFound,
    ).toBe(
      "checkContainers: its own attributes are not unique; it needs 3 ancestor level(s).",
    );
  });

  it("a positional-only element explains the sibling risk and asks for a distinguishing attribute", () => {
    const explanation = explainElement(report({ outcome: "POSITIONAL_ONLY" }));
    expect(explanation.howFound).toMatch(
      /^checkSimplifyNth: Only its position/,
    );
    expect(explanation.howFound).toMatch(
      /checkDirectElement can pick a sibling/,
    );
    expect(explanation.fix).toMatch(/attribute that tells it apart/);
  });

  it("an element behind a boundary points at the cross-origin and shadow root configuration", () => {
    expect(explainElement(report({ outcome: "INACCESSIBLE" })).fix).toBe(
      "For a cross-origin frame, add its URL to the cross-origin iframe configuration; for shadow DOM, enable shadow root support.",
    );
  });

  it("notes shadow depth, a failed or partial hit test, a broken cross-state path and a missing name", () => {
    expect(
      explainElement(
        report({
          shadowDepth: 2,
          hitTest: { pointsPassed: 0, classification: "zero-size" },
          stability: "WRONG_TARGET",
          hasAccessibleName: false,
        }),
      ).notes,
    ).toEqual([
      "Inside 2 shadow root(s): finding it needs shadow root support.",
      "Hit test: No width or height when sampled: collapsed or not laid out yet. The player can find it but not highlight or click it.",
      "Across states, the stored path landed on a different element.",
      "No accessible name: no label to anchor on or to show users in guidance.",
    ]);
    expect(
      explainElement(
        report({
          hitTest: { pointsPassed: 4, classification: "partially-targetable" },
        }),
      ).notes,
    ).toEqual([
      "Hit test: reachable at 4 of 9 sample points; something covers the rest.",
    ]);
  });
});

const SNAPSHOT = {
  selectorAnalysis: {
    directSuccess: 8,
    recoveredByIgnore: 3,
    recoveredByPartial: 0,
    recoveredByContext: 2,
    positionalOnly: 5,
    ambiguous: 0,
    wrongTarget: 0,
    notResolved: 1,
    inaccessible: 0,
  },
  hitTesting: { hidden: 4, zeroSize: 6, outsideViewport: 0, fullyOccluded: 1 },
  elementReports: [
    { dynamicAttributeNames: ["id", "class"] },
    { dynamicAttributeNames: ["id", "id"] },
    { dynamicAttributeNames: ["_ngcontent-*"] },
  ],
};

describe("desEvidenceFor", () => {
  it("counts steps in DES order, hit-test reasons most frequent first, and dynamic names per element", () => {
    const evidence = desEvidenceFor(SNAPSHOT);

    expect(evidence.steps.map((s) => [s.step, s.elements])).toEqual([
      ["checkInitialPath", 8],
      ["checkSimplifyDynamic", 3],
      ["checkContainers", 2],
      ["checkSimplifyNth", 5],
      ["Not found", 1],
    ]);
    expect(evidence.hitTestReasons.map((r) => [r.reason, r.elements])).toEqual([
      ["zero-size", 6],
      ["hidden", 4],
      ["fully-occluded", 1],
    ]);
    expect(evidence.dynamicValuesLeftOut).toEqual([
      { attribute: "id", elements: 2 },
      { attribute: "_ngcontent-*", elements: 1 },
      { attribute: "class", elements: 1 },
    ]);
  });
});

describe("mergeDesEvidence", () => {
  it("sums two pages' steps, reasons and dynamic names", () => {
    const page = desEvidenceFor(SNAPSHOT);
    const merged = mergeDesEvidence([page, page]);

    expect(
      merged.steps.find((s) => s.step === "checkSimplifyNth")?.elements,
    ).toBe(10);
    expect(merged.hitTestReasons[0]).toMatchObject({
      reason: "zero-size",
      elements: 12,
    });
    expect(merged.dynamicValuesLeftOut[0]).toEqual({
      attribute: "id",
      elements: 4,
    });
  });

  it("is empty for no pages", () => {
    expect(mergeDesEvidence([])).toEqual({
      steps: [],
      dynamicValuesLeftOut: [],
      hitTestReasons: [],
    });
  });
});
