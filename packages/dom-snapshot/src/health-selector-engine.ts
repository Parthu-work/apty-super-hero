/**
 * Adapter between the DES engine (`des-engine.ts`) and the DOM Health
 * collector's existing per-element evidence shape (`ElementResolution`).
 *
 * This file previously contained its own "collect attribute candidates,
 * try each in priority order" heuristic. That heuristic has been REMOVED,
 * not merely deprioritized: `resolveElement` below now delegates entirely
 * to `runDes` for the actual resolution decision, so there is exactly one
 * automatic element-selection algorithm in this package. Everything left
 * in this file is either the legacy-shape adapter or genuinely unrelated
 * utilities (`extractElementAttributes`, `hasAccessibleName`,
 * `testSelector`, `computeElementFingerprint`) that `health-collector.ts`
 * also needs and that are not themselves a competing selection algorithm.
 */
import {
  buildElementPattern,
  computeIdentityFingerprint,
  type DesResult,
  runDes,
} from "./des-engine.js";
import { DEFAULT_DES_CONFIG } from "./health-attribute-classification.js";
import type {
  DomHealthElementAttributes,
  SelectorResolutionOutcome,
  SelectorStrategy,
} from "./health-types.js";

export interface ElementResolution {
  outcome: SelectorResolutionOutcome;
  strategy: SelectorStrategy;
  bestSelector: string | null;
  matchCount: number;
  ancestorDepthUsed: number;
  usesPositionalSelector: boolean;
  dynamicAttributeNames: string[];
  stableAttributeNames: string[];
  /** The attribute (e.g. "id", "data-testid", "class") the winning candidate was built from — null when nothing resolved (context/positional wins report the strategy instead, since they combine multiple signals). Exposes the attribute-priority decision rather than hiding it inside an opaque score. */
  winningAttribute: string | null;
}

export interface ResolveElementOptions {
  /** How many ancestor levels the contextual/positional strategies may climb. Defaults to 4. */
  maxAncestorDepth?: number;
}

function escapeAttributeValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

export interface LiveTestResult {
  /** -1 when the selector itself was invalid syntax. */
  matchCount: number;
  matchesTarget: boolean;
}

export function testSelector(
  root: ParentNode,
  selector: string,
  target: Element,
): LiveTestResult {
  try {
    const matches = root.querySelectorAll(selector);
    let matchesTarget = false;
    for (const m of Array.from(matches)) {
      if (m === target) {
        matchesTarget = true;
        break;
      }
    }
    return { matchCount: matches.length, matchesTarget };
  } catch {
    return { matchCount: -1, matchesTarget: false };
  }
}

/**
 * Map a `DesResult` (the rich, multi-strategy DES contract) onto the
 * narrower `ElementResolution` shape `health-collector.ts` already
 * aggregates into `DomHealthSnapshot`. The mapping is a genuine
 * simplification, not a lossy guess: every legacy outcome/strategy pair
 * below corresponds to a real, distinguishable DES result.
 */
