/**
 * Apty Dynamic Element Selection (DES) engine.
 *
 * Replaces the previous "collect attribute candidates, try them one at a
 * time" heuristic (formerly the whole of `health-selector-engine.ts`) with
 * a structured pipeline: ElementPattern/ElementPath capture, five ordered
 * strategies, deterministic structural similarity, an explicit acceptance
 * threshold, and mandatory target-identity verification. There is exactly
 * one automatic element-selection algorithm in this package — see
 * `health-selector-engine.ts`'s `resolveElement`, which is now a thin
 * adapter over `runDes` for backward compatibility with existing callers
 * (`health-collector.ts`, and every test written against the older,
 * narrower `ElementResolution` shape).
 *
 * Ground rules enforced throughout this file (never relaxed to inflate a
 * score):
 *   - A selector is never "successful" merely because `querySelectorAll`
 *     returned something, or returned exactly one element. Every match is
 *     verified against the actual target (live object identity when the
 *     target is a live element in the same document; a logical
 *     fingerprint comparison — never cross-snapshot object identity — when
 *     it is not, per the Phase 1 identity model).
 *   - A tie between multiple above-threshold candidates is AMBIGUOUS, not
 *     a coin-flip pick of the first one.
 *   - A unique-but-incorrect match is WRONG_TARGET, not a quiet success.
 *   - Nothing here calls an LLM, and nothing here is tuned to raise a
 *     score — the threshold and weights are fixed, documented constants
 *     (see `similarityThreshold`/`ambiguousGap` in `DesConfig` and
 *     `computeSimilarity` below).
 */
import {
  type ClassifiedAttribute,
  type ClassifiedClassAttribute,
  classifyAttribute,
  classifyClassAttribute,
  DEFAULT_DES_CONFIG,
  type DesConfig,
  priorityRankOf,
  resolveAttributePriorityOrder,
} from "./health-attribute-classification.js";

// ---------------------------------------------------------------------------
// ElementPattern / ElementPath (Step 1)
// ---------------------------------------------------------------------------

export interface RelationshipInfo {
  parentTag: string | null;
  parentId: string | null;
  parentStableClasses: string[];
  /** How this node relates to the parent in a generated selector — direct child (">") by default; strategies may relax this to "descendant" (" "). */
  combinator: "child" | "descendant";
}

export interface OrderInfo {
  /** 1-based index among siblings sharing this tag under the same parent. */
  nthOfType: number;
  /** Total siblings (including this one) sharing this tag under the same parent. */
  siblingCountOfType: number;
}

export interface ElementPattern {
  tag: string;
  /** Every classifiable single-valued attribute found (id, data-*, aria-label, name, role) — never every attribute on the element indiscriminately. */
  attributes: ClassifiedAttribute[];
  classInfo: ClassifiedClassAttribute;
  relationship: RelationshipInfo;
  order: OrderInfo;
  role: string | null;
  accessibleName: string | null;
  /** Trimmed, length-bounded text sample — a similarity signal only, never used to build a selector predicate. */
  textSample: string | null;
}

export interface ElementPathNode {
  pattern: ElementPattern;
}

export interface ElementPath {
  target: ElementPathNode;
  /** Innermost first (direct parent, grandparent, ...), bounded by `DesConfig.maxAncestorDepth`. */
  ancestors: ElementPathNode[];
}

// ---------------------------------------------------------------------------
// Candidates, similarity, strategy evidence, and the result contract
// ---------------------------------------------------------------------------

export interface SimilarityBreakdown {
  tagMatches: boolean;
  stableAttributeScore: number;
  partialAttributeScore: number;
  classScore: number;
  accessibilityScore: number;
  relationshipScore: number;
  orderScore: number;
  /** 0-100. 0 whenever `tagMatches` is false, regardless of every other axis — two different tags are never "the same element" no matter how similar everything else is. */
  total: number;
}

export interface Candidate {
  element: Element;
  pattern: ElementPattern;
  similarity: SimilarityBreakdown;
}

export type IdentityVerdict =
  | "CORRECT_TARGET"
  | "WRONG_TARGET"
  | "AMBIGUOUS_TARGET"
  | "UNKNOWN_IDENTITY";

export type DesStrategyName =
  | "checkInitialPath"
  | "checkSimplifyDynamic"
  | "checkSimplifyNth"
  | "checkContainers"
  | "checkDirectElement";

export interface StrategyAttemptEvidence {
  strategy: DesStrategyName;
  selector: string | null;
  candidatesFound: number;
  candidatesAboveThreshold: number;
  bestSimilarity: number | null;
  attributesUsed: string[];
  attributesRemoved: string[];
  outcome:
    | "resolved"
    | "ambiguous"
    | "wrong-target"
    | "no-candidates"
    | "below-threshold"
    | "inaccessible";
  reason: string;
}

export type DesOutcome =
  | "RESOLVED"
  | "AMBIGUOUS"
  | "WRONG_TARGET"
  | "NOT_RESOLVED"
  | "INACCESSIBLE";

interface DesResultCommon {
  attempts: StrategyAttemptEvidence[];
}

export interface DesResolved extends DesResultCommon {
  outcome: "RESOLVED";
  strategy: DesStrategyName;
  selector: string;
  similarity: number;
  identity: IdentityVerdict;
  candidateCount: number;
  attributesUsed: string[];
  attributesRemoved: string[];
}

export interface DesAmbiguous extends DesResultCommon {
  outcome: "AMBIGUOUS";
  selector: string | null;
  candidateCount: number;
  similarity: number | null;
  reason: string;
}

export interface DesWrongTarget extends DesResultCommon {
  outcome: "WRONG_TARGET";
  strategy: DesStrategyName;
  selector: string;
  similarity: number;
  reason: string;
}

export interface DesNotResolved extends DesResultCommon {
  outcome: "NOT_RESOLVED";
  bestSimilarity: number | null;
  failureReason: string;
}

export interface DesInaccessible extends DesResultCommon {
  outcome: "INACCESSIBLE";
  reason: string;
}

export type DesResult =
  | DesResolved
  | DesAmbiguous
  | DesWrongTarget
  | DesNotResolved
  | DesInaccessible;

// ---------------------------------------------------------------------------
// Small deterministic helpers
// ---------------------------------------------------------------------------

function escapeAttributeValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

