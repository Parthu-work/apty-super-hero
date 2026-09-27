/**
 * Adapter between the real-Apty-faithful DES engine (`des-engine.ts`) and
 * the DOM Health collector's existing per-element evidence shape
 * (`ElementResolution`). `resolveElement` below delegates entirely to
 * `findElement` for the actual resolution decision, so there is exactly
 * one automatic element-selection algorithm in this package.
 *
 * The real Apty `find()` algorithm this delegates to has NO discrete
 * "ambiguous"/"wrong target" state — it is a single ranked candidate pool
 * with a top-1 pick above a score floor (see `des-engine.ts`'s module doc
 * comment). Everything this adapter reports beyond that raw pick —
 * classifying the outcome against KNOWN ground truth (we always know which
 * live element a DOM Health snapshot is asking about) and flagging a thin
 * score margin as a stability risk — is DOM Health's own evidence layer on
 * top of the real algorithm, and is documented as such below; it is never
 * presented as part of Apty's own runtime decision.
 */
import {
  buildElementPath,
  buildElementPattern,
  type ElementPattern,
  type FindResult,
  findElement,
  generateMinimalSelector,
  type MinimalSelectorResult,
  pathToSelector,
} from "./des-engine.js";
import {
  DEFAULT_DES_CONFIG,
  type DesConfig,
  isValueDynamic,
} from "./health-attribute-classification.js";
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
  /** The attribute (e.g. "id", "class") the winning candidate's leaf pattern is anchored on — null when nothing resolved, or when the winning strategy combined enough different signals that naming one attribute would be misleading (context/positional wins report the strategy instead). */
  winningAttribute: string | null;
}

