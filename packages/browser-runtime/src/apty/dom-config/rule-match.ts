/**
 * How Apty evaluates an ignore condition, so the engine counts what a rule
 * covers, and rejects one that would also hide a stable value, by the
 * same test Apty applies (`rule-node-to-snippet.helpers.ts`):
 *
 * - "Attribute Name" tests the attribute's name; "Attribute Value" tests
 *   the value, and only for the attribute the condition names.
 * - `Contains` is a regular expression search: Apty pastes the value into
 *   `/…/` unescaped, so the engine writes literals escaped.
 * - `Regex` is a JavaScript regular expression without flags, searched,
 *   not matched whole; the engine anchors its own patterns.
 * - `In` and `Not in` take a list.
 * - The conditions of a rule are ORed, as Apty ORs its list.
 *
 * For `class`, Apty tests the element's whole class value. The engine
 * holds class tokens, so it writes class patterns bounded by whitespace,
 * which match a token alone and a class value containing it alike.
 */
import { compileRuleRegex } from "./regex.js";
import type { Rule, RuleCondition } from "./types.js";

function test(condition: RuleCondition, subject: string): boolean {
  const { operator, value } = condition;
  switch (operator) {
    case "Equals":
      return subject === value;
    case "Not equals":
      return subject !== value;
    case "Contains":
      return compileRuleRegex(value)?.test(subject) ?? false;
    case "Does not contain":
      return !(compileRuleRegex(value)?.test(subject) ?? false);
    case "In":
      return (condition.items ?? []).includes(subject);
    case "Not in":
      return !(condition.items ?? []).includes(subject);
    case "Regex":
      return compileRuleRegex(value)?.test(subject) ?? false;
  }
}

/** @internal */
export function conditionMatches(
  condition: RuleCondition,
  name: string,
  value: string,
): boolean {
  if (condition.category === "Attribute Name") return test(condition, name);
  return name === condition.attribute && test(condition, value);
}

/** Whether `rule` ignores attribute `name` with `value` (a class token, or a whole class value, for `class`). */
export function ruleMatches(rule: Rule, name: string, value: string): boolean {
  return rule.conditions.some((condition) =>
    conditionMatches(condition, name, value),
  );
}
