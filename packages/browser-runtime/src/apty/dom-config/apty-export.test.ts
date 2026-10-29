import { describe, expect, it } from "vitest";
import { capture, page, profile, run, values } from "./__tests__/fixtures";
import {
  type AptyRuleNode,
  toAptyCondition,
  toAptyDomConfig,
  toRuleNode,
} from "./apty-export";
import { buildDomConfigReport } from "./build-report";
import { ruleMatches } from "./rule-match";
import type { RuleCondition } from "./types";

/**
 * Apty's own reading of a stored tree (`rule-node-to-snippet.helpers.ts`):
 * `selection` tests the name; any other key tests that attribute's value;
 * Contains and Regex are unescaped regular expressions; In is a list.
 */
function aptyIgnores(node: AptyRuleNode, name: string, value: string): boolean {
  if (node.type === "group") {
    const results = node.children.map((child) =>
      aptyIgnores(child, name, value),
    );
    return node.operator === "OR"
      ? results.some(Boolean)
      : results.every(Boolean);
  }
  const key = node.left.key === "className" ? "class" : node.left.key;
  const nameOnly = key === "selection" || key === "name";
  const subject = nameOnly ? name : value;
  const literal = node.right.value;
  const test = (() => {
    switch (node.operator) {
      case "eq":
        return subject === literal;
      case "neq":
        return subject !== literal;
      case "contains":
        return new RegExp(literal as string).test(subject);
      case "notContains":
        return !new RegExp(literal as string).test(subject);
      case "regex":
        return new RegExp(literal as string).test(subject);
      case "in":
        return (literal as string[]).includes(subject);
      case "notIn":
        return !(literal as string[]).includes(subject);
    }
  })();
  return nameOnly ? test : name === key && test;
}

describe("toAptyCondition", () => {
  it("stores an Attribute Name row under `selection` and an Attribute Value row under its attribute", () => {
    expect(
      toAptyCondition({
        category: "Attribute Name",
        operator: "In",
        value: "width, height",
        items: ["width", "height"],
      }),
    ).toEqual({
      type: "condition",
      operator: "in",
      left: { kind: "var", source: "attribute", key: "selection" },
      right: { kind: "literal", value: ["width", "height"] },
    });
    expect(
      toAptyCondition({
        category: "Attribute Value",
        attribute: "id",
        operator: "Regex",
        value: "^ui-id-\\d+$",
      }).left.key,
    ).toBe("id");
  });

  it("writes nothing for no conditions and an OR group for several", () => {
    const one: RuleCondition = {
      category: "Attribute Name",
      operator: "Equals",
      value: "nowrap",
    };
    expect(toRuleNode([])).toBeNull();
    expect(toRuleNode([one])).toMatchObject({ type: "condition" });
    expect(toRuleNode([one, one])).toMatchObject({
      type: "group",
      operator: "OR",
    });
  });
});

describe("toAptyDomConfig", () => {
  const report = buildDomConfigReport(
    capture([
      page("p1", [
        run(
          "initial",
          profile({
            id: values(
              "ui-id-1",
              "ui-id-2",
              "win3-save-button",
              "win3-cancel-button",
              "home",
            ),
            href: values("/home?nocache=1729700000111"),
            class: values("row even", "row odd", "panel"),
            height: values("40"),
          }),
        ),
        run(
          "after-reload",
          profile({
            id: values(
              "ui-id-3",
              "ui-id-4",
              "win7-save-button",
              "win7-cancel-button",
              "home",
            ),
            href: values("/home?nocache=1729700000222"),
            class: values("row even", "row odd", "panel"),
            height: values("40"),
          }),
        ),
      ]),
    ]),
  );
  const config = toAptyDomConfig(report);

  it("ignores in Apty exactly the values the engine says its rules ignore", () => {
    const tree = toAptyDomConfig({
      ...report,
      rules: report.rules,
    }).ignoreElementSelectionConditions!;
    const samples: Array<[string, string]> = [
      ["id", "ui-id-9"],
      ["id", "home"],
      ["href", "/home?nocache=1"],
      ["href", "/home"],
      ["class", "row even"],
      ["class", "panel"],
      ["height", "40"],
      ["title", "Save"],
    ];
    for (const [name, value] of samples) {
      expect(aptyIgnores(tree, name, value)).toBe(
        report.rules.some((rule) => ruleMatches(rule, name, value)),
      );
    }
  });

  it("carries the partial selector rows, the priority and the measured settings", () => {
    expect(config.partialSelectorsConditions).toEqual([
      {
        type: "IF",
        category: "ATTRIBUTE",
        key: "id",
        relation: "pattern",
        value: ["^win\\d+(.+)$"],
      },
    ]);
    expect(config.attributePriority).toEqual(
      report.attributePriority.value.split(","),
    );
    expect(config.domDebounceTime).toBeNull();
    expect(config.maxZIndex).toBe(report.maxZIndex.value);
    expect(config.ignoreDomChangeConditions).toBeNull();
  });
});
