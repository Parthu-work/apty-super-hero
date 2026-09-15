/**
 * Types for the Apty DOM Health snapshot — a separate, purpose-built
 * collector from `collectDomSnapshot` (which builds an accessibility-tree
 * snapshot for element search/interaction). DOM Health needs a flatter,
 * cheaper inventory: attribute signals on interactive elements, iframe/
 * Shadow DOM/z-index counts. Kept as its own module so the existing
 * snapshot/search feature is never touched by this addition.
 */

/** Attributes relevant to selector-quality scoring — never includes input values. */
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

export interface DomHealthElement {
  tagName: string;
  attributes: DomHealthElementAttributes;
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

export interface DomHealthSnapshot {
  collectedAt: number;
  url: string;
  title: string;
  counts: DomHealthCounts;
  /** Bounded sample of interactive elements (see `MAX_INTERACTIVE_ELEMENTS`) — counts above reflect the true totals even when this array is truncated. */
  interactiveElements: DomHealthElement[];
  iframes: DomHealthIframeInfo;
  shadowDom: DomHealthShadowDomInfo;
  zIndex: DomHealthZIndexInfo;
}

export interface DomHealthCollectorOptions {
  /** Caps how many interactive-element descriptors are returned (memory/serialization bound for huge pages). Defaults to 500. */
  maxInteractiveElements?: number;
  /** Caps how many positioned elements get a computed-style z-index check (perf bound). Defaults to 2000. */
  maxStyleChecks?: number;
}
