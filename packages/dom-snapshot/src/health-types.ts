/**
 * Types for the Apty DOM Health snapshot.
 *
 * This is evidence produced by actually simulating Apty-style element
 * selection in-page (candidate generation, live `querySelectorAll`
 * verification, ignore/partial/contextual recovery, hit testing) — see
 * `health-selector-engine.ts` and `health-hit-test.ts`. The scoring engine
 * in `@apty/browser-runtime` only aggregates/weights numbers that
 * already exist here; it must never re-derive them from raw attribute
 * presence.
 */
import type { ElementRef } from "./element-ref.js";

/** Attributes on an analyzed element — never includes input values. */
import type { ExcludedRootSummary } from "./ignored-roots.js";

export interface DomHealthElementAttributes {
  id?: string;
  /** Space-joined class list, as found on the element. */
  className?: string;
  name?: string;
  role?: string;
  ariaLabel?: string;
  ariaLabelledby?: string;
  /** Every `data-*` attribute found on the element (name without the `data-` prefix), values as-is. */
  dataAttributes: Record<string, string>;
}

export interface DomHealthCounts {
  totalElements: number;
  interactiveElements: number;
  buttons: number;
  inputs: number;
  selects: number;
  textareas: number;
  links: number;
  forms: number;
  contentEditable: number;
}

export interface DomHealthIframeInfo {
  /** Child frame-hosting elements (`<iframe>` AND legacy `<frame>`) owned directly by this document. */
  total: number;
  /**
   * Legacy field, always 0 from this collector going forward.
   *
   * A single document can never determine whether a child frame is
   * accessible by reading its own DOM — that requires actually addressing
   * the child frame's own content-script instance (see `@apty/browser-runtime`'s
   * `frame-tree.ts`/`frame-audit.ts`), which is a browser-extension-level
   * concept, not something this pure-DOM collector can or should attempt.
   * The previous implementation tried `iframe.contentDocument` from the
   * parent's own script, which the browser's same-origin policy blocks for
   * cross-origin frames — and, more importantly, doing so from here could
   * never see a `<frame>` element's content either way, since `<frame>` and
   * `<iframe>` are both separate browsing contexts, not something to reach
   * into from a sibling document's script.
   */
  accessible: number;
  /** Legacy field, always 0 from this collector going forward — see `accessible`. */
  crossOrigin: number;
  /** Honest breakdown of `total` by owning tag — a `<frame>` and an `<iframe>` are both counted in `total`, but this exposes which. */
  byTag: { iframe: number; frame: number };
}

export interface DomHealthShadowDomInfo {
  /** Number of open shadow roots found. Closed shadow roots cannot be detected or inspected — not counted here. */
  roots: number;
  /** Elements found inside open shadow roots (already included in `counts.totalElements`). */
  elements: number;
}

export interface DomHealthZIndexInfo {
  maxZIndex: number;
  /** Count of positioned elements with a z-index at or above the "high" threshold used for overlay-risk scoring. */
  highZIndexElementCount: number;
}

/** Element-universe classification (spec section 4) — mutually exclusive per element, primary population is `interactive`. */
export type ElementClassification =
  | "interactive"
  | "semantic-container"
  | "structural"
  | "decorative"
  | "hidden"
  | "inaccessible"
  | "overlay"
  | "iframe"
  | "shadow-host"
  | "shadow-descendant";

export interface ElementUniverseCounts {
  totalElements: number;
  meaningfulElements: number;
  interactiveElements: number;
  hiddenElements: number;
  inaccessibleElements: number;
  iframeElements: number;
  shadowDomElements: number;
}

/**
 * The outcome of the DES-style selector-resolution pipeline for one
 * element (spec section 17) — the ONLY vocabulary allowed for "did this
 * element get a working selector". "Unique but wrong" and "ambiguous" are
 * never counted as success.
 */
