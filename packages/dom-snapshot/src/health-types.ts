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

/** Attributes on an analyzed element — never includes input values. */
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
  total: number;
  /** Same-origin iframes whose document could be traversed. */
  accessible: number;
  /** Iframes whose document could not be read due to the browser's same-origin security boundary — not a DOM defect. */
  crossOrigin: number;
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
 * Cross-snapshot verdict for one element, from LOGICAL correlation (spec
 * section 18) — never from array position, and never from raw DOM-node
 * identity alone (a framework may replace the node on rerender while the
 * logical control persists; see `computeElementFingerprint`).
 *
 * - UNKNOWN: no prior snapshot exists yet (first snapshot of the audit).
 * - NEW: prior snapshot(s) exist, but no matching logical element was seen before.
 * - STABLE: a matching logical element existed before, and its previously-chosen
 *   selector still resolves uniquely to it now (whether or not the underlying
 *   DOM node object was replaced).
 * - CHANGED: a matching logical element existed before, but its previously-chosen
 *   selector no longer resolves correctly — the control persisted, the selector broke.
 * - DETACHED: a previously-tracked logical element has no match now at all.
 */
export type StabilityVerdict =
  | "STABLE"
  | "CHANGED"
  | "DETACHED"
  | "NEW"
  | "UNKNOWN";

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
  /** The selector the engine would actually use, or null when nothing resolved. */
  bestSelector: string | null;
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
  /** Elements that had a resolvable selector in a previous snapshot of this same audit and were re-verified now. */
  trackedFromPrevious: number;
  stable: number;
  /** Logical element persisted (fingerprint matched) but its previously-chosen selector no longer resolves correctly — needs regeneration. */
  changed: number;
  /** A previously-tracked logical element (by fingerprint) has no match in the current snapshot at all. */
  detached: number;
  /** Present now but not seen (by fingerprint) in any previous snapshot of this audit. */
  new: number;
  unknown: number;
  /** Count of STABLE/CHANGED elements where the underlying DOM node object was replaced but the logical fingerprint still matched — evidence the tracker isn't just relying on object identity. */
  nodeReplacedButLogicallyStable: number;
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
}
