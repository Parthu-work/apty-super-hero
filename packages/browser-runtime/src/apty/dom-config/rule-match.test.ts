import { describe, expect, it } from "vitest";
import { conditionMatches, ruleMatches } from "./rule-match";
import type { Rule, RuleCondition } from "./types";

const value = (
  operator: RuleCondition["operator"],
  text: string,
  items?: string[],
): RuleCondition => ({
  category: "Attribute Value",
  attribute: "data-x",
  operator,
  value: text,
  ...(items ? { items } : {}),
});

const matches = (condition: RuleCondition, subject: string) =>
  conditionMatches(condition, "data-x", subject);

describe("conditionMatches", () => {
  it("evaluates every operator of Apty's rule builder", () => {
    expect(matches(value("Equals", "a"), "a")).toBe(true);
    expect(matches(value("Not equals", "a"), "a")).toBe(false);
    expect(matches(value("Contains", "cache"), "nocache=1")).toBe(true);
    expect(matches(value("Does not contain", "cache"), "nocache=1")).toBe(
      false,
    );
    expect(matches(value("In", "even, odd", ["even", "odd"]), "odd")).toBe(
      true,
    );
    expect(matches(value("Not in", "even, odd", ["even", "odd"]), "odd")).toBe(
      false,
    );
    expect(matches(value("Regex", "^ui-id-\\d+$"), "ui-id-12")).toBe(true);
    expect(matches(value("Regex", "^(broken$"), "anything")).toBe(false);
  });

  it("reads Contains as a regular expression, as Apty compiles it", () => {
    expect(matches(value("Contains", "a.c"), "abc")).toBe(true);
    expect(matches(value("Contains", "a\\.c"), "abc")).toBe(false);
  });

  it("tests a value condition only on the attribute it names", () => {
    expect(conditionMatches(value("Equals", "a"), "data-y", "a")).toBe(false);
  });

  it("tests an Attribute Name condition on the attribute's name", () => {
    const byName: RuleCondition = {
      category: "Attribute Name",
      operator: "In",
      value: "width, height",
      items: ["width", "height"],
    };
    expect(conditionMatches(byName, "height", "40")).toBe(true);
    expect(conditionMatches(byName, "id", "height")).toBe(false);
  });

  it("matches a rule when any of its conditions does", () => {
    const rule = {
      conditions: [
        { ...value("Regex", "^x\\d+$"), attribute: "id" },
        { ...value("Regex", "^x\\d+$"), attribute: "for" },
      ],
    } as Rule;
    expect(ruleMatches(rule, "id", "x1")).toBe(true);
    expect(ruleMatches(rule, "for", "x1")).toBe(true);
    expect(ruleMatches(rule, "name", "x1")).toBe(false);
  });
});