export type SelectorResolutionOutcome =
  | "DIRECT_SUCCESS"
  | "RECOVERED_BY_IGNORE"
  | "RECOVERED_BY_PARTIAL"
  | "RECOVERED_BY_CONTEXT"
  | "POSITIONAL_ONLY"
  | "AMBIGUOUS"
  | "WRONG_TARGET"
  | "NOT_RESOLVED"
  | "INACCESSIBLE";

export type SelectorStrategy =
  | "direct"
  | "ignore"
  | "partial"
  | "context"
  | "positional"
  | "none";

/**
 * A captured, real Apty-style path for one element at THIS state — the
 * building block for cross-APPLICATION-STATE validation (as distinct from
 * cross-SNAPSHOT-of-the-same-state stability, which `StabilityStats`
 * already tracks). A caller (`@apty/browser-runtime`'s `application-audit.ts`)
 * stores a bounded sample of these from one discovered state and REPLAYS
 * them (via `verifyStoredElementPath`, never regenerated) against another
 * discovered state's live DOM, to answer "can a selector/path captured in
 * one application state still resolve correctly when the application
 * changes state" — a materially different, stronger question than same-state
 * volatility. Bounded per snapshot (see `health-collector.ts`'s
 * `MAX_ELEMENT_PATH_SAMPLES`) so the message payload never grows unbounded
 * on a huge page. Never includes an element whose fingerprint collided with
 * another element in the same snapshot (an ambiguous anchor is useless for
 * later identity verification).
 */
export interface ElementPathSample {
  /** `computeComposedFingerprint`: the element and every shadow host above it. */
  fingerprint: string;
  /** Root-aware reference, replayed from the top of the document by `replayElementRefs`. */
  ref: ElementRef;
  tagName: string;
  selector: string | null;
  outcome: SelectorResolutionOutcome;
  /** Which frame this sample was captured in — stamped by the multi-frame aggregator (`@apty/browser-runtime`'s `frame-audit.ts`), same pattern as `ElementSelectorReport.frameId`. Absent on a raw single-frame snapshot straight out of `collectDomHealthSnapshot`. */
  frameId?: number;
}

/**
 * Cross-STATE verdict for one element, from LOGICAL correlation (spec
 * section 18) plus a REAL replay of its previously-captured `ElementPath`
 * against the current live DOM via the unmodified DES `findElement`
 * pipeline (`verifyStoredElementPath` in `health-selector-engine.ts`) —
 * never from array position, never from raw DOM-node identity alone (a
 * framework may replace the node on rerender while the logical control
 * persists; see `computeElementFingerprint`), and never by regenerating a
 * fresh selector at the new state and merely comparing it to the old one
 * (the BAD pattern this replaces: GOOD is capture-at-A, replay-at-B,
 * verify-identity).
 *
 * - UNKNOWN: no prior snapshot exists yet (first snapshot of the audit).
 * - NEW: prior snapshot(s) exist, but no matching logical element was seen before.
 * - DIRECT_STABLE: the stored path still resolves via `checkInitialPath` alone —
 *   the strongest possible cross-state signal, no relaxation needed at all.
 * - RECOVERED_STABLE: the stored path only resolved to the correct element after
 *   one of DES's real relaxation strategies (dropDynamicValues/
 *   dropPositionalPseudo/dropOneAncestor) fired — the control is still correctly
 *   findable, but a literal attribute value changed between states.
 * - POSITIONAL_STABLE: the stored path only resolved via `leafFieldCombinations`
 *   (nth-child/positional fallback) — findable, but on the weakest possible
 *   signal; never treated as equivalent to an attribute-anchored match.
 * - WRONG_TARGET: the stored path resolved to SOME element at the new state, but
 *   its logical fingerprint does not match the originally-captured element — a
 *   unique-but-wrong resolution, always a failure, never folded into "stable".
 * - NOT_RESOLVED: the stored path resolved to nothing at the new state at all.
 * - DETACHED: a previously-tracked logical element has no match now at all
 *   (no candidate for `findElement` to even evaluate).
 * - AMBIGUOUS: two or more distinct elements in THIS snapshot share the same
 *   logical fingerprint, OR the replay landed in a near-tie between two
 *   candidates — correlation cannot safely attribute either one to a
 *   previous entry (or safely anchor a future one), so neither is ever
 *   silently reported stable by first-match. This is a real, reportable
 *   finding (a fingerprint collision or a fragile score margin), not a soft
 *   fallback.
 * - INACCESSIBLE: the element lives behind a boundary this engine cannot
 *   search (closed shadow root, cross-origin frame) — never silently
 *   counted as stable or as a failure.
 */