function cssEscapeIdent(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

interface SiblingInfo {
  nthOfType: number;
  siblingCountOfType: number;
}

/**
 * Performance (Step 20): a naive per-element `nthOfType`/`siblingCountOfType`
 * (walking `previousElementSibling` and re-scanning `parent.children`) is
 * O(siblings) PER CALL — on a page with N same-tag siblings (a table of
 * rows, a list of repeated rows) that is O(N) per element and O(N^2)
 * across all of them. This computes every sibling's order info for a
 * given parent in ONE pass and caches it per-child, so a page with 400
 * sibling buttons costs one O(400) pass, not 400 of them. The cache is
 * reset at the start of every `collectDomHealthSnapshot` round (see
 * `resetDesPerformanceCaches`) so a later round that legitimately
 * inserted/removed/reordered a sibling is never served stale counts from
 * an earlier one.
 */
let siblingInfoCache = new WeakMap<Element, SiblingInfo>();

export function resetDesPerformanceCaches(): void {
  siblingInfoCache = new WeakMap();
}

function getSiblingInfo(el: Element): SiblingInfo {
  const cached = siblingInfoCache.get(el);
  if (cached) return cached;

  const parent = el.parentElement;
  if (!parent) {
    const info: SiblingInfo = { nthOfType: 1, siblingCountOfType: 1 };
    siblingInfoCache.set(el, info);
    return info;
  }

  const countByTag = new Map<string, number>();
  const children = Array.from(parent.children);
  for (const child of children) {
    const nextIndex = (countByTag.get(child.tagName) ?? 0) + 1;
    countByTag.set(child.tagName, nextIndex);
    siblingInfoCache.set(child, {
      nthOfType: nextIndex,
      siblingCountOfType: 0,
    });
  }
  for (const child of children) {
    siblingInfoCache.get(child)!.siblingCountOfType = countByTag.get(
      child.tagName,
    )!;
  }
  return siblingInfoCache.get(el)!;
}

const CLASSIFIABLE_SINGLE_ATTRS = ["id", "aria-label", "name", "role"] as const;

function dataAttributeEntries(el: Element): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith("data-") && attr.value) {
      entries.push([attr.name, attr.value]);
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// ElementPattern / ElementPath construction (Step 2)
// ---------------------------------------------------------------------------

function buildRelationship(el: Element): RelationshipInfo {
  const parent = el.parentElement;
  if (!parent) {
    return {
      parentTag: null,
      parentId: null,
      parentStableClasses: [],
      combinator: "child",
    };
  }
  const classInfo = classifyClassAttribute(
    parent.getAttribute("class") ?? "",
    DEFAULT_DES_CONFIG,
  );
  return {
    parentTag: parent.tagName.toLowerCase(),
    parentId: parent.getAttribute("id") || null,
    parentStableClasses: classInfo.stableTokens,
    combinator: "child",
  };
}

function accessibleNameOf(el: Element): string | null {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel?.trim()) return ariaLabel.trim();
  const tag = el.tagName.toLowerCase();
  if (tag === "button" || tag === "a") {
    const text = el.textContent?.trim();
    if (text) return text.slice(0, 120);
  }
  const placeholder = el.getAttribute("placeholder");
  if (placeholder?.trim()) return placeholder.trim();
  const name = el.getAttribute("name");
  if (name?.trim()) return name.trim();
  return null;
}

/** Build the classified-attribute + structural pattern for one element — the unit both target and candidates are compared through. Never reads every DOM attribute indiscriminately; only the classifiable, identity-relevant ones. */
export function buildElementPattern(
  el: Element,
  config: DesConfig = DEFAULT_DES_CONFIG,
): ElementPattern {
  const attributes: ClassifiedAttribute[] = [];
  for (const name of CLASSIFIABLE_SINGLE_ATTRS) {
    const value = el.getAttribute(name);
    if (value) attributes.push(classifyAttribute(name, value, config));
  }
  for (const [name, value] of dataAttributeEntries(el)) {
    attributes.push(classifyAttribute(name, value, config));
  }

  const classInfo = classifyClassAttribute(
    el.getAttribute("class") ?? "",
    config,
  );

  return {
    tag: el.tagName.toLowerCase(),
    attributes,
    classInfo,
    relationship: buildRelationship(el),
    order: { ...getSiblingInfo(el) },
    role: el.getAttribute("role"),
    accessibleName: accessibleNameOf(el),
    textSample: (el.textContent ?? "").trim().slice(0, 60) || null,
  };
}

/** Build the target's pattern plus its bounded ancestor chain — the ElementPath every strategy below reads from. Deliberately NOT an XPath string: the ancestor chain preserves each level's own classified attributes/classes/order so later comparison can reason about WHICH level changed, not just serialize a path. */
export function buildElementPath(
  el: Element,
  config: DesConfig = DEFAULT_DES_CONFIG,
): ElementPath {
  const ancestors: ElementPathNode[] = [];
  let cur = el.parentElement;
  let depth = 0;
  while (cur && depth < config.maxAncestorDepth) {
    ancestors.push({ pattern: buildElementPattern(cur, config) });
    cur = cur.parentElement;
    depth++;
  }
  return { target: { pattern: buildElementPattern(el, config) }, ancestors };
}

