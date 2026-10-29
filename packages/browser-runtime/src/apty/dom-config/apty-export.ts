/**
 * The report's proposals in the shape Apty stores them: the `domConfig`
 * of an application's configuration (`DOMConfigSchema` in Apty's shared
 * contracts), overrides only. The ignore lists are rules-engine trees
 * (`RuleNode`), Partial Selector conditions are the editor's rows, from
 * which Apty's server compiles the partial function when they are saved.
 */
import type {
  DomConfigReport,
  PartialSelectorRule,
  RuleCondition,
  RuleOperator,
} from "./types.js";

export type AptyOperator =
  | "eq"
  | "neq"
  | "contains"
  | "notContains"
  | "in"
  | "notIn"
  | "regex";

const OPERATORS: Record<RuleOperator, AptyOperator> = {
  Equals: "eq",
  "Not equals": "neq",
  Contains: "contains",
  "Does not contain": "notContains",
  In: "in",
  "Not in": "notIn",
  Regex: "regex",
};

export interface AptyRuleCondition {
  type: "condition";
  operator: AptyOperator;
  left: { kind: "var"; source: "attribute"; key: string };
  right: { kind: "literal"; value: string | string[] };
}

export interface AptyRuleGroup {
  type: "group";
  operator: "AND" | "OR";
  children: AptyRuleNode[];
}

export type AptyRuleNode = AptyRuleCondition | AptyRuleGroup;

export interface AptyPartialSelectorCondition {
  type: "IF" | "OR_IF";
  category: "ATTRIBUTE";
  key: string;
  relation: "pattern";
  value: [string];
}

/** The fields DOM Config proposes; Apty fills the others with its defaults. */
export interface AptyDomConfig {
  attributePriority: string[];
  ignoreElementSelectionConditions: AptyRuleNode | null;
  ignoreDomChangeConditions: AptyRuleNode | null;
  partialSelectorsConditions: AptyPartialSelectorCondition[];
  enableShadowDOMSupport: boolean | null;
  domDebounceTime: number | null;
  maxZIndex: number | null;
}

/** "Attribute Name" rows are stored under the key `selection`. */
export function toAptyCondition(condition: RuleCondition): AptyRuleCondition {
  const key =
    condition.category === "Attribute Name"
      ? "selection"
      : (condition.attribute ?? "selection");
  return {
    type: "condition",
    operator: OPERATORS[condition.operator],
    left: { kind: "var", source: "attribute", key },
    right: { kind: "literal", value: condition.items ?? condition.value },
  };
}

/** One condition as itself, several as an OR group, none as `null` (Apty's "no conditions"). */
export function toRuleNode(
  conditions: readonly RuleCondition[],
): AptyRuleNode | null {
  if (conditions.length === 0) return null;
  if (conditions.length === 1) return toAptyCondition(conditions[0]!);
  return {
    type: "group",
    operator: "OR",
    children: conditions.map(toAptyCondition),
  };
}

export function toPartialSelectorRows(
  rules: readonly PartialSelectorRule[],
): AptyPartialSelectorCondition[] {
  return rules.map((rule, i) => ({
    type: i === 0 ? "IF" : "OR_IF",
    category: "ATTRIBUTE",
    key: rule.attribute,
    relation: "pattern",
    value: [rule.pattern],
  }));
}

/**
 * The report as Apty's `domConfig` overrides. A setting this tool did not
 * measure is `null`, so Apty keeps its own value; the attribute priority
 * is always written, since DOM Config derives it.
 */
export function toAptyDomConfig(report: DomConfigReport): AptyDomConfig {
  return {
    attributePriority: report.attributePriority.value
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
    ignoreElementSelectionConditions: toRuleNode(
      report.rules.flatMap((rule) => rule.conditions),
    ),
    ignoreDomChangeConditions: toRuleNode(report.ignoreEvents.value),
    partialSelectorsConditions: toPartialSelectorRows(report.partialSelectors),
    enableShadowDOMSupport:
      report.shadowDom.basis === "default" ? null : report.shadowDom.value,
    domDebounceTime:
      report.debounce.basis === "default" ? null : report.debounce.value,
    maxZIndex: report.maxZIndex.value,
  };
}
