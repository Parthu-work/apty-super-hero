import { describe, expect, it } from "vitest";
import { conditionMatches, ruleMatches } from "./rule-match";
import type { Rule, RuleCondition } from "./types";

const value = (
  operator: RuleCondition["operator"],
  text: string,
): RuleCondition => ({
  category: "Attribute Value",
  operator,
  value: text,
});

describe("conditionMatches", () => {
  it("evaluates every operator of Apty's rule builder", () => {
    expect(conditionMatches(value("Equals", "a"), "a")).toBe(true);
    expect(conditionMatches(value("Not equals", "a"), "a")).toBe(false);
    expect(conditionMatches(value("Contains", "cache"), "nocache=1")).toBe(
      true,
    );
    expect(
      conditionMatches(value("Does not contain", "cache"), "nocache=1"),
    ).toBe(false);
    expect(conditionMatches(value("In", "even, odd"), "odd")).toBe(true);
    expect(conditionMatches(value("Not in", "even,odd"), "odd")).toBe(false);
    expect(conditionMatches(value("Regex", "^ui-id-\\d+$"), "ui-id-12")).toBe(
      true,
    );
    expect(conditionMatches(value("Regex", "^(broken$"), "anything")).toBe(
      false,
    );
  });

  it("applies the name condition to the attribute name and the value condition to the value", () => {
    const rule = {
      conditions: [
        { category: "Attribute Name", operator: "Equals", value: "id" },
        value("Regex", "^x\\d+$"),
      ],
    } as Rule;
    expect(ruleMatches(rule, "id", "x1")).toBe(true);
    expect(ruleMatches(rule, "name", "x1")).toBe(false);
  });
});
