/**
 * DOM Health's per-element evidence, from the algorithm the Apty 5.x
 * player runs: the selector Studio would store for the element
 * (`apty-selector.ts` `captureSelector`, Apty's `match` + `optimize`) and
 * the player's lookup of it (first rendered match, else the first). The
 * outcome compares what that lookup returns with the element we know is
 * the target. How the selector identifies the element (by one attribute,
 * several, a partial selector, an ancestor or position) comes from the
 * selector itself.
 *
 * The DES path (`des-engine.ts`) is still built for each element: it is
 * the input of Apty's dynamic fallback, which the 5.x player keeps off,
 * and the report uses it only to say what that fallback would do.
 * `WRONG_TARGET`, `AMBIGUOUS` and the other categories are DOM Health's
 * own; Apty's lookup simply returns an element or nothing.
 */

import {
  type AptySelectorFacts,
  captureSelector,
  closedShadowHost,
  playSelection,
} from "./apty-selector.js";
import { composedText } from "./composed-tree.js";
import {
  buildElementPath,
  buildElementPattern,
  type ElementPath,
  type ElementPattern,
  type FindResult,
  findElement,
  isElementRendered,
  resetDesPerformanceCaches,
} from "./des-engine.js";
import {
  ELEMENT_REF_VERSION,
  type ElementRef,
  resolveHostChain,
  SHADOW_BOUNDARY,
  type StoredSelection,
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
  /** The DES path for this element at THIS state (the dynamic fallback's input); null for `INACCESSIBLE`. */
  elementPath: ElementPath | null;
  /** The selector Studio would store for the element in its own root; null for `INACCESSIBLE`. */
  selector: string | null;
  facts: AptySelectorFacts | null;
}

/** An element resolved across its shadow hosts (`resolveInComposedTree`). */
export interface ComposedElementResolution extends ElementResolution {
  /** Root-aware reference for replay at another state; null when any hop was INACCESSIBLE. */
  elementRef: ElementRef | null;
  /** What Studio stores: the element's selector and one per shadow host; null when INACCESSIBLE. */
  selection: StoredSelection | null;
  /** How many shadow roots the element sits inside (0 for the document's own tree). */
  shadowDepth: number;
}