export type StabilityVerdict =
  | "DIRECT_STABLE"
  | "RECOVERED_STABLE"
  | "POSITIONAL_STABLE"
  | "WRONG_TARGET"
  | "NOT_RESOLVED"
  | "DETACHED"
  | "NEW"
  | "UNKNOWN"
  | "AMBIGUOUS"
  | "INACCESSIBLE";

export type HitTestClassification =
  | "fully-targetable"
  | "partially-targetable"
  | "mostly-occluded"
  | "fully-occluded"
  | "zero-size"
  | "outside-viewport"
  | "hidden";

export interface HitTestResult {
  /** How many of the 9 sampled points (spec section 18) resolved to the element or one of its descendants/ancestors-at-point. */
  pointsPassed: number;
  classification: HitTestClassification;
}

/** Full per-element evidence record — the row shown in the element-level drill-down table. */
export interface ElementSelectorReport {
  tagName: string;
  classification: ElementClassification;
  attributes: DomHealthElementAttributes;
  outcome: SelectorResolutionOutcome;
  strategy: SelectorStrategy;
  /** The selector the engine would actually use, or null when nothing resolved. For an element inside shadow roots, each hop's selector joined with ` >>> `: diagnostic text, not one CSS selector. */
  bestSelector: string | null;
  /** How many shadow roots the element sits inside; its outcome is the weakest of its own and its hosts'. */
  shadowDepth: number;
  /** Live match count for `bestSelector` (0 when nothing resolved, -1 when the selector itself was invalid). */
  matchCount: number;
  /** How many ancestor levels the contextual-recovery strategy had to climb (0 when not used). */
  ancestorDepthUsed: number;
  usesPositionalSelector: boolean;
  dynamicAttributeNames: string[];
  stableAttributeNames: string[];
  /** The attribute the winning candidate was built from (spec section 14's "which attribute won and why"); null for context/positional/unresolved outcomes. */
  winningAttribute: string | null;
  hasAccessibleName: boolean;
  hitTest: HitTestResult | null;
  stability: StabilityVerdict;
  /**
   * Which frame this element was found in — stamped by the multi-frame
   * aggregator (`@apty/browser-runtime`'s `frame-audit.ts`) when it combines
   * several frames' snapshots into one audited state, so an ambiguous or
   * failed element can always be traced back to a real frame. Absent on a
   * raw single-frame snapshot straight out of `collectDomHealthSnapshot`.
   */
  frameId?: number;
  frameUrl?: string;
  /** Stable identity and role of that frame (`frame-identity.ts` in `@apty/browser-runtime`), stamped alongside `frameId`. */
  frameKey?: string;
  frameRole?: "application" | "chrome" | "shim" | "placeholder" | "overlay";
}

/** Identity of the frame a `DomHealthSnapshot` was collected from — set by the caller, never guessed by the collector itself (it only knows its own document, not its place in the tab's frame tree). */
export interface DomHealthFrameIdentity {
  frameId: number;
  url: string;
  parentFrameId: number;
  depth: number;
  /** Stable frame identity from the frame layer, stamped into every `ElementRef` captured in this frame. */
  frameKey?: string;
}

