/**
 * Multi-point hit testing (spec section 18) — evaluates whether an element
 * is actually clickable where it visually sits, as distinct from whether it
 * has a working selector. A perfectly unique selector on a fully-occluded
 * element is not "healthy" for automation purposes.
 *
 * Uses a 9-point grid (25/50/75% of width x height) and classifies an
 * element as targetable when the majority of points (>=5/9) resolve to the
 * element itself or one of its ancestors/descendants at that point.
 *
 * `document.elementFromPoint` stops at the outermost shadow host, and a
 * host does not `contains()` its shadow content, so an element inside a
 * shadow root used to fail every point (68 of the 74 interactive elements in
 * the Infor LN export are inside shadow roots). Each hit is followed down
 * through `shadowRoot.elementFromPoint`, and containment is checked in the
 * composed tree.
 *
 * Note: `document.elementFromPoint` cannot be simulated by jsdom (it always
 * returns null, and layout/`getBoundingClientRect` are not computed) — unit
 * tests mock both. In a real page (content-script context) this reflects
 * genuine visual occlusion/overlay state.
 */
import { composedParentElement } from "./composed-tree.js";
import type { HitTestClassification, HitTestResult } from "./health-types.js";
import { type IgnoredRootMatcher, ignoredRootOf } from "./ignored-roots.js";
import { shadowRootOf } from "./shadow-roots.js";

const SAMPLE_FRACTIONS = [0.25, 0.5, 0.75];

function isHiddenByStyle(el: Element): boolean {
  const view = el.ownerDocument?.defaultView;
  if (!view) return false;
  try {
    const style = view.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return true;
    }
    const opacity = Number.parseFloat(style.opacity);
    if (!Number.isNaN(opacity) && opacity === 0) return true;
  } catch {
    return false;
  }
  if (el.getAttribute("aria-hidden") === "true") return true;
  return false;
}

function isOutsideViewport(rect: DOMRect, view: Window): boolean {
  return (
    rect.right <= 0 ||
    rect.bottom <= 0 ||
    rect.left >= view.innerWidth ||
    rect.top >= view.innerHeight
  );
}

/** Bound on how many nested shadow roots one point is followed into (LN nests 3 deep). */
const MAX_SHADOW_DESCENT = 32;

/** From a document-level hit, each shadow root's own hit below it, down to the innermost element. */
function descendIntoShadowRoots(
  start: Element | null,
  x: number,
  y: number,
): Element | null {
  let hit = start;
  for (let depth = 0; hit && depth < MAX_SHADOW_DESCENT; depth++) {
    const shadow = shadowRootOf(hit) as
      | (ShadowRoot & {
          elementFromPoint?: (x: number, y: number) => Element | null;
        })
      | null;
    const inner = shadow?.elementFromPoint?.(x, y) ?? null;
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

function composedContains(ancestor: Element, node: Element): boolean {
  for (
    let current: Element | null = node;
    current;
    current = composedParentElement(current)
  ) {
    if (current === ancestor) return true;
  }
  return false;
}

/**
 * The innermost element at (x, y), looking past content the ignored-root
 * policy excludes: a Pendo badge or a chat launcher over a control is not
 * the application occluding itself, so the first element below it in the
 * document's hit stack is taken instead.
 */
function deepElementFromPoint(
  doc: Document,
  x: number,
  y: number,
  policy: readonly IgnoredRootMatcher[],
): Element | null {
  const hit = descendIntoShadowRoots(doc.elementFromPoint(x, y), x, y);
  if (!hit || policy.length === 0 || !ignoredRootOf(hit, policy)) return hit;
  const below = (doc.elementsFromPoint?.(x, y) ?? []).find(
    (candidate) => !ignoredRootOf(candidate, policy),
  );
  return below ? descendIntoShadowRoots(below, x, y) : null;
}

function pointResolvesToElement(
  doc: Document,
  el: Element,
  x: number,
  y: number,
  policy: readonly IgnoredRootMatcher[],
): boolean {
  let hit: Element | null = null;
  try {
    hit = deepElementFromPoint(doc, x, y, policy);
  } catch {
    hit = null;
  }
  if (!hit) return false;
  return composedContains(el, hit) || composedContains(hit, el);
}

function classifyByPointsPassed(pointsPassed: number): HitTestClassification {
  if (pointsPassed >= 9) return "fully-targetable";
  if (pointsPassed >= 5) return "partially-targetable";
  if (pointsPassed >= 1) return "mostly-occluded";
  return "fully-occluded";
}

/**
 * Run the 9-point hit test for one element. Returns null when the element
 * has no owner document/window (detached, or a test double) — callers treat
 * null as UNKNOWN, never as a pass.
 */
export function hitTestElement(
  el: Element,
  policy: readonly IgnoredRootMatcher[] = [],
): HitTestResult | null {
  const doc = el.ownerDocument;
  const view = doc?.defaultView;
  if (!doc || !view) return null;

  if (isHiddenByStyle(el)) {
    return { pointsPassed: 0, classification: "hidden" };
  }

  let rect: DOMRect;
  try {
    rect = el.getBoundingClientRect();
  } catch {
    return null;
  }

  if (rect.width <= 0 || rect.height <= 0) {
    return { pointsPassed: 0, classification: "zero-size" };
  }

  if (isOutsideViewport(rect, view)) {
    return { pointsPassed: 0, classification: "outside-viewport" };
  }

  let pointsPassed = 0;
  for (const fx of SAMPLE_FRACTIONS) {
    for (const fy of SAMPLE_FRACTIONS) {
      const x = rect.left + rect.width * fx;
      const y = rect.top + rect.height * fy;
      if (pointResolvesToElement(doc, el, x, y, policy)) pointsPassed++;
    }
  }

  return { pointsPassed, classification: classifyByPointsPassed(pointsPassed) };
}
