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

import { composedText } from "./composed-tree.js";
import {
  buildElementPath,
  buildElementPattern,
  type ElementPath,
  type ElementPattern,
  type FindResult,
  findElement,
  generateMinimalSelector,
  type MinimalSelectorResult,
  pathToSelector,
} from "./des-engine.js";
import {
  ELEMENT_REF_VERSION,
  type ElementRef,
  resolveHostChain,
  SHADOW_BOUNDARY,
  shadowHostChain,
  toElementRef,
} from "./element-ref.js";
import {
  type DesConfig,
  isValueDynamic,
} from "./health-attribute-classification.js";
import {
  AUDIT_DES_CONFIG,
  normalizeAttributeName,
  withDuplicateIdsIgnored,
} from "./health-audit-profile.js";
import { fnv1a } from "./health-state-signature.js";
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
  /**
   * The real Apty-style path captured for this element at THIS state — the
   * exact thing a caller must store and later REPLAY (via
   * `verifyStoredElementPath`) against a later state's live DOM to validate
   * cross-state stability. Null only for `INACCESSIBLE` (no path was ever
   * built because the element lives behind a boundary this engine cannot
   * search).
   */
  elementPath: ElementPath | null;
}

/** An element resolved across its shadow hosts (`resolveInComposedTree`). */
export interface ComposedElementResolution extends ElementResolution {
  /** Root-aware reference for replay at another state; null when any hop was INACCESSIBLE. */
  elementRef: ElementRef | null;
  /** How many shadow roots the element sits inside (0 for the document's own tree). */
  shadowDepth: number;
}

export interface ResolveElementOptions {
  /**
   * Optionally bounds how many ancestor levels the engine may climb while
   * building the element's path. Left unset by default (unbounded, the
   * full path to the scope root / `document.body`) — the real Apty
   * algorithm has no depth cap of its own (`buildElementPath` walks to
   * `document.body`, or a configured `scopeRootSelectors` container), and
   * an earlier version of this adapter capped this at 4 as its own
   * "safety bound" — that cap was never derived from real Apty behavior,
   * and truncating the path here before `findElement` ever sees it could
   * cause this adapter to report failure/positional-fallback for an
   * element real Apty could resolve by climbing further. Only set this
   * when a caller has a specific reason to bound the search (e.g. a perf
   * ceiling on a pathologically deep DOM).
   */
  maxAncestorDepth?: number;
  /** Short-circuits to INACCESSIBLE with this reason — set by a caller that already knows the target lives behind a boundary this engine cannot search (a closed shadow root, a cross-origin frame). */
  inaccessibleReason?: string;
  /** Real Apty Studio Ignore Selector / Partial Selector / Attribute Priority configuration, when a caller has it — merged over `AUDIT_DES_CONFIG`. Absent this, DOM Health uses the Agent's audit profile: Apty's real defaults (`health-attribute-classification.ts`) extended through their own hooks (`health-audit-profile.ts`). */
  desConfig?: Partial<DesConfig>;
  /** Id values shared by more than one element in `root`; `id` is not used for them (`withDuplicateIdsIgnored`). */
  duplicateIdsFor?: (root: ParentNode) => ReadonlySet<string> | undefined;
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
 * for elements inside a shadow tree (open, or closed when reached through
 * `shadowRootOf`), and never a different frame's document.
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
      elementPath: null,
    };
  }

  const baseConfig: DesConfig = { ...AUDIT_DES_CONFIG, ...options.desConfig };
  const duplicateIds = options.duplicateIdsFor?.(root);
  const config = duplicateIds?.size
    ? withDuplicateIdsIgnored(baseConfig, duplicateIds)
    : baseConfig;
  const fullPath = buildElementPath(el, config);
  // Faithful to real Apty: no depth cap unless the caller explicitly asks
  // for one (see `ResolveElementOptions.maxAncestorDepth`'s doc comment).
  const path =
    options.maxAncestorDepth === undefined
      ? fullPath
      : fullPath.slice(
          Math.max(0, fullPath.length - 1 - options.maxAncestorDepth),
        );

  const result = findElement(path, root, config);
  const leafInfo = leafAttributeNames(path[path.length - 1]!);
  const winningMatchCount =
    result.attemptsEvidence.find((a) => a.strategy === result.strategy)
      ?.candidatesFound ?? 0;

  const base = {
    dynamicAttributeNames: leafInfo.dynamic,
    stableAttributeNames: leafInfo.stable,
    elementPath: path,
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
 * likely to be regenerated by a framework on rerender), its stable class
 * tokens, its `nth-child` position, and which Angular encapsulation
 * attributes it carries with their per-build number removed — never
 * single-attribute, and never live object identity across snapshots. Built
 * with the audit profile, so a state class (`fe_is-disabled`) or a build
 * number (`_ngcontent-ng-c1137233439`) never splits one control into two.
 */
