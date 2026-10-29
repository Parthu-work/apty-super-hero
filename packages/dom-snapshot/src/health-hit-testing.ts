/**
 * Hit testing (spec section 18): whether an element is actually clickable
 * where it sits, as distinct from whether it has a working selector.
 *
 * Follows Apty's `ElementVisibilityService.isElementVisible`, the check
 * behind a step's `isVisible`:
 *
 * - `checkVisibility` with opacity, so a transparent element is hidden
 *   (unlike selection's rendered check, which ignores opacity);
 * - nothing sampled when the rectangle lies entirely outside the viewport;
 * - a 3x3 grid at the centres of the cells (1/6, 1/2 and 5/6 of the width
 *   and height), hit-tested in the element's own root, since
 *   `document.elementsFromPoint` stops at a shadow host;
 * - Apty's own layers (`apty-studio-extension`, `apty-content-items`,
 *   `apty-widget`) are looked through;
 * - a point passes when nothing is there, when the top element is
 *   `apty-visibility-ignore-element` content, the element, inside it, or
 *   anywhere inside the element's parent (composite fields overlay their
 *   own trigger icons on the input);
 * - visible at 6 of 9 points (Apty's `2 / 3` threshold).
 *
 * Two additions of DOM Health's own: overlays the ignored-root policy
 * names (a Pendo badge, a chat launcher) are looked through as Apty's own
 * layers are, and a rendered element with no width or height is reported
 * `zero-size`, since a click cannot land on it.
 *
 * jsdom has no layout: `elementsFromPoint` is missing and rectangles are
 * zero, so unit tests mock both.
 */
import { composedParentElement } from "./composed-tree.js";
import type { HitTestClassification, HitTestResult } from "./health-types.js";
import { type IgnoredRootMatcher, ignoredRootOf } from "./ignored-roots.js";
import { shadowRootOf } from "./shadow-roots.js";

const SAMPLE_FRACTIONS = [1 / 6, 1 / 2, 5 / 6];

/** `ElementVisibilityService`: 6 of 9 points. */
const APTY_VISIBLE_POINTS = 6;

const APTY_LAYER_TAGS = new Set([
  "APTY-STUDIO-EXTENSION",
  "APTY-CONTENT-ITEMS",
  "APTY-WIDGET",
]);

const IGNORED_VISIBILITY_CLASS_NAME = "apty-visibility-ignore-element";

type VisibilityCheck = (options?: {
  checkOpacity?: boolean;
  checkVisibilityCSS?: boolean;
  opacityProperty?: boolean;
  visibilityProperty?: boolean;
}) => boolean;

/** Chrome's `checkVisibility`, with both spellings of each option; where it is missing (jsdom) the element's own computed style. */
function isCssHidden(el: Element): boolean {
  const check = (el as Element & { checkVisibility?: VisibilityCheck })
    .checkVisibility;
  if (typeof check === "function") {
    return !check.call(el, {
      checkOpacity: true,
      checkVisibilityCSS: true,
      opacityProperty: true,
      visibilityProperty: true,
    });
  }
  const view = el.ownerDocument?.defaultView;
  if (!view) return false;
  try {
    const style = view.getComputedStyle(el);
    const opacity = Number.parseFloat(style.opacity);
    return (
      style.display === "none" ||
      style.visibility === "hidden" ||
      (!Number.isNaN(opacity) && opacity === 0)
    );
  } catch {
    return false;
  }
}

function isOutsideViewport(rect: DOMRect, view: Window): boolean {
  return (
    rect.right < 0 ||
    rect.bottom < 0 ||
    rect.left > view.innerWidth ||
    rect.top > view.innerHeight
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

function isVisibilityIgnored(el: Element): boolean {
  return (
    el.classList.contains(IGNORED_VISIBILITY_CLASS_NAME) ||
    el.querySelector(`[class*="${IGNORED_VISIBILITY_CLASS_NAME}"]`) !== null ||
    (el.shadowRoot?.querySelector(
      `[class*="${IGNORED_VISIBILITY_CLASS_NAME}"]`,
    ) ?? null) !== null
  );
}

type PointSource = (x: number, y: number) => Element[];

/** The element's own root's `elementsFromPoint`; where that is missing, the document's hit followed down through shadow roots. */
function pointSourceFor(el: Element, doc: Document): PointSource {
  const root = el.getRootNode() as (Document | ShadowRoot) & {
    elementsFromPoint?: (x: number, y: number) => Element[];
  };
  if (typeof root.elementsFromPoint === "function") {
    return (x, y) => root.elementsFromPoint!(x, y);
  }
  return (x, y) => {
    const hit = descendIntoShadowRoots(
      doc.elementFromPoint?.(x, y) ?? null,
      x,
      y,
    );
    return hit ? [hit] : [];
  };
}

function topHit(
  stack: Element[],
  policy: readonly IgnoredRootMatcher[],
): Element | null {
  return (
    stack.find(
      (candidate) =>
        !APTY_LAYER_TAGS.has(candidate.tagName) &&
        (policy.length === 0 || !ignoredRootOf(candidate, policy)),
    ) ?? null
  );
}

function pointPasses(el: Element, hit: Element | null): boolean {
  if (!hit || isVisibilityIgnored(hit)) return true;
  return (
    hit === el ||
    composedContains(el, hit) ||
    (el.parentNode?.contains(hit) ?? false)
  );
}

function classifyByPointsPassed(pointsPassed: number): HitTestClassification {
  if (pointsPassed >= 9) return "fully-targetable";
  if (pointsPassed >= APTY_VISIBLE_POINTS) return "partially-targetable";
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

  if (isCssHidden(el)) {
    return { pointsPassed: 0, classification: "hidden" };
  }

  let rect: DOMRect;
  try {
    rect = el.getBoundingClientRect();
  } catch {
    return null;
  }

  if (isOutsideViewport(rect, view)) {
    return { pointsPassed: 0, classification: "outside-viewport" };
  }

  if (rect.width <= 0 || rect.height <= 0) {
    return { pointsPassed: 0, classification: "zero-size" };
  }

  const stackAt = pointSourceFor(el, doc);
  let pointsPassed = 0;
  for (const fy of SAMPLE_FRACTIONS) {
    for (const fx of SAMPLE_FRACTIONS) {
      const x = rect.left + rect.width * fx;
      const y = rect.top + rect.height * fy;
      let hit: Element | null = null;
      try {
        hit = topHit(stackAt(x, y), policy);
      } catch {
        hit = null;
      }
      if (pointPasses(el, hit)) pointsPassed++;
    }
  }

  return { pointsPassed, classification: classifyByPointsPassed(pointsPassed) };
}
