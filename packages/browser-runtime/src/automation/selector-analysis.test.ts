import { describe, expect, it } from "vitest";
import {
  type ElementDescriptor,
  formatSelectorReport,
  generateSelectorCandidates,
  type LiveSelectorResult,
  looksDynamic,
  rankSelectorCandidates,
} from "./selector-analysis";

describe("looksDynamic", () => {
  it("flags purely numeric values (auto-incrementing ids)", () => {
    expect(looksDynamic("382910")).toBe(true);
  });

  it("flags UUID-like values", () => {
    expect(looksDynamic("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
  });

  it("flags a numeric/hash suffix on an otherwise readable name", () => {
    expect(looksDynamic("input-928731")).toBe(true);
    expect(looksDynamic("btn-4f9a21ab")).toBe(true);
  });

  it("flags known CSS-in-JS/framework-generated prefixes", () => {
    expect(looksDynamic("css-1x2y3z")).toBe(true);
    expect(looksDynamic("sc-bdVaJa")).toBe(true);
    expect(looksDynamic("jss42")).toBe(true);
  });

  it("does not flag stable, intentionally-authored names", () => {
    expect(looksDynamic("patient-name")).toBe(false);
    expect(looksDynamic("submit-button")).toBe(false);
    expect(looksDynamic("nav-menu")).toBe(false);
  });

  it("does not flag an empty value", () => {
    expect(looksDynamic("")).toBe(false);
  });
});

describe("generateSelectorCandidates", () => {
  it("generates a data-apty-* candidate as the highest priority when present", () => {
    const descriptor: ElementDescriptor = {
      tagName: "INPUT",
      classes: [],
      attributes: { "data-apty-id": "patient-name" },
    };

    const candidates = generateSelectorCandidates(descriptor);

    expect(candidates[0]?.type).toBe("data-apty");
    expect(candidates[0]?.selector).toBe('[data-apty-id="patient-name"]');
    expect(candidates[0]?.staticRisk).toBe("low");
  });

  it("flags a dynamic-looking id as high risk", () => {
    const descriptor: ElementDescriptor = {
      tagName: "INPUT",
      id: "input-928731",
      classes: [],
      attributes: { id: "input-928731" },
    };

    const candidates = generateSelectorCandidates(descriptor);
    const idCandidate = candidates.find((c) => c.type === "id");

    expect(idCandidate?.staticRisk).toBe("high");
    expect(idCandidate?.reasons.join(" ")).toMatch(/dynamically generated/i);
  });

  it("treats a stable id as low risk", () => {
    const descriptor: ElementDescriptor = {
      tagName: "INPUT",
      id: "patient-name",
      classes: [],
      attributes: { id: "patient-name" },
    };

    const candidates = generateSelectorCandidates(descriptor);
    const idCandidate = candidates.find((c) => c.type === "id");

    expect(idCandidate?.staticRisk).toBe("low");
  });

  it("excludes dynamic-looking classes from the class candidate but keeps stable ones", () => {
    const descriptor: ElementDescriptor = {
      tagName: "DIV",
      classes: ["css-1x2y3z", "stable-widget"],
      attributes: {},
    };

    const candidates = generateSelectorCandidates(descriptor);
    const classCandidate = candidates.find((c) => c.type === "class");

    expect(classCandidate?.selector).toBe("div.stable-widget");
    expect(classCandidate?.reasons.join(" ")).toMatch(/1 dynamic-looking/i);
  });

  it("marks the class candidate high-risk when every class is dynamic-looking", () => {
    const descriptor: ElementDescriptor = {
      tagName: "DIV",
      classes: ["css-1x2y3z", "sc-bdVaJa"],
      attributes: {},
    };

    const candidates = generateSelectorCandidates(descriptor);
    const classCandidate = candidates.find((c) => c.type === "class");

    expect(classCandidate?.staticRisk).toBe("high");
  });

  it("generates an aria-label candidate", () => {
    const descriptor: ElementDescriptor = {
      tagName: "BUTTON",
      classes: [],
      attributes: { "aria-label": "Submit form" },
    };

    const candidates = generateSelectorCandidates(descriptor);
    const ariaCandidate = candidates.find((c) => c.type === "aria");

    expect(ariaCandidate?.selector).toBe('[aria-label="Submit form"]');
  });

  it("generates a text-based XPath candidate for short text content", () => {
    const descriptor: ElementDescriptor = {
      tagName: "BUTTON",
      classes: [],
      attributes: {},
      textContent: "Save changes",
    };

    const candidates = generateSelectorCandidates(descriptor);
    const textCandidate = candidates.find((c) => c.type === "text");

    expect(textCandidate?.selector).toContain("Save changes");
  });

  it("does not generate a text candidate for very long text content", () => {
    const descriptor: ElementDescriptor = {
      tagName: "P",
      classes: [],
      attributes: {},
      textContent: "x".repeat(200),
    };

    const candidates = generateSelectorCandidates(descriptor);

    expect(candidates.some((c) => c.type === "text")).toBe(false);
  });

  it("generates a structural path candidate from ancestors as a last resort", () => {
    const descriptor: ElementDescriptor = {
      tagName: "SPAN",
      classes: [],
      attributes: {},
      ancestors: [
        { tagName: "DIV", classes: [], attributes: {} },
        { tagName: "FORM", classes: [], attributes: {} },
      ],
    };

    const candidates = generateSelectorCandidates(descriptor);
    const structural = candidates.find((c) => c.type === "structural");

    expect(structural?.selector).toBe("form > div > span");
    expect(structural?.staticRisk).toBe("high");
  });

  it("adds an iframe context note to every candidate when the element is inside an iframe", () => {
    const descriptor: ElementDescriptor = {
      tagName: "INPUT",
      id: "patient-name",
      classes: [],
      attributes: { id: "patient-name" },
      inIframe: true,
    };

    const candidates = generateSelectorCandidates(descriptor);

    expect(
      candidates.every((c) => c.reasons.some((r) => /iframe/i.test(r))),
    ).toBe(true);
  });

  it("adds a Shadow DOM context note to every candidate when the element is inside a shadow root", () => {
    const descriptor: ElementDescriptor = {
      tagName: "INPUT",
      id: "patient-name",
      classes: [],
      attributes: { id: "patient-name" },
      inShadowDom: true,
    };

    const candidates = generateSelectorCandidates(descriptor);

    expect(
      candidates.every((c) => c.reasons.some((r) => /shadow/i.test(r))),
    ).toBe(true);
  });
});

describe("rankSelectorCandidates", () => {
  function withLive(
    map: Record<string, LiveSelectorResult>,
  ): Map<string, LiveSelectorResult> {
    return new Map(Object.entries(map));
  }

  it("recommends a low-risk candidate that uniquely matches the target live", () => {
    const candidates = generateSelectorCandidates({
      tagName: "INPUT",
      classes: [],
      attributes: { "data-apty-id": "patient-name" },
    });

    const ranked = rankSelectorCandidates(
      candidates,
      withLive({
        '[data-apty-id="patient-name"]': { matchCount: 1, matchesTarget: true },
      }),
    );

    expect(ranked[0]?.verdict).toBe("recommended");
    expect(ranked[0]?.verdictReason).toMatch(/unique and not dynamic/i);
  });

  it("marks a candidate broken when it matches zero elements live", () => {
    const candidates = generateSelectorCandidates({
      tagName: "INPUT",
      id: "stale-id",
      classes: [],
      attributes: { id: "stale-id" },
    });

    const ranked = rankSelectorCandidates(
      candidates,
      withLive({ "#stale-id": { matchCount: 0, matchesTarget: false } }),
    );

    const idResult = ranked.find((r) => r.type === "id");
    expect(idResult?.verdict).toBe("broken");
  });

  it("marks a candidate risky (ambiguous) when it matches more than one element live — the spec's .MuiInputBase-input example", () => {
    const candidates = generateSelectorCandidates({
      tagName: "INPUT",
      classes: ["MuiInputBase-input"],
      attributes: {},
    });

    const ranked = rankSelectorCandidates(
      candidates,
      withLive({
        "input.MuiInputBase-input": { matchCount: 8, matchesTarget: true },
      }),
    );

    const classResult = ranked.find((r) => r.type === "class");
    expect(classResult?.verdict).toBe("risky");
    expect(classResult?.verdictReason).toMatch(
      /matches 8 elements, not unique/i,
    );
  });

  it("marks a candidate broken when it matches other elements but not the target", () => {
    const candidates = generateSelectorCandidates({
      tagName: "DIV",
      classes: ["widget"],
      attributes: {},
    });

    const ranked = rankSelectorCandidates(
      candidates,
      withLive({ "div.widget": { matchCount: 3, matchesTarget: false } }),
    );

    expect(ranked[0]?.verdict).toBe("broken");
  });

  it("treats an invalid/errored selector (negative match count) as broken", () => {
    const candidates = generateSelectorCandidates({
      tagName: "DIV",
      classes: ["widget"],
      attributes: {},
    });

    const ranked = rankSelectorCandidates(
      candidates,
      withLive({ "div.widget": { matchCount: -1, matchesTarget: false } }),
    );

    expect(ranked[0]?.verdict).toBe("broken");
  });

  it("marks a dynamic-looking id as risky even if it's currently unique, since it may break on redeploy", () => {
    const candidates = generateSelectorCandidates({
      tagName: "INPUT",
      id: "input-928731",
      classes: [],
      attributes: { id: "input-928731" },
    });

    const ranked = rankSelectorCandidates(
      candidates,
      withLive({ "#input-928731": { matchCount: 1, matchesTarget: true } }),
    );

    expect(ranked[0]?.verdict).toBe("risky");
  });

  it("judges purely on static risk when no live data is supplied", () => {
    const candidates = generateSelectorCandidates({
      tagName: "INPUT",
      id: "patient-name",
      classes: [],
      attributes: { id: "patient-name" },
    });

    const ranked = rankSelectorCandidates(candidates);

    expect(ranked[0]?.verdict).toBe("recommended");
    expect(ranked[0]?.live).toBeUndefined();
  });

  it("sorts recommended candidates before risky before broken", () => {
    const candidates = generateSelectorCandidates({
      tagName: "INPUT",
      id: "input-928731", // dynamic -> high risk
      classes: ["stable-input"],
      attributes: { id: "input-928731", "data-apty-id": "patient-name" },
    });

    const ranked = rankSelectorCandidates(
      candidates,
      withLive({
        '[data-apty-id="patient-name"]': { matchCount: 1, matchesTarget: true },
        "#input-928731": { matchCount: 1, matchesTarget: true },
        "input.stable-input": { matchCount: 1, matchesTarget: true },
      }),
    );

    const verdicts = ranked.map((r) => r.verdict);
    // recommended entries must all precede risky entries which precede broken
    const firstRisky = verdicts.indexOf("risky");
    const firstRecommended = verdicts.indexOf("recommended");
    if (firstRisky !== -1 && firstRecommended !== -1) {
      expect(firstRecommended).toBeLessThan(firstRisky);
    }
  });
});

describe("formatSelectorReport", () => {
  it("reports no candidates when the list is empty", () => {
    expect(formatSelectorReport([])).toMatch(/no candidate/i);
  });

  it("renders each candidate with a verdict icon and reason, matching the product spec's example format", () => {
    const candidates = generateSelectorCandidates({
      tagName: "INPUT",
      classes: [],
      attributes: { "data-apty-id": "patient-name" },
    });
    const ranked = rankSelectorCandidates(
      candidates,
      new Map([
        [
          '[data-apty-id="patient-name"]',
          { matchCount: 1, matchesTarget: true },
        ],
      ]),
    );

    const report = formatSelectorReport(ranked);

    expect(report).toContain("✅");
    expect(report).toContain('[data-apty-id="patient-name"]');
  });
});
