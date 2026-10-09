/**
 * Application-state signature — the evidence an "is this the same
 * application state or a new one" decision is built from (see
 * `@apty/browser-runtime`'s `route-key.ts`, which combines one of these per
 * frame into a `RouteKey`).
 *
 * Deliberately NOT the raw DOM: a ticking clock, a live counter, or a toast
 * notification must never look like a state transition. This only reads
 * signals that are meant to change when the *application view* changes —
 * the navigation trail, the primary heading, and a tag/role skeleton of the
 * primary content — and ignores text everywhere except the trail and the
 * heading. It favors under-triggering (missing a real transition) over
 * over-triggering (manufacturing a new "state" for a live-updating widget),
 * because a missed state can still be reached again through a fresh
 * discovery pass in a later run, while a phantom state wastes the audit's
 * page budget.
 *
 * The page title is not read: athenaOne's names the practice and its id
 * (DOM Health brief, section 2.2), so it is neither identity nor safe to
 * carry around.
 */

import {
  closestComposed,
  composedParentElement,
  composedText,
  isRenderedInComposedTree,
  querySelectorDeep,
  walkComposedTree,
} from "./composed-tree.js";
import { AGENT_UI_ROOT_IDS, shadowRootOf } from "./shadow-roots.js";

export interface FrameStateSignature {
  url: string;
  /** Breadcrumb items, then the innermost current/selected item of each navigation container, in composed order, shadow roots included. */
  navTrail: string[];
  /** First rendered heading of the primary content region (`main`, else the document), shadow roots included. */
  primaryHeading: string | null;
  /** Hash of the primary content region's tag/role skeleton; no text, attributes or classes, so nothing generated. */
  structureHash: string;
}

export const HEADING_SELECTOR = 'h1, h2, h3, [role="heading"]';
const MAX_HEADING_SAMPLE = 5;
const MAX_HEADING_TEXT_LENGTH = 120;

export const NAV_CONTAINER_SELECTOR =
  'nav, [role="navigation"], [role="tablist"], [role="menu"], [role="menubar"], [role="tree"]';

/**
 * What marks the current item. The ARIA states and `.active` / `.selected`
 * forms cover Infor LN's active tab (`portal-tab-item` with
 * `aria-selected="true"` and class `selected`). The `_is-` / `--is-` forms
 * follow athenaOne Forge's state-class convention: `fe_is-disabled` and
 * `fe_is-required` were measured, but `fe_is-selected` / `fe_is-active`
 * were not seen in the exports, so those are unverified.
 */
export const ACTIVE_ITEM_SELECTOR = [
  '[aria-current]:not([aria-current="false"])',
  '[aria-selected="true"]',
  '[aria-expanded="true"]',
  ".active",
  ".selected",
  ".is-active",
  ".is-selected",
  '[class*="_is-active"]',
  '[class*="_is-selected"]',
  '[class*="--is-active"]',
  '[class*="--is-selected"]',
].join(", ");
const MAX_NAV_TEXT_LENGTH = 80;
const MAX_NAV_TRAIL = 6;

/**
 * Breadcrumb containers, by ARIA label or class. From general knowledge of
 * breadcrumb markup: neither the Infor LN export nor the athenaOne exports
 * contain a breadcrumb, so this is unverified against a real application.
 */
const BREADCRUMB_SELECTOR =
  'nav[aria-label*="breadcrumb" i], [role="navigation"][aria-label*="breadcrumb" i], .breadcrumb, .breadcrumbs, ol[class*="breadcrumb"], ul[class*="breadcrumb"]';
const BREADCRUMB_ITEM_SELECTOR = 'a, li, [role="link"], [aria-current]';

const MAIN_REGION_SELECTOR = 'main, [role="main"]';

/**
 * Toasts, status lines and clocks: content that changes on its own while
 * the screen stays the same. ARIA live-region roles and attributes, from
 * general knowledge of toast and notification libraries; the two real
 * applications' exports contain no toast to verify against.
 */
const LIVE_REGION_SELECTOR =
  '[role="alert"], [role="status"], [role="log"], [role="marquee"], [role="timer"], [aria-live="assertive"], [aria-live="polite"], output';

/**
 * What a live region that is really a page wrapper contains. Measured:
 * athenaOne Forge wraps the whole Patient Registration form (`form#xpr_rf`
 * and its "Contact Details" heading) in
 * `<div aria-live="polite" class="fe_c_loader xpr_rf_loader">`, so a live
 * region holding a form or a landmark is screen content, not a toast.
 */
const SCREEN_CONTENT_SELECTOR = `${MAIN_REGION_SELECTOR}, ${NAV_CONTAINER_SELECTOR}, form`;

const AGENT_UI_SELECTOR = AGENT_UI_ROOT_IDS.map((id) => `[id="${id}"]`).join(
  ", ",
);

