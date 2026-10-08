/**
 * Application-state signature — the evidence an "is this the same
 * application state or a new one" decision is built from (see
 * `@apty/browser-runtime`'s `state-fingerprint.ts`, which combines one of
 * these per frame into a whole-tab fingerprint).
 *
 * Deliberately NOT the raw DOM and NOT a full structural hash of every
 * element: a ticking clock, a live counter, or a toast notification must
 * never look like a state transition. This only reads a small set of
 * signals that are meant to change when the *application view* changes —
 * URL, title, the visible heading(s), which navigation item is marked
 * current/selected, and how many of each major semantic container exist —
 * and ignores everything else. It is a heuristic, documented as such: it
 * favors under-triggering (missing a real transition) over over-triggering
 * (manufacturing a new "state" for a live-updating widget), because a
 * missed state can still be reached again through a fresh discovery pass in
 * a later run, while a phantom state wastes the audit's page budget.
 */

import {
  closestComposed,
  composedText,
  isRenderedInComposedTree,
  walkComposedTree,
} from "./composed-tree.js";

export interface FrameStateSignature {
  url: string;
  title: string;
  /** Text of the first few rendered heading-like elements (h1-h3, [role=heading]), in composed order, shadow roots included. */
  headingSample: string[];
  /** Text of the first rendered element marking the current/selected navigation item inside a nav-like container, shadow roots included, or null if none is found. */
  activeNavItem: string | null;
  /** Count of major semantic container elements, by tag/role, shadow roots included — a coarse structural signature that changes when the page's overall layout changes, not on every mutation. */
  containerCounts: Record<string, number>;
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
const MAX_ACTIVE_ITEM_TEXT_LENGTH = 120;

/** Major semantic container tags/roles counted for the structural signature — a coarse "shape of the page" signal. */
const CONTAINER_SELECTORS: Record<string, string> = {
  main: 'main, [role="main"]',
  nav: 'nav, [role="navigation"]',
  header: 'header, [role="banner"]',
  footer: 'footer, [role="contentinfo"]',
  dialog: 'dialog, [role="dialog"], [role="alertdialog"]',
  table: "table",
  form: "form",
  tabpanel: '[role="tabpanel"]',
};

/** Rendered headings in composed order, read through slots (Infor LN's `<h1>` is inside an `ids-text` shadow root, its text in the host's light DOM). */
export function sampleHeadingsDeep(
  root: Document | ShadowRoot,
  max = MAX_HEADING_SAMPLE,
): string[] {
  const out: string[] = [];
  walkComposedTree(root, (el) => {
    if (!el.matches(HEADING_SELECTOR) || !isRenderedInComposedTree(el)) {
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
    const text = composedText(el, MAX_ACTIVE_ITEM_TEXT_LENGTH);
    if (text) found = text;
    return found === null;
  });
  return found;
}

function countContainersDeep(
  root: Document | ShadowRoot,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of Object.keys(CONTAINER_SELECTORS)) counts[key] = 0;
  walkComposedTree(root, (el) => {
    for (const [key, selector] of Object.entries(CONTAINER_SELECTORS)) {
      if (el.matches(selector)) counts[key]!++;
    }
  });
  return counts;
}

/** Compute one frame's state-signature from its own live document, shadow roots included. Pure/cheap — never runs the full interactive-element pipeline. */
export function computeFrameStateSignature(doc: Document): FrameStateSignature {
  return {
    url: doc.location?.href ?? "",
    title: doc.title ?? "",
    headingSample: sampleHeadingsDeep(doc),
    activeNavItem: findActiveNavItemDeep(doc),
    containerCounts: countContainersDeep(doc),
  };
}