export interface ResolveElementOptions {
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

interface LiveTestResult {
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
 * How a selector that found the right element identifies it. DOM Health's
 * reporting vocabulary, read from the selector Apty would store:
 * position anywhere makes it positional; a configured partial selector
 * part, recovery by partial; an ancestor level or a `:has()` descendant,
 * recovery by context; several conditions on the element's own level,
 * recovery by combining attributes; one condition or the tag alone, direct.
 */
export function classifySelectorFacts(facts: AptySelectorFacts): {
  outcome: SelectorResolutionOutcome;
  strategy: SelectorStrategy;
  winningAttribute: string | null;
} {
  if (facts.positional) {
    return {
      outcome: "POSITIONAL_ONLY",
      strategy: "positional",
      winningAttribute: null,
    };
  }
  const named = facts.leafAttributes.join("+") || null;
  if (facts.partial) {
    return {
      outcome: "RECOVERED_BY_PARTIAL",
      strategy: "partial",
      winningAttribute: named,
    };
  }
  if (facts.levels > 1 || facts.descendant) {
    return {
      outcome: "RECOVERED_BY_CONTEXT",
      strategy: "context",
      winningAttribute: null,
    };
  }
  if (facts.leafConditions > 1) {
    return {
      outcome: "RECOVERED_BY_IGNORE",
      strategy: "ignore",
      winningAttribute: named,
    };
  }
  return {
    outcome: "DIRECT_SUCCESS",
    strategy: "direct",
    winningAttribute: named,
  };
}

function auditConfig(
  root: ParentNode,
  options: ResolveElementOptions,
): DesConfig {
  const baseConfig: DesConfig = { ...AUDIT_DES_CONFIG, ...options.desConfig };
  const duplicateIds = options.duplicateIdsFor?.(root);
  return duplicateIds?.size
    ? withDuplicateIdsIgnored(baseConfig, duplicateIds)
    : baseConfig;
}

function inaccessible(): ElementResolution {
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
    selector: null,
    facts: null,
  };
}

function querySelectorAllSafe(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/**
 * Capture `el`'s selector as Studio would and look it up in `root` (the
 * owner document, or the shadow root `el` lives in) as the player would:
 * `NOT_RESOLVED` when the lookup returns nothing, `WRONG_TARGET` when it
 * returns another element, `AMBIGUOUS` when the right element is returned
 * only because it comes first among several rendered matches; otherwise
 * the way the selector identifies it (`classifySelectorFacts`).
 */
export function resolveElement(
  root: ParentNode,
  el: Element,
  options: ResolveElementOptions = {},
): ElementResolution {
  if (options.inaccessibleReason) return inaccessible();

  const config = auditConfig(root, options);
  const path = buildElementPath(el, config);
  const leafInfo = leafAttributeNames(
    path[path.length - 1] ?? buildElementPattern(el, config),
  );
  const captured = captureSelector(el, config);
  const matches = querySelectorAllSafe(root, captured.selector);
  const rendered = matches.filter(isElementRendered);
  const picked = rendered[0] ?? matches[0] ?? null;

  const base = {
    dynamicAttributeNames: leafInfo.dynamic,
    stableAttributeNames: leafInfo.stable,
    elementPath: path,
    selector: captured.selector,
    facts: captured.facts,
    bestSelector: captured.selector,
    matchCount: matches.length,
    ancestorDepthUsed: Math.max(0, captured.facts.levels - 1),
  };
  if (picked === null) {
    return {
      ...base,
      outcome: "NOT_RESOLVED",
      strategy: "none",
      usesPositionalSelector: false,
      winningAttribute: null,
    };
  }
  if (picked !== el) {
    return {
      ...base,
      outcome: "WRONG_TARGET",
      strategy: "none",
      usesPositionalSelector: captured.facts.positional,
      winningAttribute: null,
    };
  }
  if (rendered.length > 1) {
    return {
      ...base,
      outcome: "AMBIGUOUS",
      strategy: "none",
      usesPositionalSelector: captured.facts.positional,
      winningAttribute: null,
    };
  }
  const classification = classifySelectorFacts(captured.facts);
  return {
    ...base,
    outcome: classification.outcome,
    strategy: classification.strategy,
    usesPositionalSelector: captured.facts.positional,
    winningAttribute: classification.winningAttribute,
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
  if (closedShadowHost(el)) {
    // Apty's picker stops at a closed root's host and its lookup opens
    // hosts through `host.shadowRoot`, so nothing inside can be targeted.
    return {
      ...inaccessible(),
      elementRef: null,
      selection: null,
      shadowDepth: hosts.length,
    };
  }
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
  const all = [...hostResolutions, own];
  const selection: StoredSelection | null =
    own.selector !== null && hostResolutions.every((r) => r.selector !== null)
      ? {
          selector: own.selector,
          shadowRoots: hostResolutions.map((r) => r.selector!),
          positional: all.some((r) => r.facts?.positional ?? false),
        }
      : null;
  const paths = all.map((r) => r.elementPath);
  const elementRef: ElementRef | null = paths.every((path) => path !== null)
    ? {
        version: ELEMENT_REF_VERSION,
        hostChain: paths.slice(0, -1) as ElementPath[],
        path: paths[paths.length - 1] as ElementPath,
        frameKey,
        ...(selection ? { selection } : {}),
      }
    : null;
  if (hosts.length === 0) {
    return { ...own, elementRef, selection, shadowDepth: 0 };
  }

  const weakest = all.reduce((worst, next) =>
    OUTCOME_SEVERITY[next.outcome] > OUTCOME_SEVERITY[worst.outcome]
      ? next
      : worst,
  );
  const composed: ComposedElementResolution = {
    ...own,
    outcome: weakest.outcome,
    strategy: weakest.strategy,
    winningAttribute: weakest === own ? own.winningAttribute : null,
    usesPositionalSelector: all.some((r) => r.usesPositionalSelector),
    bestSelector: selection
      ? [...selection.shadowRoots, selection.selector].join(SHADOW_BOUNDARY)
      : null,
    elementRef,
    selection,
    shadowDepth: hosts.length,
  };
  // The player opens each host with the FIRST match of its selector, not
  // the first rendered one, so a hop can resolve on its own and still
  // send the lookup into another host's root.
  if (
    selection &&
    OUTCOME_SEVERITY[composed.outcome] < OUTCOME_SEVERITY.WRONG_TARGET
  ) {
    const played = playSelection(selection, el.ownerDocument);
    if (played.element !== el) {
      return {
        ...composed,
        outcome: played.element ? "WRONG_TARGET" : "NOT_RESOLVED",
        strategy: "none",
        winningAttribute: null,
      };
    }
  }
  return composed;
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

/** Real Apty's `find()` early-accepts at 0.92; a runner-up within this margin of the winner could take its place after a small, unrelated DOM change. DOM Health's own addition. */
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

/**
 * Legacy replay, for a sample stored before `ElementRef` carried a selection: the stored DES path through `findElement`.
 *
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

  const selector = captureSelector(result.element, config).selector;

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

/**
 * Cross-state replay as the player does it: the selection stored at an
 * earlier state, looked up from the top of `doc` now. `HOST_NOT_RESOLVED`
 * when a shadow host selector found no open root (the lookup then runs
 * against the document, as Apty's does, and found nothing);
 * `NOT_RESOLVED` / `WRONG_TARGET` when the lookup returns nothing or
 * another element (by logical fingerprint); `AMBIGUOUS` when the right
 * element came first among several rendered matches. A correct find is
 * `POSITIONAL_STABLE` when the selector depends on position,
 * `RECOVERED_STABLE` when it matched several elements and only the
 * rendered preference picked the right one, else `DIRECT_STABLE`.
 */
export function verifyStoredSelection(
  doc: Document,
  stored: StoredSelection,
  expectedFingerprint: string,
): CrossStateVerification & { brokenAtHop?: number; hostSelector?: string } {
  const played = playSelection(stored, doc);
  const selector = stored.selector;
  if (!played.element) {
    if (played.brokenHostIndex !== null) {
      return {
        verdict: "HOST_NOT_RESOLVED",
        element: null,
        selector,
        brokenAtHop: played.brokenHostIndex,
        hostSelector: stored.shadowRoots[played.brokenHostIndex],
      };
    }
    return { verdict: "NOT_RESOLVED", element: null, selector };
  }
  if (!fingerprintMatches(played.element, expectedFingerprint)) {
    return { verdict: "WRONG_TARGET", element: played.element, selector };
  }
  if (played.renderedCount > 1) {
    return { verdict: "AMBIGUOUS", element: played.element, selector };
  }
  if (stored.positional) {
    return { verdict: "POSITIONAL_STABLE", element: played.element, selector };
  }
  if (played.matchCount > 1) {
    return { verdict: "RECOVERED_STABLE", element: played.element, selector };
  }
  return { verdict: "DIRECT_STABLE", element: played.element, selector };
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
  resetDesPerformanceCaches();
  return samples.map((sample) => {
    const migrated = toElementRef(sample);
    if (!migrated) {
      return { fingerprint: sample.fingerprint, verdict: "NOT_RESOLVED" };
    }
    const legacy = migrated.legacy ? { legacy: true } : {};
    if (migrated.ref.selection) {
      const verification = verifyStoredSelection(
        doc,
        migrated.ref.selection,
        sample.fingerprint,
      );
      return {
        fingerprint: sample.fingerprint,
        verdict: verification.verdict,
        ...(verification.brokenAtHop !== undefined
          ? {
              brokenAtHop: verification.brokenAtHop,
              hostSelector: verification.hostSelector,
            }
          : {}),
      };
    }
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