/** A live region holding no form and no landmark: a toast, a status line, a loading message. */
function isTransientRegion(element: Element): boolean {
  return (
    element.matches(LIVE_REGION_SELECTOR) &&
    querySelectorDeep(element, SCREEN_CONTENT_SELECTOR) === null
  );
}

/** True for content that is never screen identity: the Agent's own UI, and anything inside a transient live region. */
function isTransientOrAgentContent(element: Element): boolean {
  for (
    let current: Element | null = element;
    current;
    current = composedParentElement(current)
  ) {
    if (current.matches(AGENT_UI_SELECTOR) || isTransientRegion(current)) {
      return true;
    }
  }
  return false;
}

/** Rendered headings in composed order, read through slots (Infor LN's `<h1>` is inside an `ids-text` shadow root, its text in the host's light DOM). */
export function sampleHeadingsDeep(
  root: Document | ShadowRoot | Element,
  max = MAX_HEADING_SAMPLE,
): string[] {
  const out: string[] = [];
  walkComposedTree(root, (el) => {
    if (
      !el.matches(HEADING_SELECTOR) ||
      !isRenderedInComposedTree(el) ||
      isTransientOrAgentContent(el)
    ) {
      return true;
    }
    const text = composedText(el, MAX_HEADING_TEXT_LENGTH);
    if (text) out.push(text);
    return out.length < max;
  });
  return out;
}

/**
 * First rendered current/selected item that sits inside a navigation
 * container in the composed tree. Not rendered means skipped: Infor LN
 * keeps its theme and locale menus in the DOM, closed, each with a selected
 * item ("Light", "English"), and those must never read as the screen's
 * navigation state.
 */
export function findActiveNavItemDeep(
  root: Document | ShadowRoot,
): string | null {
  let found: string | null = null;
  walkComposedTree(root, (el) => {
    if (
      !el.matches(ACTIVE_ITEM_SELECTOR) ||
      !closestComposed(el, NAV_CONTAINER_SELECTOR) ||
      !isRenderedInComposedTree(el)
    ) {
      return true;
    }
    const text = composedText(el, MAX_NAV_TEXT_LENGTH);
    if (text) found = text;
    return found === null;
  });
  return found;
}

/** Drop every element that has another element of `elements` below it in the composed tree, keeping the innermost. */
function innermost(elements: Element[]): Element[] {
  const set = new Set(elements);
  const hasMatchBelow = new Set<Element>();
  for (const element of elements) {
    for (
      let parent = composedParentElement(element);
      parent;
      parent = composedParentElement(parent)
    ) {
      if (set.has(parent)) hasMatchBelow.add(parent);
    }
  }
  return elements.filter((element) => !hasMatchBelow.has(element));
}

function textsOf(elements: Element[]): string[] {
  return elements
    .map((element) => composedText(element, MAX_NAV_TEXT_LENGTH))
    .filter(Boolean);
}

/**
 * Where the user is: breadcrumb items first, then the innermost rendered
 * current/selected item inside each navigation container (a selected tab
 * inside a selected menu yields both, outer first). An item that wraps
 * another selected item is left out, because its text would repeat the
 * inner one's. Consecutive repeats are collapsed and the trail is capped.
 */
export function collectNavTrailDeep(root: Document | ShadowRoot): string[] {
  const breadcrumbItems: Element[] = [];
  const activeItems: Element[] = [];
  walkComposedTree(root, (el) => {
    const inBreadcrumb =
      el.matches(BREADCRUMB_ITEM_SELECTOR) &&
      closestComposed(el, BREADCRUMB_SELECTOR) !== null;
    const isActiveItem =
      el.matches(ACTIVE_ITEM_SELECTOR) &&
      closestComposed(el, NAV_CONTAINER_SELECTOR) !== null;
    if (!inBreadcrumb && !isActiveItem) return true;
    if (!isRenderedInComposedTree(el) || isTransientOrAgentContent(el)) {
      return true;
    }
    if (inBreadcrumb) breadcrumbItems.push(el);
    else activeItems.push(el);
    return true;
  });

  const trail: string[] = [];
  for (const text of [
    ...textsOf(innermost(breadcrumbItems)),
    ...textsOf(innermost(activeItems)),
  ]) {
    if (trail[trail.length - 1] !== text) trail.push(text);
    if (trail.length >= MAX_NAV_TRAIL) break;
  }
  return trail;
}

/** The first rendered `main` landmark outside transient content, or null when the page has none. */
function findMainRegion(root: Document | ShadowRoot): Element | null {
  let found: Element | null = null;
  walkComposedTree(root, (el) => {
    if (
      el.matches(MAIN_REGION_SELECTOR) &&
      isRenderedInComposedTree(el) &&
      !isTransientOrAgentContent(el)
    ) {
      found = el;
    }
    return found === null;
  });
  return found;
}