export function computeElementFingerprint(el: Element): string {
  const pattern = buildElementPattern(el, AUDIT_DES_CONFIG);
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
  const encapsulation = Array.from(el.attributes)
    .map((attribute) => normalizeAttributeName(attribute.name))
    .filter((name) => name.endsWith("-*"))
    .sort()
    .join(",");
  const nthChild =
    pattern.pseudo.find((p) => p.name === "nth-child")?.value ?? "";
  return [
    pattern.tag,
    stableSignature,
    stableClasses,
    nthChild,
    encapsulation,
  ].join("||");
}

/**
 * `computeElementFingerprint` for the element and every shadow host above
 * it, outermost first. Identical controls in sibling shadow roots (each
 * Infor IDS menu item renders its own `a[role="menuitemradio"]`) only
 * differ in their hosts, so without them every such control collides and is
 * reported AMBIGUOUS.
 */
export function computeComposedFingerprint(el: Element): string {
  return [...shadowHostChain(el), el]
    .map(computeElementFingerprint)
    .join(SHADOW_BOUNDARY);
}

/** Worst first: a combined verdict is never better than its weakest hop. */
const OUTCOME_SEVERITY: Record<SelectorResolutionOutcome, number> = {
  DIRECT_SUCCESS: 0,
  RECOVERED_BY_IGNORE: 1,
  RECOVERED_BY_PARTIAL: 2,
  RECOVERED_BY_CONTEXT: 3,
  POSITIONAL_ONLY: 4,
  AMBIGUOUS: 5,
  WRONG_TARGET: 6,
  NOT_RESOLVED: 7,
  INACCESSIBLE: 8,
};

/**
 * Resolve `el` the way it would have to be found from the top of its
 * document: each shadow host in its own root, then the element in the
 * innermost root. The outcome is the weakest hop's, so a control that is
 * unique only inside a one-element shadow root (68 of 74 interactive
 * elements in the Infor LN export sit in shadow roots) is not reported as a
 * direct hit when its host can only be found by position. `bestSelector`
 * joins the hops with ` >>> ` and is diagnostic text for shadow elements.
 * `hostCache` memoizes host resolutions across the elements of one
 * collection, since many controls share their hosts.
 */
export function resolveInComposedTree(
  el: Element,
  options: ResolveElementOptions = {},
  hostCache: Map<Element, ElementResolution> = new Map(),
  frameKey = "",
): ComposedElementResolution {
  const hosts = shadowHostChain(el);
  const hostResolutions = hosts.map((host) => {
    const cached = hostCache.get(host);
    if (cached) return cached;
    const resolution = resolveElement(
      host.getRootNode() as ParentNode,
      host,
      options,
    );
    hostCache.set(host, resolution);
    return resolution;
  });
  const own = resolveElement(el.getRootNode() as ParentNode, el, options);
  if (hosts.length === 0) {
    return {
      ...own,
      elementRef: own.elementPath
        ? {
            version: ELEMENT_REF_VERSION,
            hostChain: [],
            path: own.elementPath,
            frameKey,
          }
        : null,
      shadowDepth: 0,
    };
  }

  const all = [...hostResolutions, own];
  const weakest = all.reduce((worst, next) =>
    OUTCOME_SEVERITY[next.outcome] > OUTCOME_SEVERITY[worst.outcome]
      ? next
      : worst,
  );
  const selectors = all.map((r) => r.bestSelector);
  const paths = all.map((r) => r.elementPath);
  return {
    ...own,
    outcome: weakest.outcome,
    strategy: weakest.strategy,
    winningAttribute: weakest === own ? own.winningAttribute : null,
    usesPositionalSelector: all.some((r) => r.usesPositionalSelector),
    bestSelector: selectors.every((sel) => sel !== null)
      ? selectors.join(SHADOW_BOUNDARY)
      : null,
    elementRef: paths.every((path) => path !== null)
      ? {
          version: ELEMENT_REF_VERSION,
          hostChain: paths.slice(0, -1) as ElementPath[],
          path: paths[paths.length - 1] as ElementPath,
          frameKey,
        }
      : null,
    shadowDepth: hosts.length,
  };
}

