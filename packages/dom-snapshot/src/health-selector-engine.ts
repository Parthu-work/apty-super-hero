/**
 * Apty-style element-selection simulation engine.
 *
 * This is the core fix for the DOM Health score-inflation bug: instead of
 * judging an attribute's *shape* ("does this id look hand-written?") and
 * calling that "healthy", every candidate selector this module produces is
 * tested against the LIVE DOM with `querySelectorAll` — uniqueness and
 * target-identity are verified, never assumed. An id/class shared by dozens
 * of repeated rows will fail here even though it "looks stable".
 *
 * Pipeline per element (spec section 8, DES-inspired, section 13):
 *   direct (single stable attribute)
 *     -> ignore (compound of stable attributes, simulating an Ignore
 *        Selector rule dropping the dynamic ones)
 *     -> partial (stable substring of a dynamic value, simulating a
 *        Partial Selector rule)
 *     -> context (nearest identifiable ancestor + own descriptive part)
 *     -> positional (nth-of-type path, last resort)
 * The first stage whose candidate resolves to exactly one element, and that
 * element is the intended target, wins. A selector that is unique but
 * wrong, or that matches several elements including the target, is never
 * counted as a success — see `SelectorResolutionOutcome`.
 */
import { extractStablePrefix, looksDynamic } from "./health-dynamic.js";
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
}

export interface ResolveElementOptions {
  /** How many ancestor levels the contextual/positional strategies may climb. Defaults to 4. */
  maxAncestorDepth?: number;
}

const DEFAULT_MAX_ANCESTOR_DEPTH = 4;

const TEST_ID_KEYS = new Set([
  "testid",
  "test-id",
  "automation-id",
  "automationid",
]);

function escapeAttributeValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

function cssEscapeIdent(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

interface AttributeCandidate {
  name: string;
  value: string;
  selector: string;
  dynamic: boolean;
  /** Priority order — lower tries first. */
  priority: number;
}

function dataAttributeEntries(el: Element): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith("data-") && attr.value) {
      entries.push([attr.name.slice(5), attr.value]);
    }
  }
  return entries;
}