// ---------------------------------------------------------------------------
// Structural similarity (Step 6)
//
// Weighting (sums to 100, documented rather than tuned per-fixture):
//   tag mismatch          -> total forced to 0 (never partial credit for a
//                            different element kind)
//   stable attributes  35 -> Jaccard over {name=value} pairs from STABLE
//   partial attributes 10 -> Jaccard over {name=stablePrefix} pairs from
//                            PARTIAL_MATCHABLE
//   classes            15 -> Jaccard over stable class tokens
//   accessibility      10 -> role equality (5) + accessible-name equality (5)
//   relationship       20 -> parent tag match (10) + parent id/class
//                            Jaccard (10)
//   order              10 -> closeness of nth-of-type index (proportional
//                            to sibling count), never a hard cliff
// ---------------------------------------------------------------------------

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const v of a) if (b.has(v)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function stableAttrSet(pattern: ElementPattern): Set<string> {
  return new Set(
    pattern.attributes
      .filter((a) => a.classification === "STABLE")
      .map((a) => `${a.name}=${a.value}`),
  );
}

function partialAttrSet(pattern: ElementPattern): Set<string> {
  return new Set(
    pattern.attributes
      .filter((a) => a.classification === "PARTIAL_MATCHABLE" && a.stablePrefix)
      .map((a) => `${a.name}=${a.stablePrefix}`),
  );
}

function orderSimilarity(a: OrderInfo, b: OrderInfo): number {
  const maxCount = Math.max(a.siblingCountOfType, b.siblingCountOfType, 1);
  const diff = Math.abs(a.nthOfType - b.nthOfType);
  return Math.max(0, 1 - diff / maxCount);
}

/** Deterministic, documented structural similarity between two patterns — 100 identical, 0 for a tag mismatch or total structural disagreement. Never an LLM judgment, never randomized. */
export function computeSimilarity(
  target: ElementPattern,
  candidate: ElementPattern,
): SimilarityBreakdown {
  if (target.tag !== candidate.tag) {
    return {
      tagMatches: false,
      stableAttributeScore: 0,
      partialAttributeScore: 0,
      classScore: 0,
      accessibilityScore: 0,
      relationshipScore: 0,
      orderScore: 0,
      total: 0,
    };
  }

  const stableAttributeScore =
    jaccard(stableAttrSet(target), stableAttrSet(candidate)) * 35;
  const partialAttributeScore =
    jaccard(partialAttrSet(target), partialAttrSet(candidate)) * 10;
  const classScore =
    jaccard(
      new Set(target.classInfo.stableTokens),
      new Set(candidate.classInfo.stableTokens),
    ) * 15;

  const roleMatch = (target.role ?? "") === (candidate.role ?? "") ? 5 : 0;
  const nameMatch =
    target.accessibleName && target.accessibleName === candidate.accessibleName
      ? 5
      : 0;
  const accessibilityScore = roleMatch + nameMatch;

  const parentTagMatch =
    target.relationship.parentTag === candidate.relationship.parentTag ? 10 : 0;
  const parentClassJaccard = jaccard(
    new Set([
      ...(target.relationship.parentId
        ? [`id=${target.relationship.parentId}`]
        : []),
      ...target.relationship.parentStableClasses.map((c) => `class=${c}`),
    ]),
    new Set([
      ...(candidate.relationship.parentId
        ? [`id=${candidate.relationship.parentId}`]
        : []),
      ...candidate.relationship.parentStableClasses.map((c) => `class=${c}`),
    ]),
  );
  const relationshipScore = parentTagMatch + parentClassJaccard * 10;

  const orderScore = orderSimilarity(target.order, candidate.order) * 10;

  const total = Math.round(
    stableAttributeScore +
      partialAttributeScore +
      classScore +
      accessibilityScore +
      relationshipScore +
      orderScore,
  );

  return {
    tagMatches: true,
    stableAttributeScore,
    partialAttributeScore,
    classScore,
    accessibilityScore,
    relationshipScore,
    orderScore,
    total: Math.max(0, Math.min(100, total)),
  };
}

// ---------------------------------------------------------------------------
// Selector generation (Step 12) — attribute-fragment candidates
// ---------------------------------------------------------------------------

interface AttributeFragment {
  name: string;
  fragment: string;
  isPartial: boolean;
}

function stableFragmentsOf(
  pattern: ElementPattern,
  config: DesConfig,
): AttributeFragment[] {
  const order = resolveAttributePriorityOrder(config);
  const out: AttributeFragment[] = [];
  for (const attr of pattern.attributes) {
    if (attr.classification !== "STABLE") continue;
    const fragment =
      attr.name === "id"
        ? `#${cssEscapeIdent(attr.value)}`
        : `[${attr.name}="${escapeAttributeValue(attr.value)}"]`;
    out.push({ name: attr.name, fragment, isPartial: false });
  }
  if (
    pattern.classInfo.classification === "STABLE" &&
    pattern.classInfo.stableTokens.length > 0
  ) {
    out.push({
      name: "class",
      fragment: pattern.classInfo.stableTokens
        .map((c) => `.${cssEscapeIdent(c)}`)
        .join(""),
      isPartial: false,
    });
  }
  return out.sort(
    (a, b) => priorityRankOf(a.name, order) - priorityRankOf(b.name, order),
  );
}

function partialFragmentsOf(
  pattern: ElementPattern,
  config: DesConfig,
): AttributeFragment[] {
  const order = resolveAttributePriorityOrder(config);
  const out: AttributeFragment[] = [];
  for (const attr of pattern.attributes) {
    if (attr.classification !== "PARTIAL_MATCHABLE" || !attr.stablePrefix)
      continue;
    const fragment =
      attr.name === "id"
        ? `[id^="${escapeAttributeValue(attr.stablePrefix)}"]`
        : `[${attr.name}^="${escapeAttributeValue(attr.stablePrefix)}"]`;
    out.push({ name: attr.name, fragment, isPartial: true });
  }
  if (
    pattern.classInfo.classification === "PARTIAL_MATCHABLE" &&
    pattern.classInfo.partial
  ) {
    out.push({
      name: "class",
      fragment: `[class*="${escapeAttributeValue(pattern.classInfo.partial.prefix)}"]`,
      isPartial: true,
    });
  }
  return out.sort(
    (a, b) => priorityRankOf(a.name, order) - priorityRankOf(b.name, order),
  );
}

interface QueryResult {
  selector: string;
  matches: Element[];
}

function safeQuery(root: ParentNode, selector: string): QueryResult | null {
  try {
    return { selector, matches: Array.from(root.querySelectorAll(selector)) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Target identity verification (Step 8)
// ---------------------------------------------------------------------------

/**
 * Compact logical fingerprint used ONLY for cross-snapshot identity
 * verification (never for selector generation) — matches the shape
 * `health-selector-engine.ts`'s `computeElementFingerprint` already uses
 * elsewhere in this package, so the two never drift on what "the same
 * logical element" means. Deliberately excludes `id` (the attribute most
 * likely to be regenerated by a framework on rerender).
 */
export function computeIdentityFingerprint(pattern: ElementPattern): string {
  const stableSignature = pattern.attributes
    .filter((a) => a.classification === "STABLE" && a.name !== "id")
    .map((a) => `${a.name}=${a.value}`)
    .sort()
    .join(",");
  return [
    pattern.tag,
    (pattern.role ?? "").toLowerCase(),
    pattern.accessibleName ?? "",
    stableSignature,
    pattern.textSample ?? "",
    pattern.order.nthOfType,
  ].join("||");
}

export interface IdentityContext {
  /** The live target element, when this DES run has one (the normal, single-snapshot case — e.g. `health-collector.ts` analyzing the page it is currently in). */
  liveTarget?: Element;
  /** A previously-captured identity fingerprint to compare against, for cross-snapshot recovery where no live target object exists — the Phase 1 "never rely on object identity across snapshots" model. */
  expectedFingerprint?: string;
}

function verifyIdentity(
  candidate: Candidate,
  _targetPattern: ElementPattern,
  context: IdentityContext,
): IdentityVerdict {
  if (context.liveTarget) {
    return candidate.element === context.liveTarget
      ? "CORRECT_TARGET"
      : "WRONG_TARGET";
  }
  if (context.expectedFingerprint) {
    return computeIdentityFingerprint(candidate.pattern) ===
      context.expectedFingerprint
      ? "CORRECT_TARGET"
      : "WRONG_TARGET";
  }
  // No ground truth available at all (a genuine production cross-snapshot
  // resolution with nothing stored to check against) — a high-similarity
  // unique match is still reported, but its identity is honestly UNKNOWN,
  // never claimed CORRECT without evidence.
  return "UNKNOWN_IDENTITY";
}

// ---------------------------------------------------------------------------
// Candidate building / ranking shared by every strategy
// ---------------------------------------------------------------------------

/**
 * Performance (Step 20): building a pattern re-walks sibling/ancestor
 * chains, which is O(siblings) per call — never redo that work when the
 * candidate under test is literally the live target this run already
 * built a pattern for (the overwhelmingly common "resolves to itself"
 * case for every strategy). Correctness is unaffected: the target IS its
 * own pattern.
 */
function patternFor(
  element: Element,
  targetPattern: ElementPattern,
  config: DesConfig,
  identityContext: IdentityContext,
): ElementPattern {
  if (identityContext.liveTarget && element === identityContext.liveTarget) {
    return targetPattern;
  }
  return buildElementPattern(element, config);
}

function buildCandidates(
  _root: ParentNode,
  matches: Element[],
  targetPattern: ElementPattern,
  config: DesConfig,
  ceiling: number,
  identityContext: IdentityContext,
): { candidates: Candidate[]; capped: boolean } {
  const capped = matches.length > ceiling;
  const bounded = capped ? matches.slice(0, ceiling) : matches;
  const candidates = bounded.map((element) => {
    const pattern = patternFor(element, targetPattern, config, identityContext);
    return {
      element,
      pattern,
      similarity: computeSimilarity(targetPattern, pattern),
    };
  });
  candidates.sort((a, b) => b.similarity.total - a.similarity.total);
  return { candidates, capped };
}

/** Rank already-built candidates and classify the outcome against the configured threshold/gap — shared by checkSimplifyNth and checkDirectElement, the two strategies that must reason about MULTIPLE candidates rather than stopping at the first unique match. */
function rankAndClassify(
  candidates: Candidate[],
  config: DesConfig,
  identityContext: IdentityContext,
  targetPattern: ElementPattern,
):
  | { decision: "resolved"; candidate: Candidate; identity: IdentityVerdict }
  | { decision: "ambiguous"; reason: string }
  | { decision: "wrong-target"; candidate: Candidate }
  | { decision: "below-threshold" } {
  const aboveThreshold = candidates.filter(
    (c) => c.similarity.total >= config.similarityThreshold,
  );
  if (aboveThreshold.length === 0) return { decision: "below-threshold" };

  const top = aboveThreshold[0]!;
  const runnerUp = aboveThreshold[1];
  if (
    runnerUp &&
    top.similarity.total - runnerUp.similarity.total < config.ambiguousGap
  ) {
    return {
      decision: "ambiguous",
      reason: `${aboveThreshold.length} candidates scored within ${config.ambiguousGap} points of each other (top ${top.similarity.total}, runner-up ${runnerUp.similarity.total})`,
    };
  }

  const identity = verifyIdentity(top, targetPattern, identityContext);
  if (identity === "WRONG_TARGET") {
    return { decision: "wrong-target", candidate: top };
  }
  if (identity === "AMBIGUOUS_TARGET") {
    return {
      decision: "ambiguous",
      reason: "identity verification could not distinguish the top candidate",
    };
  }
  return { decision: "resolved", candidate: top, identity };
}

function makeEvidence(
  strategy: DesStrategyName,
  overrides: Partial<StrategyAttemptEvidence>,
): StrategyAttemptEvidence {
  return {
    strategy,
    selector: null,
    candidatesFound: 0,
    candidatesAboveThreshold: 0,
    bestSimilarity: null,
    attributesUsed: [],
    attributesRemoved: [],
    outcome: "no-candidates",
    reason: "",
    ...overrides,
  };
}

interface StrategySuccess {
  strategy: DesStrategyName;
  selector: string;
  similarity: number;
  identity: IdentityVerdict;
  candidateCount: number;
  attributesUsed: string[];
  attributesRemoved: string[];
}

type StrategyOutcome =
  | {
      kind: "resolved";
      success: StrategySuccess;
      evidence: StrategyAttemptEvidence;
    }
  | {
      kind: "wrong-target";
      selector: string;
      similarity: number;
      evidence: StrategyAttemptEvidence;
    }
  | { kind: "inconclusive"; evidence: StrategyAttemptEvidence };

// ---------------------------------------------------------------------------
// Strategy 1 — checkInitialPath (Step 5.1)
//
// The naive, "as captured" attempt: try the target's own single stable/
// partial identifying attribute alone first (the common case — most
// well-built elements already have one), then fall back to the full,
// unsimplified nth-of-type ancestor chain. Never uses a DYNAMIC-classified
// value as a selector predicate — Step 12 forbids unstable generated
// values in every strategy, not just the later "simplification" ones; what
// makes this strategy "initial/unsimplified" is that it tries the leaf
// alone before ever touching ancestor context, and falls back to the full
// positional path rather than a relaxed one.
// ---------------------------------------------------------------------------

function checkInitialPath(
  root: ParentNode,
  path: ElementPath,
  config: DesConfig,
  identityContext: IdentityContext,
): StrategyOutcome {
  const targetPattern = path.target.pattern;
  const stableFragments = stableFragmentsOf(targetPattern, config);
  let sawWrongTarget = false;
  let sawAmbiguous = false;

  for (const frag of stableFragments) {
    // An id selector is already globally scoped — prefixing it with the
    // tag only adds noise, and this file's own tests (and the ecosystem
    // convention `#id` represents) expect the bare form.
    const selector =
      frag.name === "id"
        ? frag.fragment
        : `${targetPattern.tag}${frag.fragment}`;
    const result = safeQuery(root, selector);
    if (!result) continue;
    if (result.matches.length === 0) continue;
    if (result.matches.length === 1) {
      const candidatePattern = patternFor(
        result.matches[0]!,
        targetPattern,
        config,
        identityContext,
      );
      const similarity = computeSimilarity(targetPattern, candidatePattern);
      const candidate: Candidate = {
        element: result.matches[0]!,
        pattern: candidatePattern,
        similarity,
      };
      const identity = verifyIdentity(
        candidate,
        targetPattern,
        identityContext,
      );
      if (identity === "CORRECT_TARGET" || identity === "UNKNOWN_IDENTITY") {
        return {
          kind: "resolved",
          success: {
            strategy: "checkInitialPath",
            selector,
            similarity: similarity.total,
            identity,
            candidateCount: 1,
            attributesUsed: [frag.name],
            attributesRemoved: [],
          },
          evidence: makeEvidence("checkInitialPath", {
            selector,
            candidatesFound: 1,
            candidatesAboveThreshold: 1,
            bestSimilarity: similarity.total,
            attributesUsed: [frag.name],
            outcome: "resolved",
            reason: `unique match on stable attribute "${frag.name}"`,
          }),
        };
      }
      sawWrongTarget = true;
      continue;
    }
    sawAmbiguous = true;
  }

  // Deliberately no positional fallback here: checkInitialPath is "try the
  // target's own literal identifying attribute(s), unsimplified" — the
  // full unsimplified STRUCTURAL path (ancestor chain, nth positions) is
  // what later strategies build on top of once a bare attribute isn't
  // enough; falling back to it here would let it win before
  // checkSimplifyDynamic's combined-stable ("ignore selector") recovery
  // ever gets a chance, which is never correct when the target genuinely
  // has multiple stable attributes that only narrow it down together.
  return {
    kind: "inconclusive",
    evidence: makeEvidence("checkInitialPath", {
      outcome: sawWrongTarget
        ? "wrong-target"
        : sawAmbiguous
          ? "ambiguous"
          : "no-candidates",
      reason: sawWrongTarget
        ? "a stable attribute resolved uniquely, but not to the target"
        : sawAmbiguous
          ? "a stable attribute matched multiple elements including the target"
          : "the target has no stable identifying attribute of its own",
    }),
  };
}

// ---------------------------------------------------------------------------
// Strategy 2 — checkSimplifyDynamic (Step 5.2)
//
// Removes DYNAMIC-classified attributes/classes entirely; tries
// PARTIAL_MATCHABLE prefixes first (Partial Selector precedence over
// Ignore Selector for the same attribute — see
// `health-attribute-classification.ts`), then a combined "ignore selector"
// style predicate over every remaining STABLE attribute together. This is
// the strategy that specifically recovers enterprise apps whose generated
// ids/classes change between sessions or renders.
// ---------------------------------------------------------------------------

function checkSimplifyDynamic(
  root: ParentNode,
  path: ElementPath,
  config: DesConfig,
  identityContext: IdentityContext,
): StrategyOutcome {
  const targetPattern = path.target.pattern;
  const dynamicRemoved = targetPattern.attributes
    .filter((a) => a.classification === "DYNAMIC")
    .map((a) => a.name);
  if (targetPattern.classInfo.classification === "DYNAMIC")
    dynamicRemoved.push("class");

  const partialFragments = partialFragmentsOf(targetPattern, config);
  for (const frag of partialFragments) {
    const selector = `${targetPattern.tag}${frag.fragment}`;
    const outcome = evaluateUniqueSelector(
      root,
      selector,
      targetPattern,
      config,
      identityContext,
      "checkSimplifyDynamic",
      [frag.name],
      dynamicRemoved,
      `recovered via a stable prefix of "${frag.name}" (dynamic suffix ignored)`,
    );
    if (outcome.kind !== "inconclusive") return outcome;
  }

  const stableFragments = stableFragmentsOf(targetPattern, config);
  if (stableFragments.length > 1) {
    const combined = `${targetPattern.tag}${stableFragments.map((f) => f.fragment).join("")}`;
    const outcome = evaluateUniqueSelector(
      root,
      combined,
      targetPattern,
      config,
      identityContext,
      "checkSimplifyDynamic",
      stableFragments.map((f) => f.name),
      dynamicRemoved,
      "combined every remaining stable attribute together (dynamic attributes ignored)",
    );
    if (outcome.kind !== "inconclusive") return outcome;
  }

  return {
    kind: "inconclusive",
    evidence: makeEvidence("checkSimplifyDynamic", {
      attributesRemoved: dynamicRemoved,
      outcome: "no-candidates",
      reason:
        "no partial or combined-stable selector resolved uniquely once dynamic attributes were removed",
    }),
  };
}

function evaluateUniqueSelector(
  root: ParentNode,
  selector: string,
  targetPattern: ElementPattern,
  config: DesConfig,
  identityContext: IdentityContext,
  strategy: DesStrategyName,
  attributesUsed: string[],
  attributesRemoved: string[],
  successReason: string,
): StrategyOutcome {
  const result = safeQuery(root, selector);
  if (!result || result.matches.length === 0) {
    return {
      kind: "inconclusive",
      evidence: makeEvidence(strategy, {
        selector,
        attributesRemoved,
        outcome: "no-candidates",
        reason: "selector matched nothing",
      }),
    };
  }
  if (result.matches.length > 1) {
    return {
      kind: "inconclusive",
      evidence: makeEvidence(strategy, {
        selector,
        candidatesFound: result.matches.length,
        attributesRemoved,
        outcome: "ambiguous",
        reason: "selector matched more than one element",
      }),
    };
  }
  const candidatePattern = patternFor(
    result.matches[0]!,
    targetPattern,
    config,
    identityContext,
  );
  const similarity = computeSimilarity(targetPattern, candidatePattern);
  const candidate: Candidate = {
    element: result.matches[0]!,
    pattern: candidatePattern,
    similarity,
  };
  const identity = verifyIdentity(candidate, targetPattern, identityContext);
  if (identity === "CORRECT_TARGET" || identity === "UNKNOWN_IDENTITY") {
    return {
      kind: "resolved",
      success: {
        strategy,
        selector,
        similarity: similarity.total,
        identity,
        candidateCount: 1,
        attributesUsed,
        attributesRemoved,
      },
      evidence: makeEvidence(strategy, {
        selector,
        candidatesFound: 1,
        candidatesAboveThreshold: 1,
        bestSimilarity: similarity.total,
        attributesUsed,
        attributesRemoved,
        outcome: "resolved",
        reason: successReason,
      }),
    };
  }
  return {
    kind: "wrong-target",
    selector,
    similarity: similarity.total,
    evidence: makeEvidence(strategy, {
      selector,
      candidatesFound: 1,
      attributesRemoved,
      outcome: "wrong-target",
      reason: "selector resolved uniquely, but not to the target",
    }),
  };
}

// ---------------------------------------------------------------------------
// Strategy 3 — checkSimplifyNth (Step 5.3)
//
// Relaxes ordering: builds a selector using the target's tag (plus any
// stable/partial attribute it has) WITHOUT any nth-of-type qualifier,
// scoped by ancestor context also built without positional pinning. This
// is the strategy that recovers from sibling reordering/insertion/removal
// when the element's non-positional identity is still meaningful — it
// never blindly picks the first of several matches; ties are ranked by
// structural similarity like every multi-candidate strategy here.
// ---------------------------------------------------------------------------

interface LeafFragment {
  fragment: string;
  usedAttribute: string | null;
}

function relaxedLeafFragment(
  pattern: ElementPattern,
  config: DesConfig,
): LeafFragment {
  const stable = stableFragmentsOf(pattern, config)[0];
  if (stable)
    return {
      fragment: `${pattern.tag}${stable.fragment}`,
      usedAttribute: stable.name,
    };
  const partial = partialFragmentsOf(pattern, config)[0];
  if (partial)
    return {
      fragment: `${pattern.tag}${partial.fragment}`,
      usedAttribute: partial.name,
    };
  return { fragment: pattern.tag, usedAttribute: null };
}

function checkSimplifyNth(
  root: ParentNode,
  path: ElementPath,
  config: DesConfig,
  identityContext: IdentityContext,
): StrategyOutcome {
  const targetPattern = path.target.pattern;
  const leaf = relaxedLeafFragment(targetPattern, config);
  // `path.ancestors` is innermost-first (direct parent first) — a CSS
  // descendant selector needs outermost-first, so the ancestor slice is
  // reversed on its own before the (already-innermost) leaf is appended.
  const ancestorFragments = path.ancestors
    .map((a) => relaxedLeafFragment(a.pattern, config))
    .reverse();
  const selector = [
    ...ancestorFragments.map((f) => f.fragment),
    leaf.fragment,
  ].join(" ");
  const ancestorAttributesUsed = ancestorFragments
    .filter((f) => f.usedAttribute)
    .map((f) => f.usedAttribute!);

  const result = safeQuery(root, selector);
  if (!result || result.matches.length === 0) {
    return {
      kind: "inconclusive",
      evidence: makeEvidence("checkSimplifyNth", {
        selector,
        outcome: "no-candidates",
        reason: "no match once nth-of-type/order was relaxed",
      }),
    };
  }
  // An ancestor's stable attribute is real context recovery regardless of
  // match count — that is this strategy's whole point (climb to a stable
  // ancestor, then let ranking pick among its children). The LEAF's own
  // attribute only genuinely "resolved" this when it was already unique
  // among the matches; once ranking had to pick a winner among several
  // candidates sharing that same leaf attribute, structural similarity
  // (which folds in order) did the real disambiguating work, so crediting
  // the shared leaf attribute would overstate how this was resolved.
  const leafAttributeUsed =
    result.matches.length === 1 && leaf.usedAttribute
      ? [leaf.usedAttribute]
      : [];
  const attributesUsed = [...ancestorAttributesUsed, ...leafAttributeUsed];

  const { candidates, capped } = buildCandidates(
    root,
    result.matches,
    targetPattern,
    config,
    200,
    identityContext,
  );
  const decision = rankAndClassify(
    candidates,
    config,
    identityContext,
    targetPattern,
  );
  const evidenceBase = {
    selector,
    candidatesFound: result.matches.length,
    candidatesAboveThreshold: candidates.filter(
      (c) => c.similarity.total >= config.similarityThreshold,
    ).length,
    bestSimilarity: candidates[0]?.similarity.total ?? null,
    attributesUsed,
  };

  if (decision.decision === "resolved") {
    return {
      kind: "resolved",
      success: {
        strategy: "checkSimplifyNth",
        selector,
        similarity: decision.candidate.similarity.total,
        identity: decision.identity,
        candidateCount: result.matches.length,
        attributesUsed,
        attributesRemoved: [],
      },
      evidence: makeEvidence("checkSimplifyNth", {
        ...evidenceBase,
        outcome: "resolved",
        reason: `order relaxed; unique high-similarity match recovered${capped ? " (candidate list capped for performance)" : ""}`,
      }),
    };
  }
  if (decision.decision === "wrong-target") {
    return {
      kind: "wrong-target",
      selector,
      similarity: decision.candidate.similarity.total,
      evidence: makeEvidence("checkSimplifyNth", {
        ...evidenceBase,
        outcome: "wrong-target",
        reason: "the best-ranked candidate is not the target",
      }),
    };
  }
  return {
    kind: "inconclusive",
    evidence: makeEvidence("checkSimplifyNth", {
      ...evidenceBase,
      outcome:
        decision.decision === "ambiguous" ? "ambiguous" : "below-threshold",
      reason:
        decision.decision === "ambiguous"
          ? decision.reason
          : "no candidate reached the similarity threshold",
    }),
  };
}

// ---------------------------------------------------------------------------
// Strategy 4 — checkContainers (Step 5.4)
//
// Progressively simplifies the ancestor chain: drops the FARTHEST ancestor
// first (least likely to be load-bearing for identity), then the next,
// trying a direct-child combinator before relaxing to a descendant
// combinator at each length. Stops at the first length/combinator that
// resolves uniquely to a correctly-identified target — never broadens
// further than necessary.
// ---------------------------------------------------------------------------

function checkContainers(
  root: ParentNode,
  path: ElementPath,
  config: DesConfig,
  identityContext: IdentityContext,
): StrategyOutcome {
  const targetPattern = path.target.pattern;
  const leaf = relaxedLeafFragment(targetPattern, config);
  const leafWithOrder = `${leaf.fragment}:nth-of-type(${targetPattern.order.nthOfType})`;

  for (let keep = path.ancestors.length; keep >= 0; keep--) {
    const keptAncestors = path.ancestors
      .slice(0, keep)
      .map((a) => relaxedLeafFragment(a.pattern, config))
      .reverse();
    const ancestorAttributesUsed = keptAncestors
      .filter((f) => f.usedAttribute)
      .map((f) => f.usedAttribute!);
    // Try the plain (no nth) leaf first: if THAT alone is what resolves it,
    // the attribute genuinely did the disambiguating work. Only fall back
    // to the nth-of-type-augmented variant when the plain one isn't
    // unique — and when nth is what actually made the difference, report
    // it as positional (no attributesUsed), never as if a shared
    // attribute (e.g. an id duplicated across every row of a template)
    // had meaningfully identified the element on its own.
    const leafVariants: Array<{ selector: string; attributesUsed: string[] }> =
      [
        {
          selector: leaf.fragment,
          attributesUsed: leaf.usedAttribute ? [leaf.usedAttribute] : [],
        },
        { selector: leafWithOrder, attributesUsed: [] },
      ];
    for (const combinator of [" > ", " "] as const) {
      for (const variant of leafVariants) {
        const kept = keptAncestors.map((f) => f.fragment);
        const selector =
          kept.length > 0
            ? `${kept.join(combinator)}${combinator}${variant.selector}`
            : variant.selector;
        const outcome = evaluateUniqueSelector(
          root,
          selector,
          targetPattern,
          config,
          identityContext,
          "checkContainers",
          [...ancestorAttributesUsed, ...variant.attributesUsed],
          [],
          `resolved with ${kept.length} ancestor level(s) kept, ${combinator === " > " ? "direct-child" : "descendant"} relationship`,
        );
        if (outcome.kind === "resolved") return outcome;
        if (
          outcome.kind === "wrong-target" &&
          kept.length === 0 &&
          combinator === " "
        ) {
          // Exhausted every attribute-based simplification level — fall
          // through to the pure positional chain below rather than giving
          // up (a wrong-target here doesn't mean position can't recover
          // it; see the fully-duplicated-siblings fixture this guards).
          break;
        }
      }
    }
  }

  // Last resort: every level of every attribute-based simplification
  // failed (typically because every candidate is structurally identical,
  // e.g. repeated rows built from a template with duplicated ids/classes
  // at every level) — fall back to the full nth-of-type chain through
  // every ancestor. This is reported with NO attributesUsed, which is
  // what marks it as genuinely positional-only, not contextual.
  const positionalAncestors = path.ancestors
    .map((a) => `${a.pattern.tag}:nth-of-type(${a.pattern.order.nthOfType})`)
    .reverse();
  const positionalLeaf = `${targetPattern.tag}:nth-of-type(${targetPattern.order.nthOfType})`;
  const positionalSelector = [...positionalAncestors, positionalLeaf].join(
    " > ",
  );
  const positionalOutcome = evaluateUniqueSelector(
    root,
    positionalSelector,
    targetPattern,
    config,
    identityContext,
    "checkContainers",
    [],
    [],
    "resolved via the full nth-of-type ancestor chain — every candidate was otherwise structurally identical",
  );
  if (
    positionalOutcome.kind === "resolved" ||
    positionalOutcome.kind === "wrong-target"
  ) {
    return positionalOutcome;
  }

  return {
    kind: "inconclusive",
    evidence: makeEvidence("checkContainers", {
      outcome: "no-candidates",
      reason:
        "no ancestor-simplification level, attribute-based or positional, resolved uniquely to the target",
    }),
  };
}

// ---------------------------------------------------------------------------
// Strategy 5 — checkDirectElement (Step 5.5)
//
// Last resort: no ancestor context at all. Uses only the target's own
// pattern, broadening by dropping up to two of its weakest (lowest
// Attribute-Priority) identifying fragments if the fully-specific version
// matches nothing, then ranks EVERY match by structural similarity — this
// strategy must never simply take the first candidate; see
// `rankAndClassify`.
// ---------------------------------------------------------------------------

const DIRECT_ELEMENT_CANDIDATE_CEILING = 500;

function checkDirectElement(
  root: ParentNode,
  path: ElementPath,
  config: DesConfig,
  identityContext: IdentityContext,
): StrategyOutcome {
  const targetPattern = path.target.pattern;
  const fragments = [
    ...stableFragmentsOf(targetPattern, config),
    ...partialFragmentsOf(targetPattern, config),
  ];

  const attempts: Array<{ selector: string; dropped: string[] }> = [];
  if (fragments.length > 0) {
    attempts.push({
      selector: `${targetPattern.tag}${fragments.map((f) => f.fragment).join("")}`,
      dropped: [],
    });
  }
  const maxDrop = Math.min(2, fragments.length);
  for (let drop = 1; drop <= maxDrop; drop++) {
    const kept = fragments.slice(0, fragments.length - drop);
    const dropped = fragments.slice(fragments.length - drop).map((f) => f.name);
    attempts.push({
      selector:
        kept.length > 0
          ? `${targetPattern.tag}${kept.map((f) => f.fragment).join("")}`
          : targetPattern.tag,
      dropped,
    });
  }
  attempts.push({
    selector: targetPattern.tag,
    dropped: fragments.map((f) => f.name),
  });

  for (const attempt of attempts) {
    const result = safeQuery(root, attempt.selector);
    if (!result || result.matches.length === 0) continue;

    const { candidates, capped } = buildCandidates(
      root,
      result.matches,
      targetPattern,
      config,
      DIRECT_ELEMENT_CANDIDATE_CEILING,
      identityContext,
    );
    const decision = rankAndClassify(
      candidates,
      config,
      identityContext,
      targetPattern,
    );
    const evidenceBase = {
      selector: attempt.selector,
      candidatesFound: result.matches.length,
      candidatesAboveThreshold: candidates.filter(
        (c) => c.similarity.total >= config.similarityThreshold,
      ).length,
      bestSimilarity: candidates[0]?.similarity.total ?? null,
      attributesRemoved: attempt.dropped,
    };

    if (decision.decision === "resolved") {
      return {
        kind: "resolved",
        success: {
          strategy: "checkDirectElement",
          selector: attempt.selector,
          similarity: decision.candidate.similarity.total,
          identity: decision.identity,
          candidateCount: result.matches.length,
          attributesUsed: fragments
            .filter((f) => !attempt.dropped.includes(f.name))
            .map((f) => f.name),
          attributesRemoved: attempt.dropped,
        },
        evidence: makeEvidence("checkDirectElement", {
          ...evidenceBase,
          outcome: "resolved",
          reason: `broad search ranked by structural similarity; unique top candidate cleared the threshold${capped ? ` (capped at ${DIRECT_ELEMENT_CANDIDATE_CEILING} candidates for performance)` : ""}`,
        }),
      };
    }
    if (decision.decision === "ambiguous") {
      return {
        kind: "inconclusive",
        evidence: makeEvidence("checkDirectElement", {
          ...evidenceBase,
          outcome: "ambiguous",
          reason: decision.reason,
        }),
      };
    }
    if (decision.decision === "wrong-target") {
      return {
        kind: "wrong-target",
        selector: attempt.selector,
        similarity: decision.candidate.similarity.total,
        evidence: makeEvidence("checkDirectElement", {
          ...evidenceBase,
          outcome: "wrong-target",
          reason: "the best-ranked candidate is not the target",
        }),
      };
    }
    // below-threshold — keep broadening to the next attempt.
  }

  return {
    kind: "inconclusive",
    evidence: makeEvidence("checkDirectElement", {
      outcome: "below-threshold",
      reason:
        "no candidate at any broadening level reached the similarity threshold",
    }),
  };
}

// ---------------------------------------------------------------------------
// Main entry point (Step 14) — runs the five strategies in order, stopping
// at the first genuine RESOLVED, and otherwise classifying the aggregated
// evidence into AMBIGUOUS / WRONG_TARGET / NOT_RESOLVED.
// ---------------------------------------------------------------------------

export interface RunDesOptions {
  /** Ground-truth target to verify against when `target` is a stored `ElementPath` with no live element (cross-snapshot recovery testing — Step 9). Never used/available in real production single-snapshot resolution. */
  groundTruthTarget?: Element;
  /** A previously-captured `computeIdentityFingerprint` value to verify a cross-snapshot recovery against, per the Phase 1 "never rely on object identity across snapshots" model — the production-realistic counterpart to `groundTruthTarget`. */
  expectedFingerprint?: string;
  /** Short-circuits to INACCESSIBLE with this reason — set by a caller that already knows the target lives behind a boundary DES cannot search (a closed shadow root, a cross-origin frame) rather than letting the query silently find nothing. */
  inaccessibleReason?: string;
}

const STRATEGIES: Array<
  (
    root: ParentNode,
    path: ElementPath,
    config: DesConfig,
    identityContext: IdentityContext,
  ) => StrategyOutcome
> = [
  checkInitialPath,
  checkSimplifyDynamic,
  checkSimplifyNth,
  checkContainers,
  checkDirectElement,
];

/**
 * Deliberately NOT `value instanceof Element`: an element from a different
 * frame/document has its own realm's `Element` constructor, and
 * `instanceof` across realms is unreliable (exactly the cross-frame
 * situation this engine must handle correctly — see the frame-isolation
 * tests). `nodeType` is a plain data property, safe across realms.
 */
function isLiveElementNode(value: Element | ElementPath): value is Element {
  return (
    typeof value === "object" && (value as { nodeType?: number }).nodeType === 1
  );
}

/**
 * Run the full DES pipeline for one target against `root` (a `Document` or
 * an open `ShadowRoot` — never reach into a different frame's document or
 * a closed shadow root; pass `inaccessibleReason` instead when the caller
 * already knows that boundary applies).
 */
export function runDes(
  root: ParentNode,
  target: Element | ElementPath,
  config: DesConfig = DEFAULT_DES_CONFIG,
  options: RunDesOptions = {},
): DesResult {
  if (options.inaccessibleReason) {
    return {
      outcome: "INACCESSIBLE",
      reason: options.inaccessibleReason,
      attempts: [],
    };
  }

  const path: ElementPath = isLiveElementNode(target)
    ? buildElementPath(target, config)
    : target;
  const identityContext: IdentityContext = {
    liveTarget: isLiveElementNode(target) ? target : options.groundTruthTarget,
    expectedFingerprint: options.expectedFingerprint,
  };

  const attempts: StrategyAttemptEvidence[] = [];
  let sawWrongTarget: {
    strategy: DesStrategyName;
    selector: string;
    similarity: number;
  } | null = null;
  let sawAmbiguous: {
    selector: string | null;
    candidateCount: number;
    reason: string;
  } | null = null;
  let bestSimilaritySeen: number | null = null;

  for (const strategy of STRATEGIES) {
    const outcome = strategy(root, path, config, identityContext);
    attempts.push(outcome.evidence);
    if (outcome.evidence.bestSimilarity != null) {
      bestSimilaritySeen = Math.max(
        bestSimilaritySeen ?? 0,
        outcome.evidence.bestSimilarity,
      );
    }

    if (outcome.kind === "resolved") {
      return {
        outcome: "RESOLVED",
        strategy: outcome.success.strategy,
        selector: outcome.success.selector,
        similarity: outcome.success.similarity,
        identity: outcome.success.identity,
        candidateCount: outcome.success.candidateCount,
        attributesUsed: outcome.success.attributesUsed,
        attributesRemoved: outcome.success.attributesRemoved,
        attempts,
      };
    }
    if (
      outcome.kind === "wrong-target" &&
      (!sawWrongTarget || outcome.similarity > sawWrongTarget.similarity)
    ) {
      sawWrongTarget = {
        strategy: outcome.evidence.strategy,
        selector: outcome.selector,
        similarity: outcome.similarity,
      };
    }
    if (outcome.evidence.outcome === "ambiguous") {
      sawAmbiguous = {
        selector: outcome.evidence.selector,
        candidateCount: outcome.evidence.candidatesFound,
        reason: outcome.evidence.reason,
      };
    }
  }

  // A confident unique-but-wrong match is stronger, more specific evidence
  // than a vague "ambiguous" from an earlier, less-refined attempt — it
  // wins when both occurred across the five strategies.
  if (sawWrongTarget) {
    return {
      outcome: "WRONG_TARGET",
      strategy: sawWrongTarget.strategy,
      selector: sawWrongTarget.selector,
      similarity: sawWrongTarget.similarity,
      reason:
        "every strategy that found a unique match resolved to the wrong element",
      attempts,
    };
  }
  if (sawAmbiguous) {
    return {
      outcome: "AMBIGUOUS",
      selector: sawAmbiguous.selector,
      candidateCount: sawAmbiguous.candidateCount,
      similarity: bestSimilaritySeen,
      reason: sawAmbiguous.reason,
      attempts,
    };
  }
  return {
    outcome: "NOT_RESOLVED",
    bestSimilarity: bestSimilaritySeen,
    failureReason:
      "no strategy produced a selector that uniquely and correctly identified the target",
    attempts,
  };
}

/**
 * Cross-snapshot recovery (Step 9): given a target's `ElementPath` as
 * captured in an earlier snapshot, attempt to recover it in a (possibly
 * different) live document — never via JavaScript object identity across
 * snapshots. Callers doing genuine production re-verification pass
 * `expectedFingerprint` (computed once from the original live target);
 * callers writing a controlled test that still has the "new" ground-truth
 * element in hand may pass `groundTruthTarget` instead for a stronger
 * assertion. This is `runDes` with no live element of its own — see there
 * for the full pipeline.
 */
export function recoverElementFromPath(
  root: ParentNode,
  storedPath: ElementPath,
  config: DesConfig = DEFAULT_DES_CONFIG,
  options: Pick<
    RunDesOptions,
    "groundTruthTarget" | "expectedFingerprint"
  > = {},
): DesResult {
  return runDes(root, storedPath, config, options);
}
