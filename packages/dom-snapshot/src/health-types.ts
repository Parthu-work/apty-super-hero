/**
 * Types for the Apty DOM Health snapshot.
 *
 * This is evidence produced by actually simulating Apty-style element
 * selection in-page (candidate generation, live `querySelectorAll`
 * verification, ignore/partial/contextual recovery, hit testing) — see
 * `health-selector-engine.ts` and `health-hit-test.ts`. The scoring engine
 * in `@aipexstudio/browser-runtime` only aggregates/weights numbers that
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

/** Cross-snapshot verdict for one element's previously-chosen selector (spec section 23). UNKNOWN when there is nothing to compare against yet (first snapshot of the audit). */
export type StabilityVerdict = "STABLE" | "UNSTABLE" | "DETACHED" | "UNKNOWN";

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
  unstable: number;
  detached: number;
  unknown: number;
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
  /** Of the positional selectors, how many kept resolving to the same node when re-verified (requires >=2 snapshots). */
  stableAcrossSnapshots: number;
  unstableAcrossSnapshots: number;
}

export interface AccessibilitySignalStats {
  totalInteractive: number;
  missingAccessibleName: number;
}

export interface DomHealthSnapshot {
  collectedAt: number;
  url: string;
  title: string;
  counts: DomHealthCounts;
  elementUniverse: ElementUniverseCounts;
  /** Bounded sample of analyzed elements (see `maxInteractiveElements`) — aggregates above/below reflect true totals even when this array is truncated. */
  elementReports: ElementSelectorReport[];
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
  /** Caps how many elements get the full selector-resolution + hit-test pipeline (perf bound — this is the expensive path). Defaults to 300. */
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
