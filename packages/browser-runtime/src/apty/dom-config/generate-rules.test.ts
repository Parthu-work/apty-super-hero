import { describe, expect, it } from "vitest";
import {
  analyze,
  profile,
  run,
  type Values,
  values,
} from "./__tests__/fixtures";
import { generateRules } from "./generate-rules";
import type { Rule } from "./types";

type Attrs = Record<string, Values>;

/** Pages of two runs each, as `[first, second]` attribute maps. */
function rulesFor(...pages: Array<[Attrs, Attrs?]>) {
  return generateRules(
    pages.map(
      ([first, second], i) =>
        analyze(
          [
            run("initial", profile(first)),
            run("after-reload", profile(second ?? first)),
          ],
          `p${i + 1}`,
        ).classified,
    ),
  );
}

const conditions = (rule: Rule) =>
  rule.conditions
    .map(
      (c) =>
        `${c.category}${c.attribute ? ` ${c.attribute}` : ""} ${c.operator} ${c.value}`,
    )
    .join(" OR ");

describe("generateRules", () => {
  it("writes a generalized, anchored pattern for generated ids", () => {
    const { rules } = rulesFor([{ id: values("ui-id-1", "ui-id-2", "home") }]);
    expect(rules.map(conditions)).toEqual([
      "Attribute Value id Regex ^ui-id-\\d+$",
    ]);
    expect(rules[0]).toMatchObject({
      target: "id",
      evidence: "pattern",
      confidence: "shape",
      group: "main",
      coveredValueCount: 2,
      exampleValues: ["ui-id-1", "ui-id-2"],
    });
  });

  it("names the changing query parameter, with the set-comparison caveat", () => {
    const { rules } = rulesFor([
      { href: values("/home?nocache=1729700000111") },
      { href: values("/home?nocache=1729700000222") },
    ]);
    expect(rules.map(conditions)).toEqual([
      "Attribute Value href Contains nocache",
    ]);
    expect(rules[0]).toMatchObject({
      evidence: "observed_change",
      confidence: "set-diff",
      exampleValues: [],
    });
    expect(rules[0]!.reason).toMatch(
      /cannot tell an attribute that changed from data that changed/,
    );
  });

  it("upgrades to element-diff when fingerprints show the same element changing", () => {
    const fp = (hash: string) => ({
      elementFingerprints: [
        { fingerprint: "f", attributeHashes: { autocomplete: hash } },
      ],
    });
    const classified = analyze([
      run("initial", profile({ autocomplete: values("off_1") }, fp("a"))),
      run("after-reload", profile({ autocomplete: values("off_2") }, fp("b"))),
    ]).classified;
    const [rule] = generateRules([classified]).rules;
    expect(rule).toMatchObject({ confidence: "element-diff" });
    expect(rule!.reason).not.toMatch(/cannot tell/);
  });

  it("never writes page data that is not identifier-shaped into a rule; the attribute goes to manual review without values (D3)", () => {
    const result = rulesFor([
      { "data-owner": values("Jane Doe 1"), "data-k": values("ok") },
      { "data-owner": values("Jane Doe 2"), "data-k": values("ok") },
    ]);
    expect(result.rules).toEqual([]);
    expect(result.manualReview).toEqual([
      expect.objectContaining({
        target: "attribute-value",
        name: "data-owner",
        valueCount: 2,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("Jane");
  });

  it("ignores an attribute by name when all its values change, and sends it to review when some stay", () => {
    const allChange = rulesFor([
      { "data-token": values("aXk") },
      { "data-token": values("qPz") },
    ]);
    expect(allChange.rules.map(conditions)).toEqual([
      "Attribute Name Equals data-token",
    ]);
    const someStay = rulesFor([
      { "data-token": values("aXk", "kept") },
      { "data-token": values("qPz", "kept") },
    ]);
    expect(someStay.rules).toEqual([]);
    expect(someStay.manualReview[0]).toMatchObject({
      name: "data-token",
      valueCount: 2,
    });
  });

  it("rejects a rule that would also ignore a value seen unchanged in every run", () => {
    const { rules, rejectedRules } = rulesFor(
      [{ id: values("row-1", "row-2") }],
      [{ id: values("row-3") }],
    );
    expect(rules).toEqual([]);
    expect(rejectedRules).toEqual([
      expect.objectContaining({
        stableMatches: 1,
        reason:
          "It would also ignore 1 value(s) that stayed the same in every run of a page.",
      }),
    ]);
    expect(conditions(rejectedRules[0]!.rule)).toBe(
      "Attribute Value id Regex ^row-\\d+$",
    );
  });

  it("deduplicates across pages and compacts where the union is exact", () => {
    const { rules } = rulesFor(
      [
        {
          href: values("/a?nocache=1"),
          src: values("/i.png?nocache=1"),
          id: values("ui-id-1", "ui-id-2", "ui-tab-1", "ui-tab-2"),
          class: values("even", "odd", "selected"),
          "aria-expanded": values("true"),
          "aria-selected": values("false"),
          width: values("100%"),
          height: values("20%"),
        },
        {
          href: values("/a?nocache=2"),
          src: values("/i.png?nocache=2"),
          id: values("ui-id-1", "ui-id-2", "ui-tab-1", "ui-tab-2"),
          class: values("even", "odd", "selected"),
          "aria-expanded": values("true"),
          "aria-selected": values("false"),
          width: values("100%"),
          height: values("20%"),
        },
      ],
      [{ id: values("ui-id-3", "ui-id-4") }],
    );
    expect(rules.map(conditions)).toEqual([
      "Attribute Value id Regex ^ui-(?:id-\\d+|tab-\\d+)$",
      "Attribute Value href Contains nocache OR Attribute Value src Contains nocache",
      "Attribute Value class Regex (?:^|\\s)(?:even|odd|selected)(?:\\s|$)",
      "Attribute Name In aria-expanded, aria-selected",
      "Attribute Name In height, width",
    ]);
    expect(rules[0]).toMatchObject({
      pages: ["p1", "p2"],
      coveredValueCount: 6,
    });
    expect(rules.slice(2).map((r) => r.group)).toEqual([
      "review",
      "review",
      "review",
    ]);
  });

  it("writes one rule when the same pattern is both observed changing and seen by shape", () => {
    const { rules } = rulesFor([
      { id: values("ui-id-2", "ui-id-3") },
      { id: values("ui-id-3", "ui-id-4") },
    ]);
    expect(rules.map(conditions)).toEqual([
      "Attribute Value id Regex ^ui-id-\\d+$",
    ]);
    expect(rules[0]).toMatchObject({
      evidence: "observed_change",
      coveredValueCount: 3,
    });
  });

  it("puts record identifiers in their own off-by-default group", () => {
    const { rules } = rulesFor([
      { href: values("/patients/1234567/chart"), "data-row": values("abc") },
    ]);
    expect(rules).toEqual([
      expect.objectContaining({
        group: "record-specific",
        evidence: "record_specific",
        conditions: [
          {
            category: "Attribute Value",
            attribute: "href",
            operator: "Regex",
            value: "^.*\\d{5,}.*$",
          },
        ],
        exampleValues: [],
      }),
    ]);
  });

  it("ignores PII-bearing values by shape and stores none of them", () => {
    const result = rulesFor([
      {
        title: values("jane.doe@example.com", "Edit"),
        "data-phone": values("(555) 123-4567"),
      },
    ]);
    expect(
      result.rules.map((r) => [r.evidence, r.conditions[0]?.value]),
    ).toEqual([
      ["pii", "^.*\\d{3}[\\s.)-]{1,2}\\d{3}[\\s.-]\\d{4}.*$"],
      ["pii", "^.*[^\\s@]@[^\\s@]+\\.[A-Za-z]{2,}.*$"],
    ]);
    const text = JSON.stringify(result);
    expect(text).not.toContain("jane.doe");
    expect(text).not.toContain("123-4567");
  });

  it("lists what Apty already ignores instead of emitting rules for it", () => {
    const result = rulesFor(
      [
        {
          id: values("provCheck_1009116120"),
          style: values("height: 1px"),
          tabindex: values("0"),
        },
      ],
      [{ id: values("provCheck_2009116121") }],
    );
    expect(result.rules).toEqual([]);
    expect(result.coveredByDefaults).toEqual([
      expect.objectContaining({
        target: "id",
        name: "id",
        generalized: "^provCheck_\\d+$",
        defaultRule: "id-for-digits",
        valueCount: 2,
        pages: ["p1", "p2"],
        exampleValues: [],
      }),
      expect.objectContaining({
        target: "attribute-name",
        name: "style",
        generalized: null,
      }),
      expect.objectContaining({
        target: "attribute-name",
        name: "tabindex",
        exampleValues: ["0"],
      }),
    ]);
  });

  it("suggests ignoring a password manager's attributes, but not Apty's, which its defaults cover", () => {
    const { rules } = rulesFor([
      { "data-myki-field": values("1"), "data-apty-root": values("true") },
    ]);
    expect(rules.map(conditions)).toEqual([
      "Attribute Name Regex ^data-myki-.*$",
    ]);
    expect(rules[0]).toMatchObject({
      evidence: "noise",
      group: "review",
      exampleValues: [],
    });
  });

  it("ignores attribute names that carry a generated number, such as Angular's view encapsulation", () => {
    const { rules } = rulesFor([
      {
        "_ngcontent-ng-c1137233439": values(""),
        "_nghost-ng-c99": values(""),
        "ng-version": values("17.3.0"),
      },
    ]);
    expect(rules.map(conditions)).toEqual([
      "Attribute Name Regex ^_ngcontent-ng-c\\d+$",
      "Attribute Name Regex ^_nghost-ng-c\\d+$",
    ]);
    expect(rules[0]).toMatchObject({
      evidence: "pattern",
      target: "attribute-name",
      group: "main",
    });
  });
});