export type CrossStateVerdict =
  | "DIRECT_STABLE"
  | "RECOVERED_STABLE"
  | "POSITIONAL_STABLE"
  | "WRONG_TARGET"
  | "NOT_RESOLVED"
  | "AMBIGUOUS"
  /** A shadow host on the way to the element could not be found (or no longer has a shadow root): reported with the hop and its selector. */
  | "HOST_NOT_RESOLVED";

export interface CrossStateVerification {
  verdict: CrossStateVerdict;
  /** The live element the stored path actually resolved to now, when found at all — populated even for WRONG_TARGET so a caller can inspect what it found. */
  element: Element | null;
  selector: string | null;
}

/**
 * The GOOD cross-state validation pattern (as opposed to the BAD pattern of
 * regenerating a fresh selector at the new state and comparing it to the
 * old one): replay a `ElementPath` CAPTURED at a previous state against the
 * CURRENT live DOM, via the exact same, unmodified real DES `findElement`
 * recovery pipeline used for same-snapshot resolution (`checkInitialPath`
 * then the four real relaxation strategies) — never a second, independent
 * generation of a selector from the current DOM.
 *
 * Verdict is derived entirely from real evidence already produced by
 * `findElement`/`generateMinimalSelector`/`computeElementFingerprint` —
 * no new heuristics are introduced here:
 * - `NOT_RESOLVED`: the stored path resolved to nothing live right now.
 * - `WRONG_TARGET`: it resolved to SOME element, but that element's logical
 *   fingerprint does not match the one captured with the path — checked
 *   BEFORE the near-tie check, mirroring `resolveElement`'s own ordering
 *   (a wrong target is a failure regardless of how confident the match was).
 * - `AMBIGUOUS`: the correct element was found, but the ranked candidate
 *   pool was a near-tie (`detectNearTie`) — a thin margin that could
 *   plausibly flip on a small unrelated DOM change.
 * - `DIRECT_STABLE` / `RECOVERED_STABLE` / `POSITIONAL_STABLE`: the correct
 *   element was found, distinguished by which real strategy `findElement`
 *   needed — `checkInitialPath` alone vs. one of the three attribute-level
 *   relaxations vs. `leafFieldCombinations` (positional-only fallback).
 */
export function verifyStoredElementPath(
  root: ParentNode,
  storedPath: ElementPath,
  expectedFingerprint: string,
  config: DesConfig = AUDIT_DES_CONFIG,
): CrossStateVerification {
  const result = findElement(storedPath, root, config);

  if (result.element === null) {
    return { verdict: "NOT_RESOLVED", element: null, selector: null };
  }

  const minimal = generateMinimalSelector(result.element, root, config);
  const selector = minimal?.selector ?? pathToSelector(storedPath);

  if (!fingerprintMatches(result.element, expectedFingerprint)) {
    return { verdict: "WRONG_TARGET", element: result.element, selector };
  }

  if (detectNearTie(result, config)) {
    return { verdict: "AMBIGUOUS", element: result.element, selector };
  }

  if (result.strategy === "leafFieldCombinations") {
    return { verdict: "POSITIONAL_STABLE", element: result.element, selector };
  }
  if (result.strategy === "checkInitialPath") {
    return { verdict: "DIRECT_STABLE", element: result.element, selector };
  }
  return { verdict: "RECOVERED_STABLE", element: result.element, selector };
}

const HASHED_FINGERPRINT_PREFIX = "h:";

/**
 * The fingerprint a stored sample carries: a hash of
 * `computeComposedFingerprint`, which spells out attribute values and
 * could carry a name or a token out of the frame. Replay hashes the
 * element it finds the same way (`fingerprintMatches`). A 32-bit hash can
 * collide; a collision would let a wrong element pass as the right one,
 * at odds of one in four billion per comparison.
 */