export interface SelectorAnalysisAggregate {
  totalAnalyzed: number;
  directSuccess: number;
  recoveredByIgnore: number;
  recoveredByPartial: number;
  recoveredByContext: number;
  positionalOnly: number;
  ambiguous: number;
  wrongTarget: number;
  notResolved: number;
  inaccessible: number;
}

export interface DynamicAttributeStats {
  idsObserved: number;
  idsDynamicByHeuristic: number;
  /** Real cross-snapshot evidence: same element's id changed value. Requires >=2 snapshots. */
  idsChangedAcrossSnapshots: number;
  classesObserved: number;
  classesDynamicByHeuristic: number;
  classesChangedAcrossSnapshots: number;
  /** True once at least one prior snapshot exists to compare against. */
  hasMultiSnapshotEvidence: boolean;
}

export interface StabilityStats {
  /** Elements that had a resolvable selector/path in a previous state of this same audit and were re-verified now, via a real replay (`verifyStoredElementPath`) — never a re-query of a selector string. */
  trackedFromPrevious: number;
  /** The stored path resolved via `checkInitialPath` alone — the strongest possible cross-state signal. */
  directStable: number;
  /** The stored path only resolved after a real DES relaxation strategy (dropDynamicValues/dropPositionalPseudo/dropOneAncestor) fired — still correctly found, but a literal attribute value changed. */
  recoveredStable: number;
  /** The stored path only resolved via `leafFieldCombinations` (the weakest, most position-dependent fallback) — never treated as equivalent to an attribute-anchored match. */
  positionalStable: number;
  /** The stored path resolved to SOME element, but its logical fingerprint does not match the originally-captured element — a unique-but-wrong resolution, always a failure. */
  wrongTarget: number;
  /** The stored path resolved to nothing at all when replayed against the new state. */
  notResolved: number;
  /** A previously-tracked logical element (by fingerprint) has no match in the current snapshot at all. */
  detached: number;
  /** Present now but not seen (by fingerprint) in any previous snapshot of this audit. */
  new: number;
  unknown: number;
  /** Count of stable-verdict elements where the underlying DOM node object was replaced but the logical fingerprint still matched — evidence the tracker isn't just relying on object identity. */
  nodeReplacedButLogicallyStable: number;
  /** Elements whose logical fingerprint collided with another element in THIS snapshot, OR whose replay landed in a near-tie — correlation could not safely attribute either one, so both are reported here instead of one silently winning "first match". */
  ambiguous: number;
  /** The element lived behind a boundary this engine cannot search at the previous state — never silently counted as stable or as a failure. */
  inaccessible: number;
}

export interface HitTestStats {
  tested: number;
  fullyTargetable: number;
  partiallyTargetable: number;
  mostlyOccluded: number;
  fullyOccluded: number;
  zeroSize: number;
  outsideViewport: number;
  hidden: number;
}

export interface AncestorTraversalStats {
  /** Elements whose best resolution required climbing >=1 ancestor (RECOVERED_BY_CONTEXT). */
  contextualRecoveryCount: number;
  /** Elements requiring a "deep" traversal (>=2 ancestor levels) — evidence of selector complexity, not automatically a failure. */
  deepTraversalCount: number;
  maxAncestorDepthObserved: number;
}

export interface PositionalDependencyStats {
  positionalCount: number;
  /** Of the positional selectors, how many kept resolving correctly when re-verified (requires >=2 snapshots). */
  stableAcrossSnapshots: number;
  changedAcrossSnapshots: number;
}

export interface AccessibilitySignalStats {
  totalInteractive: number;
  missingAccessibleName: number;
}

/**
 * Whether every interactive element found got the full selector-resolution
 * + hit-test pipeline, or whether the runaway-safety ceiling was hit
 * (spec section 6) — `capped` must never be true without `capReason`
 * explaining it, and coverage is reported rather than silently absorbed
 * into the score.
 */
