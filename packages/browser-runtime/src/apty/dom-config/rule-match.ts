/**
 * How the engine evaluates its own rules against observed values, to
 * count what a rule covers and to reject one that would also hide a stable
 * value. ASSUMPTIONS (D7, open questions 1 and 2): `In` takes a
 * comma-separated list; `Regex` is a JavaScript regular expression, and
 * every pattern is anchored `^…$` so a full match and a search agree; an
 * id or class rule is an `Attribute Name` condition plus an
 * `Attribute Value` condition, the class condition applied to each token.
 */
import { compileRuleRegex } from "./regex.js";
import type { Rule, RuleCondition } from "./types.js";

function listOf(value: string): string[] {
  return value.split(",").map((part) => part.trim());
}

export function conditionMatches(
  condition: RuleCondition,
  subject: string,
): boolean {
  const { operator, value } = condition;
  switch (operator) {
    case "Equals":
      return subject === value;
    case "Not equals":
      return subject !== value;
    case "Contains":
      return subject.includes(value);
    case "Does not contain":
      return !subject.includes(value);
    case "In":
      return listOf(value).includes(subject);
    case "Not in":
      return !listOf(value).includes(subject);
    case "Regex":
      return compileRuleRegex(value)?.test(subject) ?? false;
  }
}

/** Whether `rule` ignores attribute `name` with `value` (a class token for `class`). */
export function ruleMatches(rule: Rule, name: string, value: string): boolean {
  return rule.conditions.every((condition) =>
    conditionMatches(
      condition,
      condition.category === "Attribute Name" ? name : value,
    ),
  );
}