/** Every individually-testable attribute-based candidate for this element, in priority order, tagged with whether its raw value looks dynamically generated. */
function collectAttributeCandidates(el: Element): AttributeCandidate[] {
  const tag = el.tagName.toLowerCase();
  const out: AttributeCandidate[] = [];

  for (const [key, value] of dataAttributeEntries(el)) {
    if (TEST_ID_KEYS.has(key) || key.startsWith("apty")) {
      out.push({
        name: `data-${key}`,
        value,
        selector: `[data-${key}="${escapeAttributeValue(value)}"]`,
        dynamic: looksDynamic(value),
        priority: 0,
      });
    }
  }

  const id = el.getAttribute("id");
  if (id) {
    out.push({
      name: "id",
      value: id,
      selector: `#${cssEscapeIdent(id)}`,
      dynamic: looksDynamic(id),
      priority: 1,
    });
  }

  for (const [key, value] of dataAttributeEntries(el)) {
    if (TEST_ID_KEYS.has(key) || key.startsWith("apty")) continue;
    out.push({
      name: `data-${key}`,
      value,
      selector: `${tag}[data-${key}="${escapeAttributeValue(value)}"]`,
      dynamic: looksDynamic(value),
      priority: 2,
    });
  }

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) {
    out.push({
      name: "aria-label",
      value: ariaLabel,
      selector: `[aria-label="${escapeAttributeValue(ariaLabel)}"]`,
      dynamic: looksDynamic(ariaLabel),
      priority: 3,
    });
  }

  const name = el.getAttribute("name");
  if (name) {
    out.push({
      name: "name",
      value: name,
      selector: `${tag}[name="${escapeAttributeValue(name)}"]`,
      dynamic: looksDynamic(name),
      priority: 4,
    });
  }

  const classNames = (el.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const stableClasses = classNames.filter((c) => !looksDynamic(c));
  if (stableClasses.length > 0) {
    out.push({
      name: "class",
      value: stableClasses.join(" "),
      selector: `${tag}.${stableClasses.map(cssEscapeIdent).join(".")}`,
      dynamic: false,
      priority: 5,
    });
  } else if (classNames.length > 0) {
    out.push({
      name: "class",
      value: classNames.join(" "),
      selector: `${tag}.${classNames.map(cssEscapeIdent).join(".")}`,
      dynamic: true,
      priority: 5,
    });
  }

  const role = el.getAttribute("role");
  if (role) {
    out.push({
      name: "role",
      value: role,
      selector: `${tag}[role="${escapeAttributeValue(role)}"]`,
      dynamic: false,
      priority: 6,
    });
  }

  return out.sort((a, b) => a.priority - b.priority);
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

function nthOfTypeIndex(el: Element): number {
  let i = 1;
  let sib = el.previousElementSibling;
  while (sib) {
    if (sib.tagName === el.tagName) i++;
    sib = sib.previousElementSibling;
  }
  return i;
}

function positionalSegment(el: Element): string {
  return `${el.tagName.toLowerCase()}:nth-of-type(${nthOfTypeIndex(el)})`;
}

/** A single stable (non-dynamic-looking) identifying selector for an ancestor, or null — used only to scope contextual recovery, not required to be globally unique on its own. */
function stableSelfSelector(el: Element): string | null {
  const candidates = collectAttributeCandidates(el).filter((c) => !c.dynamic);
  return candidates[0]?.selector ?? null;
}

/** Best-effort descriptive fragment for the target element itself, used inside a contextual (ancestor-scoped) candidate — does not need to be independently unique. */
function ownDescriptivePart(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const best = collectAttributeCandidates(el)[0];
  if (best) {
    // Strip any leading tag-qualification duplication; reuse the raw selector fragment.
    return best.selector.startsWith(tag) ||
      best.selector.startsWith("#") ||
      best.selector.startsWith("[")
      ? best.selector
      : `${tag}${best.selector}`;
  }
  return tag;
}

function tryContextualRecovery(
  root: ParentNode,
  el: Element,
  maxDepth: number,
): { selector: string; depth: number } | null {
  let ancestor = el.parentElement;
  let depth = 0;
  const ownPart = ownDescriptivePart(el);
  const positional = positionalSegment(el);

  while (ancestor && depth < maxDepth) {
    depth++;
    const ancestorSelector = stableSelfSelector(ancestor);
    if (ancestorSelector) {
      const candidateA = `${ancestorSelector} ${ownPart}`;
      const testA = testSelector(root, candidateA, el);
      if (testA.matchCount === 1 && testA.matchesTarget) {
        return { selector: candidateA, depth };
      }
      const candidateB = `${ancestorSelector} ${positional}`;
      const testB = testSelector(root, candidateB, el);
      if (testB.matchCount === 1 && testB.matchesTarget) {
        return { selector: candidateB, depth };
      }
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

function tryPositional(
  root: ParentNode,
  el: Element,
  maxDepth: number,
): { selector: string; depth: number } | null {
  const segments: string[] = [positionalSegment(el)];
  let cur = el.parentElement;
  let depth = 0;
  while (cur && depth < maxDepth) {
    segments.unshift(positionalSegment(cur));
    const candidate = segments.join(" > ");
    const test = testSelector(root, candidate, el);
    if (test.matchCount === 1 && test.matchesTarget) {
      return { selector: candidate, depth: depth + 1 };
    }
    cur = cur.parentElement;
    depth++;
  }
  return null;
}

/** Fallback classification once every recovery strategy has failed to produce a unique+correct selector. */
function classifyFailure(
  worstAmbiguous: LiveTestResult | null,
  worstWrongTarget: boolean,
): { outcome: SelectorResolutionOutcome; matchCount: number } {
  if (worstAmbiguous) {
    return { outcome: "AMBIGUOUS", matchCount: worstAmbiguous.matchCount };
  }
  if (worstWrongTarget) {
    return { outcome: "WRONG_TARGET", matchCount: 1 };
  }
  return { outcome: "NOT_RESOLVED", matchCount: 0 };
}

/**
 * Run the full selector-resolution pipeline for one live element. `root` is
 * the correct scope to query against — the owner `Document` for ordinary
 * elements, the `ShadowRoot` for elements inside an open shadow tree, or the
 * iframe's own `Document` for elements inside a same-origin iframe (never
 * pierce a boundary the browser itself would not let a real selector
 * pierce).
 */
export function resolveElement(
  root: ParentNode,
  el: Element,
  options: ResolveElementOptions = {},
): ElementResolution {
  const maxAncestorDepth =
    options.maxAncestorDepth ?? DEFAULT_MAX_ANCESTOR_DEPTH;
  const attributeCandidates = collectAttributeCandidates(el);
  const dynamicAttributeNames = attributeCandidates
    .filter((c) => c.dynamic)
    .map((c) => c.name);
  const stableAttributeNames = attributeCandidates
    .filter((c) => !c.dynamic)
    .map((c) => c.name);

  let sawAmbiguous: LiveTestResult | null = null;
  let sawWrongTarget = false;

  const record = (result: LiveTestResult) => {
    if (result.matchCount > 1 && result.matchesTarget) {
      if (!sawAmbiguous || result.matchCount < sawAmbiguous.matchCount) {
        sawAmbiguous = result;
      }
    } else if (result.matchCount === 1 && !result.matchesTarget) {
      sawWrongTarget = true;
    }
  };

  // Stage 1: direct — single stable attribute, tried in priority order.
  for (const candidate of attributeCandidates.filter((c) => !c.dynamic)) {
    const result = testSelector(root, candidate.selector, el);
    record(result);
    if (result.matchCount === 1 && result.matchesTarget) {
      return {
        outcome: "DIRECT_SUCCESS",
        strategy: "direct",
        bestSelector: candidate.selector,
        matchCount: 1,
        ancestorDepthUsed: 0,
        usesPositionalSelector: false,
        dynamicAttributeNames,
        stableAttributeNames,
      };
    }
  }

  // Stage 2: ignore — compound of every stable attribute together,
  // simulating an Ignore Selector rule that drops the dynamic ones.
  const stableCombo = attributeCandidates.filter((c) => !c.dynamic);
  if (stableCombo.length > 1) {
    const tag = el.tagName.toLowerCase();
    const combined = `${tag}${stableCombo.map((c) => c.selector.replace(new RegExp(`^${tag}`), "")).join("")}`;
    const result = testSelector(root, combined, el);
    record(result);
    if (result.matchCount === 1 && result.matchesTarget) {
      return {
        outcome: "RECOVERED_BY_IGNORE",
        strategy: "ignore",
        bestSelector: combined,
        matchCount: 1,
        ancestorDepthUsed: 0,
        usesPositionalSelector: false,
        dynamicAttributeNames,
        stableAttributeNames,
      };
    }
  }

  // Stage 3: partial — stable substring of a dynamic value.
  const tag = el.tagName.toLowerCase();
  for (const candidate of attributeCandidates.filter((c) => c.dynamic)) {
    const prefix = extractStablePrefix(candidate.value);
    if (!prefix) continue;
    const attrName = candidate.name.startsWith("data-")
      ? candidate.name
      : candidate.name;
    const selector =
      attrName === "id"
        ? `${tag}[id^="${escapeAttributeValue(prefix)}"]`
        : attrName === "class"
          ? `${tag}[class*="${escapeAttributeValue(prefix)}"]`
          : `${tag}[${attrName}^="${escapeAttributeValue(prefix)}"]`;
    const result = testSelector(root, selector, el);
    record(result);
    if (result.matchCount === 1 && result.matchesTarget) {
      return {
        outcome: "RECOVERED_BY_PARTIAL",
        strategy: "partial",
        bestSelector: selector,
        matchCount: 1,
        ancestorDepthUsed: 0,
        usesPositionalSelector: false,
        dynamicAttributeNames,
        stableAttributeNames,
      };
    }
  }

  // Stage 4: contextual — nearest identifiable ancestor + own descriptive part.
  const contextResult = tryContextualRecovery(root, el, maxAncestorDepth);
  if (contextResult) {
    return {
      outcome: "RECOVERED_BY_CONTEXT",
      strategy: "context",
      bestSelector: contextResult.selector,
      matchCount: 1,
      ancestorDepthUsed: contextResult.depth,
      usesPositionalSelector: false,
      dynamicAttributeNames,
      stableAttributeNames,
    };
  }

  // Stage 5: positional — last resort, nth-of-type path.
  const positionalResult = tryPositional(root, el, maxAncestorDepth);
  if (positionalResult) {
    return {
      outcome: "POSITIONAL_ONLY",
      strategy: "positional",
      bestSelector: positionalResult.selector,
      matchCount: 1,
      ancestorDepthUsed: positionalResult.depth,
      usesPositionalSelector: true,
      dynamicAttributeNames,
      stableAttributeNames,
    };
  }

  const failure = classifyFailure(sawAmbiguous, sawWrongTarget);
  return {
    ...failure,
    strategy: "none",
    bestSelector: null,
    ancestorDepthUsed: 0,
    usesPositionalSelector: false,
    dynamicAttributeNames,
    stableAttributeNames,
  };
}

export function extractElementAttributes(
  el: Element,
): DomHealthElementAttributes {
  const dataAttributes: Record<string, string> = {};
  for (const [key, value] of dataAttributeEntries(el)) {
    dataAttributes[key] = value;
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
