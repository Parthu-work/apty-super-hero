/**
 * Attribute classification and Apty configuration concepts (Ignore
 * Selector, Partial Selector, Attribute Priority) for the DES engine
 * (`des-engine.ts`). Deterministic and explainable: every classification
 * carries a `reason` string, and nothing here calls an LLM or guesses.
 *
 * Classification precedence (spec: "if the same attribute is covered by
 * both ignore and partial configuration, Partial Selector takes
 * precedence"):
 *   1. A configured Partial Selector rule for this attribute — PARTIAL_MATCHABLE
 *      when a stable prefix exists, otherwise falls through to the
 *      heuristic (a partial rule with no usable prefix is not an ignore).
 *   2. A configured Ignore Selector rule for this attribute — IGNORED.
 *   3. The value doesn't look dynamically generated — STABLE.
 *   4. The value looks dynamic but has a safe stable prefix (Apty's
 *      default partial-matching behavior even without explicit
 *      configuration) — PARTIAL_MATCHABLE.
 *   5. Otherwise — DYNAMIC.
 *
 * "Looks dynamic" is never "contains digits" — see `health-dynamic.ts`'s
 * `looksDynamic`, which requires a UUID, an all-numeric value, a trailing
 * 4+ digit/6+ hex run, or a known framework-generated prefix.
 */
import { extractStablePrefix, looksDynamic } from "./health-dynamic.js";

export type AttributeClassification =
  | "STABLE"
  | "DYNAMIC"
  | "IGNORED"
  | "PARTIAL_MATCHABLE";

export interface ClassifiedAttribute {
  name: string;
  value: string;
  classification: AttributeClassification;
  /** Only present for PARTIAL_MATCHABLE — the stable leading substring a Partial Selector rule would anchor on. */
  stablePrefix?: string;
  /** Human-readable, evidence-facing explanation — never omitted. */
  reason: string;
}

export interface IgnoreSelectorRule {
  attribute: string;
}
export interface PartialSelectorRule {
  attribute: string;
}
export interface AttributePriorityConfig {
  /** Ordered attribute-name patterns; earlier entries are tried first. `"data-*"` matches any data-attribute not explicitly listed. Overrides the engine default entirely when provided (spec: "custom Attribute Priority must override default priority where configured"). */
  order: string[];
}

export interface DesConfig {
  ignoreSelectors: IgnoreSelectorRule[];
  partialSelectors: PartialSelectorRule[];
  attributePriority?: AttributePriorityConfig;
  /** How many ancestor levels checkContainers/checkSimplifyNth may climb. */
  maxAncestorDepth: number;
  /** Similarity score (0-100) a candidate must reach to be considered at all — see des-engine.ts's documented weighting. */
  similarityThreshold: number;
  /** If the top two above-threshold candidates' similarity differ by less than this, the result is AMBIGUOUS rather than picking the higher one. */
  ambiguousGap: number;
}

/**
 * Default attribute priority (spec section on Attribute Priority):
 * automation/test-id attributes first (the ones a QA/RPA tool would add
 * specifically to be targeted), then id, then other data-* attributes,
 * then accessibility/semantic signals, then class last (classes are
 * shared far more often than they are unique).
 */
export const DEFAULT_ATTRIBUTE_PRIORITY_ORDER: readonly string[] = [
  "data-testid",
  "data-test-id",
  "data-automation-id",
  "data-automationid",
  "data-apty*",
  "id",
  "data-*",
  "aria-label",
  "name",
  "role",
  "class",
];

export const DEFAULT_DES_CONFIG: DesConfig = {
  ignoreSelectors: [],
  partialSelectors: [],
  maxAncestorDepth: 4,
  similarityThreshold: 70,
  ambiguousGap: 5,
};

export function resolveAttributePriorityOrder(
  config: DesConfig,
): readonly string[] {
  return config.attributePriority?.order ?? DEFAULT_ATTRIBUTE_PRIORITY_ORDER;
}

/** Lower is higher priority. An attribute absent from the order list is tried last, after every configured/default entry — never silently invisible to selector generation. */
export function priorityRankOf(
  attrName: string,
  order: readonly string[],
): number {
  const exact = order.indexOf(attrName);
  if (exact >= 0) return exact;
  if (attrName.startsWith("data-apty") && order.includes("data-apty*")) {
    return order.indexOf("data-apty*") + 0.1;
  }
  if (attrName.startsWith("data-") && order.includes("data-*")) {
    return order.indexOf("data-*") + 0.5;
  }
  return order.length + 1000;
}

