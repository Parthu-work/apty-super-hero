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

export interface FrameStateSignature {
  url: string;
  title: string;
  /** Trimmed text of the first few heading-like elements (h1-h3, [role=heading]), in document order. */
  headingSample: string[];
  /** Text of the element marking the current/selected navigation item inside a nav-like container, or null if none is found. */
  activeNavItem: string | null;
  /** Count of major semantic container elements, by tag/role — a coarse structural signature that changes when the page's overall layout changes, not on every mutation. */
  containerCounts: Record<string, number>;
}

const HEADING_SELECTOR = 'h1, h2, h3, [role="heading"]';
const MAX_HEADING_SAMPLE = 5;
const MAX_HEADING_TEXT_LENGTH = 120;

const NAV_CONTAINER_SELECTOR =
  'nav, [role="navigation"], [role="tablist"], [role="menu"], [role="menubar"], [role="tree"]';
const ACTIVE_ITEM_SELECTOR = [
  '[aria-current]:not([aria-current="false"])',
  '[aria-selected="true"]',
  '[aria-expanded="true"]',
  ".active",
  ".selected",
  ".is-active",
  ".is-selected",
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

function sampleHeadings(doc: Document): string[] {
  const headings = Array.from(doc.querySelectorAll(HEADING_SELECTOR));
  const out: string[] = [];
  for (const heading of headings) {
    const text = (heading.textContent ?? "").trim();
    if (!text) continue;
    out.push(text.slice(0, MAX_HEADING_TEXT_LENGTH));
    if (out.length >= MAX_HEADING_SAMPLE) break;
  }
  return out;
}

function findActiveNavItem(doc: Document): string | null {
  const navContainers = Array.from(
    doc.querySelectorAll(NAV_CONTAINER_SELECTOR),
  );
  for (const container of navContainers) {
    const active = container.querySelector(ACTIVE_ITEM_SELECTOR);
    const text = active?.textContent?.trim();
    if (text) return text.slice(0, MAX_ACTIVE_ITEM_TEXT_LENGTH);
  }
  return null;
}

function countContainers(doc: Document): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, selector] of Object.entries(CONTAINER_SELECTORS)) {
    counts[key] = doc.querySelectorAll(selector).length;
  }
  return counts;
}

/** Compute one frame's state-signature from its own live document. Pure/cheap — never runs the full interactive-element pipeline. */
export function computeFrameStateSignature(doc: Document): FrameStateSignature {
  return {
    url: doc.location?.href ?? "",
    title: doc.title ?? "",
    headingSample: sampleHeadings(doc),
    activeNavItem: findActiveNavItem(doc),
    containerCounts: countContainers(doc),
  };
}