function adaptDesResult(result: DesResult): ElementResolution {
  const dynamicAttributeNames: string[] = [];
  const stableAttributeNames: string[] = [];
  for (const attempt of result.attempts) {
    for (const name of attempt.attributesRemoved) {
      if (!dynamicAttributeNames.includes(name))
        dynamicAttributeNames.push(name);
    }
    for (const name of attempt.attributesUsed) {
      if (!stableAttributeNames.includes(name)) stableAttributeNames.push(name);
    }
  }

  if (result.outcome === "RESOLVED") {
    const isPurelyPositional = result.attributesUsed.length === 0;
    if (isPurelyPositional) {
      return {
        outcome: "POSITIONAL_ONLY",
        strategy: "positional",
        bestSelector: result.selector,
        matchCount: 1,
        ancestorDepthUsed: result.attempts.length,
        usesPositionalSelector: true,
        dynamicAttributeNames,
        stableAttributeNames,
        winningAttribute: null,
      };
    }
    switch (result.strategy) {
      case "checkInitialPath":
        return {
          outcome: "DIRECT_SUCCESS",
          strategy: "direct",
          bestSelector: result.selector,
          matchCount: 1,
          ancestorDepthUsed: 0,
          usesPositionalSelector: false,
          dynamicAttributeNames,
          stableAttributeNames,
          winningAttribute: result.attributesUsed[0] ?? null,
        };
      case "checkSimplifyDynamic":
        return {
          outcome:
            result.attributesUsed.length === 1
              ? "RECOVERED_BY_PARTIAL"
              : "RECOVERED_BY_IGNORE",
          strategy: result.attributesUsed.length === 1 ? "partial" : "ignore",
          bestSelector: result.selector,
          matchCount: 1,
          ancestorDepthUsed: 0,
          usesPositionalSelector: false,
          dynamicAttributeNames,
          stableAttributeNames,
          winningAttribute: result.attributesUsed.join("+"),
        };
      case "checkSimplifyNth":
      case "checkContainers":
        return {
          outcome: "RECOVERED_BY_CONTEXT",
          strategy: "context",
          bestSelector: result.selector,
          matchCount: result.candidateCount,
          ancestorDepthUsed: result.attempts.length,
          usesPositionalSelector: false,
          dynamicAttributeNames,
          stableAttributeNames,
          winningAttribute: null,
        };
      case "checkDirectElement":
        return {
          outcome: "POSITIONAL_ONLY",
          strategy: "positional",
          bestSelector: result.selector,
          matchCount: result.candidateCount,
          ancestorDepthUsed: 0,
          usesPositionalSelector: true,
          dynamicAttributeNames,
          stableAttributeNames,
          winningAttribute: null,
        };
    }
  }

  if (result.outcome === "AMBIGUOUS") {
    return {
      outcome: "AMBIGUOUS",
      strategy: "none",
      bestSelector: result.selector,
      matchCount: Math.max(result.candidateCount, 2),
      ancestorDepthUsed: 0,
      usesPositionalSelector: false,
      dynamicAttributeNames,
      stableAttributeNames,
      winningAttribute: null,
    };
  }
  if (result.outcome === "WRONG_TARGET") {
    return {
      outcome: "WRONG_TARGET",
      strategy: "none",
      bestSelector: result.selector,
      matchCount: 1,
      ancestorDepthUsed: 0,
      usesPositionalSelector: false,
      dynamicAttributeNames,
      stableAttributeNames,
      winningAttribute: null,
    };
  }
  if (result.outcome === "INACCESSIBLE") {
    return {
      outcome: "INACCESSIBLE",
      strategy: "none",
      bestSelector: null,
      matchCount: 0,
      ancestorDepthUsed: 0,
      usesPositionalSelector: false,
      dynamicAttributeNames,
      stableAttributeNames,
      winningAttribute: null,
    };
  }
  // NOT_RESOLVED
  return {
    outcome: "NOT_RESOLVED",
    strategy: "none",
    bestSelector: null,
    matchCount: 0,
    ancestorDepthUsed: 0,
    usesPositionalSelector: false,
    dynamicAttributeNames,
    stableAttributeNames,
    winningAttribute: null,
  };
}

/**
 * Run the DES pipeline for one live element and adapt it to the legacy
 * `ElementResolution` shape `health-collector.ts` aggregates. `root` is
 * the correct scope to query against — the owner `Document` for ordinary
 * elements, the `ShadowRoot` for elements inside an open shadow tree
 * (never a closed one, and never a different frame's document — see
 * `des-engine.ts`'s module doc comment).
 */
export function resolveElement(
  root: ParentNode,
  el: Element,
  options: ResolveElementOptions = {},
): ElementResolution {
  const config = {
    ...DEFAULT_DES_CONFIG,
    maxAncestorDepth:
      options.maxAncestorDepth ?? DEFAULT_DES_CONFIG.maxAncestorDepth,
  };
  const result = runDes(root, el, config);
  return adaptDesResult(result);
}

/**
 * A logical fingerprint for cross-snapshot element correlation (spec
 * section 18) — deliberately NOT a single attribute, and deliberately NOT
 * object identity. Delegates to `des-engine.ts`'s
 * `computeIdentityFingerprint` over a freshly-built `ElementPattern`, so
 * DES's own cross-snapshot identity model and this package's
 * cross-snapshot STABILITY tracking (`health-collector.ts`'s element
 * registry) share one definition of "the same logical element" rather
 * than two that could quietly drift apart.
 */
export function computeElementFingerprint(el: Element): string {
  return computeIdentityFingerprint(
    buildElementPattern(el, DEFAULT_DES_CONFIG),
  );
}

export function extractElementAttributes(
  el: Element,
): DomHealthElementAttributes {
  const dataAttributes: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith("data-") && attr.value) {
      dataAttributes[attr.name.slice(5)] = attr.value;
    }
  }
  const className =
    typeof el.className === "string" && el.className ? el.className : undefined;
  return {
    id: el.id || undefined,
    className,
    name: el.getAttribute("name") || undefined,
    role: el.getAttribute("role") || undefined,
    ariaLabel: el.getAttribute("aria-label") || undefined,
    ariaLabelledby: el.getAttribute("aria-labelledby") || undefined,
    dataAttributes,
  };
}

/** Supporting accessibility signal (spec section 21) — not a selector-reliability judgment on its own. */
export function hasAccessibleName(el: Element): boolean {
  if (el.getAttribute("aria-label")?.trim()) return true;
  if (el.getAttribute("aria-labelledby")?.trim()) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === "button" || tag === "a") {
    return Boolean(el.textContent?.trim());
  }
  if (tag === "input" || tag === "textarea" || tag === "select") {
    if (el.getAttribute("placeholder")?.trim()) return true;
    const id = el.getAttribute("id");
    if (id) {
      if (
        el.ownerDocument.querySelector(
          `label[for="${escapeAttributeValue(id)}"]`,
        )
      ) {
        return true;
      }
    }
    return Boolean(el.closest("label"));
  }
  return Boolean(el.textContent?.trim());
}