function findRule(
  rules: Array<{ attribute: string }>,
  attribute: string,
): boolean {
  return rules.some((r) => r.attribute === attribute);
}

/** Classify one single-valued attribute (id, a data-* key, aria-label, name, role — never `class`, which is multi-valued; see `classifyClassAttribute`). */
export function classifyAttribute(
  name: string,
  value: string,
  config: DesConfig,
): ClassifiedAttribute {
  const dynamicByHeuristic = looksDynamic(value);
  const stablePrefix = dynamicByHeuristic ? extractStablePrefix(value) : null;

  if (findRule(config.partialSelectors, name)) {
    if (stablePrefix) {
      return {
        name,
        value,
        classification: "PARTIAL_MATCHABLE",
        stablePrefix,
        reason: `configured Partial Selector rule found stable prefix "${stablePrefix}"`,
      };
    }
    return {
      name,
      value,
      classification: dynamicByHeuristic ? "DYNAMIC" : "STABLE",
      reason: dynamicByHeuristic
        ? "configured Partial Selector rule matched, but no safe stable prefix exists in this value"
        : "value does not look dynamically generated",
    };
  }

  if (findRule(config.ignoreSelectors, name)) {
    return {
      name,
      value,
      classification: "IGNORED",
      reason: "configured Ignore Selector rule excludes this attribute",
    };
  }

  if (!dynamicByHeuristic) {
    return {
      name,
      value,
      classification: "STABLE",
      reason: "value does not look dynamically generated",
    };
  }

  if (stablePrefix) {
    return {
      name,
      value,
      classification: "PARTIAL_MATCHABLE",
      stablePrefix,
      reason: `stable prefix "${stablePrefix}" found in an otherwise dynamic-looking value (default partial matching)`,
    };
  }

  return {
    name,
    value,
    classification: "DYNAMIC",
    reason:
      "value looks machine-generated (UUID, all-numeric, or a generated-suffix pattern) with no safe stable prefix",
  };
}

export interface ClassifiedClassAttribute {
  classification: AttributeClassification;
  /** Space-joined stable tokens, when any exist. */
  stableTokens: string[];
  dynamicTokens: string[];
  /** At most one token's stable-prefix candidate is surfaced — the first found, in document order. */
  partial: { token: string; prefix: string } | null;
  reason: string;
}

/** `class` is multi-valued, so it is classified per-token, then rolled up: stable if ANY token is stable (matches how a real Ignore Selector configuration would drop only the dynamic tokens), partial-matchable if none are stable but one has an extractable prefix, dynamic otherwise. */
export function classifyClassAttribute(
  classAttr: string,
  config: DesConfig,
): ClassifiedClassAttribute {
  const tokens = classAttr.split(/\s+/).filter(Boolean);
  if (
    findRule(config.ignoreSelectors, "class") &&
    !findRule(config.partialSelectors, "class")
  ) {
    return {
      classification: "IGNORED",
      stableTokens: [],
      dynamicTokens: tokens,
      partial: null,
      reason: "configured Ignore Selector rule excludes the class attribute",
    };
  }

  const stableTokens: string[] = [];
  const dynamicTokens: string[] = [];
  let partial: { token: string; prefix: string } | null = null;
  for (const token of tokens) {
    if (!looksDynamic(token)) {
      stableTokens.push(token);
      continue;
    }
    dynamicTokens.push(token);
    if (!partial) {
      const prefix = extractStablePrefix(token);
      if (prefix) partial = { token, prefix };
    }
  }

  if (stableTokens.length > 0) {
    return {
      classification: "STABLE",
      stableTokens,
      dynamicTokens,
      partial,
      reason: `${stableTokens.length} of ${tokens.length} class token(s) are stable`,
    };
  }
  if (partial) {
    return {
      classification: "PARTIAL_MATCHABLE",
      stableTokens,
      dynamicTokens,
      partial,
      reason: `no stable class token, but "${partial.token}" has stable prefix "${partial.prefix}"`,
    };
  }
  return {
    classification: tokens.length > 0 ? "DYNAMIC" : "STABLE",
    stableTokens,
    dynamicTokens,
    partial,
    reason:
      tokens.length > 0
        ? "every class token looks machine-generated"
        : "no class attribute",
  };
}