export interface ResolveElementOptions {
  /**
   * Bounds how many ancestor levels the engine may climb while building
   * the element's path. The real Apty algorithm has no such cap (it walks
   * to `document.body`, or a configured `scopeRootSelectors` container);
   * this option is DOM Health's own safety bound, preserved from the
   * previous engine for API compatibility with existing callers. Defaults
   * to 4.
   */
  maxAncestorDepth?: number;
  /** Short-circuits to INACCESSIBLE with this reason — set by a caller that already knows the target lives behind a boundary this engine cannot search (a closed shadow root, a cross-origin frame). */
  inaccessibleReason?: string;
  /** Real Apty Studio Ignore Selector / Partial Selector / Attribute Priority configuration, when a caller has it — merged over `DEFAULT_DES_CONFIG`. Absent this, DOM Health uses Apty's own real defaults (see `health-attribute-classification.ts`), never an invented substitute. */
  desConfig?: Partial<DesConfig>;
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

/** Real Apty's `find()` early-accepts as soon as a rendered candidate clears 0.92, and the runner-up in a ranked pool is rarely more than a couple points behind the winner in a genuinely stable case — a margin this thin, chosen deliberately small so it flags real fragility rather than every ordinary multi-candidate search, means the real algorithm's pick could plausibly flip to a different element from a small, unrelated DOM change. This is DOM Health's own addition; the real algorithm does not branch on it. */
const NEAR_TIE_MARGIN = 0.03;

function detectNearTie(result: FindResult, config: DesConfig): boolean {
  const aboveFloor = result.rankedCandidates.filter(
    (c) => c.score >= config.fallbackAcceptScore,
  );
  if (aboveFloor.length < 2) return false;
  const [top, runnerUp] = aboveFloor;
  return (
    top!.element !== runnerUp!.element &&
    top!.score - runnerUp!.score < NEAR_TIE_MARGIN
  );
}

function leafAttributeNames(pattern: ElementPattern): {
  dynamic: string[];
  stable: string[];
} {
  const dynamic: string[] = [];
  const stable: string[] = [];
  for (const attr of pattern.attributes) {
    (isValueDynamic(attr.value ?? "") ? dynamic : stable).push(attr.name);
  }
  for (const cls of pattern.classes) {
    (isValueDynamic(cls.class) ? dynamic : stable).push("class");
  }
  return { dynamic, stable };
}

/**
 * Classify an already-successful `generateMinimalSelector` result into the
 * legacy outcome vocabulary. This is DOM Health's own reporting layer, not
 * part of the real algorithm: real Apty's `find()` has no such categories
 * (see the module doc comment). The signal used here is genuinely real,
 * though — `minimal.leafPattern`'s attribute `selectionType`s (`"exact"`
 * vs `"prefix"/"suffix"/"partial"`) reflect whether a configured Partial
 * Selector function actually fired for the winning attribute, and
 * `ancestorLevelsUsed`/`attributesUsed.length` reflect the real capture
 * algorithm's own climb/combine behavior.
 */
function classifyMinimalSelector(minimal: MinimalSelectorResult): {
  outcome: SelectorResolutionOutcome;
  strategy: SelectorStrategy;
  winningAttribute: string | null;
} {
  // Checked BEFORE `ancestorLevelsUsed`: a climb whose every level (leaf
  // included) fell back to `nth-child` at every step is still purely
  // positional, even though it took more than one level to become
  // globally unique (e.g. two structurally-identical containers, each
  // with an unlabeled 2nd button — neither the leaf's own position nor
  // its immediate container's is enough alone, but no ATTRIBUTE ever
  // contributed either). Only a climb where some level's own attribute
  // genuinely helped counts as RECOVERED_BY_CONTEXT.
  if (minimal.usesPositionalSelector) {
    return {
      outcome: "POSITIONAL_ONLY",
      strategy: "positional",
      winningAttribute: null,
    };
  }
  if (minimal.ancestorLevelsUsed > 0) {
    return {
      outcome: "RECOVERED_BY_CONTEXT",
      strategy: "context",
      winningAttribute: null,
    };
  }
  const leafUsed = minimal.attributesUsed;
  const usedPartialMatch = minimal.leafPattern.attributes
    .concat(
      minimal.leafPattern.classes.map((c) => ({
        name: "class",
        selectionType: c.selectionType,
      })),
    )
    .some(
      (a) =>
        leafUsed.includes(a.name) &&
        a.selectionType &&
        a.selectionType !== "exact",
    );
  if (usedPartialMatch) {
    return {
      outcome: "RECOVERED_BY_PARTIAL",
      strategy: "partial",
      winningAttribute: leafUsed[0] ?? null,
    };
  }
  if (leafUsed.length > 1) {
    return {
      outcome: "RECOVERED_BY_IGNORE",
      strategy: "ignore",
      winningAttribute: leafUsed.join("+"),
    };
  }
  return {
    outcome: "DIRECT_SUCCESS",
    strategy: "direct",
    winningAttribute: leafUsed[0] ?? null,
  };
}

/**
 * Run the real DES `find()` pipeline for one live element against `root`
 * and adapt it to the legacy `ElementResolution` shape
 * `health-collector.ts` aggregates. `root` is the correct scope to query
 * against — the owner `Document` for ordinary elements, the `ShadowRoot`
 * for elements inside an open shadow tree (never a closed one, and never a
 * different frame's document).
 *
 * Two real algorithms are combined here, each answering a different
 * question: `findElement` (real `find()`) answers "does this resolve to
 * the correct live element at all" — WRONG_TARGET/NOT_RESOLVED/(this
 * package's own AMBIGUOUS risk flag) come from it. `generateMinimalSelector`
 * (real `match()`/`optimize()`) answers "how was it identified" —
 * DIRECT_SUCCESS/RECOVERED_BY_PARTIAL/RECOVERED_BY_IGNORE/
 * RECOVERED_BY_CONTEXT/POSITIONAL_ONLY come from it. Real Apty's own
 * `checkInitialPath` always has `nth-child` baked into its literal
 * captured path (see `des-engine.ts`'s `buildElementPattern`), so "which
 * raw `find()` strategy technically produced the winning candidate" does
 * NOT cleanly distinguish "identified by a stable attribute" from
 * "identified only by position" — `generateMinimalSelector`, which tries
 * non-positional identification first and only falls back to `nth-child`
 * when nothing else works, is the correct instrument for that question.
 */
export function resolveElement(
  root: ParentNode,
  el: Element,
  options: ResolveElementOptions = {},
): ElementResolution {
  if (options.inaccessibleReason) {
    return {
      outcome: "INACCESSIBLE",
      strategy: "none",
      bestSelector: null,
      matchCount: 0,
      ancestorDepthUsed: 0,
      usesPositionalSelector: false,
      dynamicAttributeNames: [],
      stableAttributeNames: [],
      winningAttribute: null,
    };
  }

  const config: DesConfig = { ...DEFAULT_DES_CONFIG, ...options.desConfig };
  const maxAncestorDepth = options.maxAncestorDepth ?? 4;
  const fullPath = buildElementPath(el, config);
  const path = fullPath.slice(
    Math.max(0, fullPath.length - 1 - maxAncestorDepth),
  );

  const result = findElement(path, root, config);
  const leafInfo = leafAttributeNames(path[path.length - 1]!);
  const winningMatchCount =
    result.attemptsEvidence.find((a) => a.strategy === result.strategy)
      ?.candidatesFound ?? 0;

  const base = {
    dynamicAttributeNames: leafInfo.dynamic,
    stableAttributeNames: leafInfo.stable,
  };

  if (result.element === null) {
    return {
      outcome: "NOT_RESOLVED",
      strategy: "none",
      bestSelector: null,
      matchCount: 0,
      ancestorDepthUsed: 0,
      usesPositionalSelector: false,
      winningAttribute: null,
      ...base,
    };
  }

  const minimal = generateMinimalSelector(result.element, root, config);
  const selector = minimal?.selector ?? pathToSelector(path);

  if (result.element !== el) {
    return {
      outcome: "WRONG_TARGET",
      strategy: "none",
      bestSelector: selector,
      matchCount: winningMatchCount,
      ancestorDepthUsed: minimal?.ancestorLevelsUsed ?? 0,
      usesPositionalSelector: false,
      winningAttribute: null,
      ...base,
    };
  }

  if (detectNearTie(result, config)) {
    return {
      outcome: "AMBIGUOUS",
      strategy: "none",
      bestSelector: selector,
      matchCount: winningMatchCount,
      ancestorDepthUsed: minimal?.ancestorLevelsUsed ?? 0,
      usesPositionalSelector: false,
      winningAttribute: null,
      ...base,
    };
  }

  if (!minimal) {
    // Defensive only: `findElement` already proved `el` is live-reachable
    // via SOME selector, so `generateMinimalSelector` (which walks the
    // same DOM) should always succeed too. Never fabricate a stronger
    // outcome than the evidence supports if it somehow doesn't.
    return {
      outcome: "POSITIONAL_ONLY",
      strategy: "positional",
      bestSelector: selector,
      matchCount: winningMatchCount,
      ancestorDepthUsed: 0,
      usesPositionalSelector: true,
      winningAttribute: null,
      ...base,
    };
  }

  const classification = classifyMinimalSelector(minimal);
  return {
    outcome: classification.outcome,
    strategy: classification.strategy,
    bestSelector: selector,
    matchCount:
      classification.outcome === "DIRECT_SUCCESS" ? 1 : winningMatchCount,
    ancestorDepthUsed: minimal.ancestorLevelsUsed,
    usesPositionalSelector: minimal.usesPositionalSelector,
    winningAttribute: classification.winningAttribute,
    ...base,
  };
}

/**
 * A logical fingerprint for cross-snapshot element correlation — tag, a
 * sorted signature of the element's own non-dynamic-looking attributes
 * (real `isValueDynamic`, excluding `id` since it is the attribute most
 * likely to be regenerated by a framework on rerender), and its
 * `nth-child` position — never single-attribute, and never live object
 * identity across snapshots.
 */
export function computeElementFingerprint(el: Element): string {
  const pattern = buildElementPattern(el, DEFAULT_DES_CONFIG);
  const stableSignature = pattern.attributes
    .filter((a) => a.name !== "id" && !isValueDynamic(a.value ?? ""))
    .map((a) => `${a.name}=${a.value ?? ""}`)
    .sort()
    .join(",");
  const stableClasses = pattern.classes
    .filter((c) => !isValueDynamic(c.class))
    .map((c) => c.class)
    .sort()
    .join(",");
  const nthChild =
    pattern.pseudo.find((p) => p.name === "nth-child")?.value ?? "";
  return [pattern.tag, stableSignature, stableClasses, nthChild].join("||");
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

/** Supporting accessibility signal — not a selector-reliability judgment on its own. */
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