export interface AnalysisCoverage {
  /** Total interactive elements found in the DOM (exact, never sampled). */
  candidatesFound: number;
  /** How many actually received the full pipeline this snapshot. */
  candidatesAnalyzed: number;
  capped: boolean;
  capReason: string | null;
}

export interface DomHealthSnapshot {
  collectedAt: number;
  url: string;
  title: string;
  counts: DomHealthCounts;
  elementUniverse: ElementUniverseCounts;
  /** Every analyzed element (up to `analysisCoverage.candidatesAnalyzed`) — aggregates above/below reflect true totals even when the runaway-safety ceiling was hit. */
  elementReports: ElementSelectorReport[];
  analysisCoverage: AnalysisCoverage;
  selectorAnalysis: SelectorAnalysisAggregate;
  dynamicAttributes: DynamicAttributeStats;
  stability: StabilityStats;
  hitTesting: HitTestStats;
  ancestorTraversal: AncestorTraversalStats;
  positionalDependency: PositionalDependencyStats;
  accessibility: AccessibilitySignalStats;
  iframes: DomHealthIframeInfo;
  shadowDom: DomHealthShadowDomInfo;
  zIndex: DomHealthZIndexInfo;
  /** Which frame this snapshot came from, when the caller knows (see `DomHealthCollectorOptions.frameContext`) — absent for a bare, orchestrator-less call. */
  frame?: DomHealthFrameIdentity | null;
  /** Bounded sample of real Apty-style paths captured this snapshot, for cross-APPLICATION-STATE replay (see `ElementPathSample`'s doc comment) — never used for same-state stability, which `stability` above already covers. */
  elementPathSamples: ElementPathSample[];
  /** Overlays and injected UI left out of every count above (`ignored-roots.ts`), per matcher. */
  excludedRoots: ExcludedRootSummary[];
  duplicateIds: DuplicateIdStats;
}

/**
 * Ids used by more than one element. `id` is unique per root (a document or
 * a shadow root), so only a duplicate within one root breaks `#id`; the
 * page-wide count is reported for comparison. Elements in ignored roots
 * are not counted.
 */
export interface DuplicateIdStats {
  /** Distinct values shared by 2+ elements in the same root. */
  valuesDuplicatedWithinARoot: number;
  /** Distinct values used by 2+ elements anywhere in the document, shadow roots included. */
  valuesDuplicatedPageWide: number;
  /** Elements carrying a value duplicated within their own root; `id` is not used to select them. */
  elementsWithDuplicatedId: number;
  /** Up to 5 of the within-root duplicated values. */
  sampleValues: string[];
}

export interface DomHealthCollectorOptions {
  /**
   * Runaway-safety ceiling on how many interactive elements get the full
   * selector-resolution + hit-test pipeline — NOT a target sample size.
   * Defaults to 4000; a real page is expected to stay far below this. If
   * hit, `analysisCoverage.capped` reports it explicitly rather than the
   * score silently reflecting a partial page.
   */
  maxInteractiveElements?: number;
  /** Caps how many positioned elements get a computed-style z-index/visibility check (perf bound). Defaults to 2000. */
  maxStyleChecks?: number;
  /**
   * Whether this call starts a new audit (clears the in-memory element
   * registry used for cross-snapshot stability tracking) or continues one
   * (compares against elements resolved by a previous call). Defaults to
   * true. The orchestrator (`runDomHealthAudit`) passes `false` for every
   * snapshot after the first in the same audit run.
   */
  freshAudit?: boolean;
  /** Settings entries (`id:prefix`, `class:prefix`, `tag:name`) excluded on top of `DEFAULT_IGNORED_ROOTS`. */
  ignoredRoots?: readonly string[];
  /** Frame identity to stamp onto the resulting snapshot's `frame` field — supplied by the caller (the content script knows its own `sender.frameId` from `chrome.runtime.onMessage`), never computed by this collector. */
  frameContext?: DomHealthFrameIdentity | null;
}
