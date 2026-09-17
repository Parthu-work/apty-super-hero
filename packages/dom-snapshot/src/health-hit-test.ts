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
 * Note: `document.elementFromPoint` cannot be simulated by jsdom (it always
 * returns null, and layout/`getBoundingClientRect` are not computed) — unit
 * tests mock both. In a real page (content-script context) this reflects
 * genuine visual occlusion/overlay state.
 */
import type { HitTestClassification, HitTestResult } from "./health-types.js";

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

function pointResolvesToElement(
  doc: Document,
  el: Element,
  x: number,
  y: number,
): boolean {
  let hit: Element | null = null;
  try {
    hit = doc.elementFromPoint(x, y);
  } catch {
    hit = null;
  }
  if (!hit) return false;
  return hit === el || el.contains(hit) || hit.contains(el);
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
export function hitTestElement(el: Element): HitTestResult | null {
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
      if (pointResolvesToElement(doc, el, x, y)) pointsPassed++;
    }
  }

  return { pointsPassed, classification: classifyByPointsPassed(pointsPassed) };
}