export function hashFingerprint(fingerprint: string): string {
  return `${HASHED_FINGERPRINT_PREFIX}${fnv1a(fingerprint)}`;
}

function fingerprintMatches(element: Element, expected: string): boolean {
  const actual = computeComposedFingerprint(element);
  return expected.startsWith(HASHED_FINGERPRINT_PREFIX)
    ? hashFingerprint(actual) === expected
    : actual === expected;
}

export interface ElementPathReplayResult {
  fingerprint: string;
  verdict: CrossStateVerdict;
  /** For HOST_NOT_RESOLVED: which host hop broke, and that host's own selector. */
  brokenAtHop?: number;
  hostSelector?: string;
  /** The sample predates `ElementRef` (a bare path) and was replayed against the document, which is all it recorded. */
  legacy?: boolean;
}

/**
 * Replay stored samples (each captured at some OTHER application state)
 * against `doc`'s current live DOM, each from the top of the document
 * through its own shadow hosts (`resolveHostChain`), never against
 * `document` alone (defect D-1). A sample in the pre-`ElementRef` shape is
 * migrated by `toElementRef` and flagged `legacy`; one whose ref cannot be
 * read is reported NOT_RESOLVED rather than guessed at.
 */
export function replayElementRefs(
  doc: Document,
  samples: Array<{ fingerprint: string; ref?: unknown; path?: unknown }>,
  config: DesConfig = AUDIT_DES_CONFIG,
): ElementPathReplayResult[] {
  return samples.map((sample) => {
    const migrated = toElementRef(sample);
    if (!migrated) {
      return { fingerprint: sample.fingerprint, verdict: "NOT_RESOLVED" };
    }
    const legacy = migrated.legacy ? { legacy: true } : {};
    const chain = resolveHostChain(migrated.ref, doc, config);
    if (!chain.root) {
      const broken = chain.hops[chain.hops.length - 1]!;
      return {
        fingerprint: sample.fingerprint,
        verdict: "HOST_NOT_RESOLVED",
        brokenAtHop: broken.hop,
        hostSelector: broken.selector,
        ...legacy,
      };
    }
    return {
      fingerprint: sample.fingerprint,
      verdict: verifyStoredElementPath(
        chain.root,
        migrated.ref.path,
        sample.fingerprint,
        config,
      ).verdict,
      ...legacy,
    };
  });
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

function rootOf(el: Element): Document | ShadowRoot {
  return el.getRootNode() as Document | ShadowRoot;
}

/** Whether any id in `ids` names an element with visible text in `el`'s own root (ids do not cross shadow boundaries). */
function labelledByHasText(el: Element, ids: string): boolean {
  const root = rootOf(el);
  return ids
    .split(/\s+/)
    .filter(Boolean)
    .some((id) => {
      const target = root.getElementById(id);
      return Boolean(target && composedText(target));
    });
}

/**
 * Supporting accessibility signal — not a selector-reliability judgment on
 * its own. Follows the parts of the accessible-name computation that
 * matter here across shadow DOM: `aria-labelledby` and `label[for]` are
 * resolved in the element's own root, and text is read in the composed
 * tree, through `<slot>`s. An Infor IDS control renders its `<button>` or
 * `<a>` inside a shadow root while the label stays in the host's light DOM
 * (358 slots in the LN export); its plain `textContent` is empty. `title`
 * is the accessible-name computation's last resort.
 */
export function hasAccessibleName(el: Element): boolean {
  if (el.getAttribute("aria-label")?.trim()) return true;
  const labelledBy = el.getAttribute("aria-labelledby")?.trim();
  if (labelledBy && labelledByHasText(el, labelledBy)) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    if (el.getAttribute("placeholder")?.trim()) return true;
    const id = el.getAttribute("id");
    if (
      id &&
      rootOf(el).querySelector(`label[for="${escapeAttributeValue(id)}"]`)
    ) {
      return true;
    }
    if (el.closest("label")) return true;
    return Boolean(el.getAttribute("title")?.trim());
  }
  if (composedText(el)) return true;
  return Boolean(el.getAttribute("title")?.trim());
}