/** The first heading of the main region, or of the whole document when the main region has none (or there is no main region). */
export function findPrimaryHeadingDeep(
  root: Document | ShadowRoot,
): string | null {
  const main = findMainRegion(root);
  if (main) {
    const [inMain] = sampleHeadingsDeep(main, 1);
    if (inMain) return inMain;
  }
  return sampleHeadingsDeep(root, 1)[0] ?? null;
}

/**
 * Bounds for the skeleton walk. Depth 6 below the region reaches the
 * content of a typical screen's layout containers; 600 visited elements
 * bound the cost on large documents (the Infor LN top document has 3,788
 * elements). Not tuned against a real application: chosen so that a
 * skeleton never costs more than one pass over a few hundred elements.
 */
const MAX_STRUCTURE_DEPTH = 6;
const MAX_STRUCTURE_NODES = 600;

/** Elements whose content is not page structure: code, styling, metadata, an icon's drawing, another frame. */
const STRUCTURE_SKIPPED_TAGS = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "link",
  "meta",
]);
const STRUCTURE_LEAF_TAGS = new Set(["svg", "iframe", "frame", "object"]);

/** An element's children as rendered: its shadow root's children if it hosts one, with each `<slot>` replaced by what is assigned to it (or its fallback content). */
function composedChildren(element: Element): Element[] {
  const shadow = shadowRootOf(element);
  const children = Array.from((shadow ?? element).children);
  return children.flatMap((child) => {
    if (
      child.localName !== "slot" ||
      !(child.getRootNode() instanceof ShadowRoot)
    ) {
      return [child];
    }
    const assigned = (child as HTMLSlotElement)
      .assignedNodes({ flatten: true })
      .filter((node): node is Element => node.nodeType === Node.ELEMENT_NODE);
    return assigned.length > 0 ? assigned : Array.from(child.children);
  });
}

/**
 * Whether a child belongs in the skeleton. Hidden content, live regions and
 * the Agent's UI are left out, and so is anything `position: fixed`:
 * toasts, chat launchers, cookie banners and digital-adoption overlays
 * float over the page that way (general knowledge, unverified against the
 * two real applications).
 */
function inStructure(element: Element, view: Window | null): boolean {
  if (STRUCTURE_SKIPPED_TAGS.has(element.localName)) return false;
  if (element.hasAttribute("hidden")) return false;
  if (element.matches(AGENT_UI_SELECTOR)) return false;
  if (isTransientRegion(element)) return false;
  if (!view) return true;
  const style = view.getComputedStyle(element);
  return style.display !== "none" && style.position !== "fixed";
}

function structureLabel(element: Element): string {
  const role = element.getAttribute("role");
  return role ? `${element.localName}[${role}]` : element.localName;
}

/**
 * The region's tag/role skeleton. A run of siblings with the same tag and
 * role is represented by its first member only, so a table with 3 rows and
 * one with 300 have the same skeleton, and the node budget is spent on
 * shape rather than on repetition.
 */
function structureSkeleton(region: Element): string {
  const view = region.ownerDocument.defaultView;
  let budget = MAX_STRUCTURE_NODES;
  const visit = (element: Element, depth: number): string => {
    budget--;
    const label = structureLabel(element);
    if (
      depth >= MAX_STRUCTURE_DEPTH ||
      STRUCTURE_LEAF_TAGS.has(element.localName)
    ) {
      return label;
    }
    const parts: string[] = [];
    let previousLabel: string | null = null;
    for (const child of composedChildren(element)) {
      if (budget <= 0) break;
      if (!inStructure(child, view)) continue;
      const childLabel = structureLabel(child);
      if (childLabel === previousLabel) continue;
      previousLabel = childLabel;
      parts.push(visit(child, depth + 1));
    }
    return parts.length > 0 ? `${label}(${parts.join(",")})` : label;
  };
  return visit(region, 0);
}

/** FNV-1a 32-bit — stable and cheap, never cryptographically strong. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Hash of the main region's skeleton, or of `<body>` when there is no main region. */
export function computeStructureHash(doc: Document): string {
  const region = findMainRegion(doc) ?? doc.body ?? doc.documentElement;
  return region ? fnv1a(structureSkeleton(region)) : "";
}

/** Compute one frame's state signature from its own live document, shadow roots included. Pure/cheap — never runs the full interactive-element pipeline. */
export function computeFrameStateSignature(doc: Document): FrameStateSignature {
  return {
    url: doc.location?.href ?? "",
    navTrail: collectNavTrailDeep(doc),
    primaryHeading: findPrimaryHeadingDeep(doc),
    structureHash: computeStructureHash(doc),
  };
}
