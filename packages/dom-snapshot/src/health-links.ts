/**
 * Safe same-origin page discovery for the application-wide DOM Health audit
 * (spec sections 2-4, 23, 25). Runs in-page — it only ever reads `<a href>`
 * elements already present in the DOM; it never simulates a click, never
 * submits a form, and never executes an onclick handler. That is a
 * deliberate, documented boundary: a real click on an unknown control in an
 * enterprise application (a menu item, a button) cannot be proven safe by
 * any keyword heuristic, so this module only ever proposes navigation
 * targets that are literal `href` values a user could already see and
 * middle-click open themselves.
 *
 * Consequence (an honest limitation, not hidden): a pure single-page
 * application whose navigation is entirely `onclick`-driven (no real
 * `href` attributes) will not have its other routes discovered this way.
 * `application-audit.ts` reports discovery coverage explicitly rather than
 * pretending full application coverage was achieved.
 */

import {
  closestComposed,
  isRenderedInComposedTree,
  querySelectorAllDeep,
  walkComposedTree,
} from "./composed-tree.js";
import { SHADOW_BOUNDARY, shadowHostChain } from "./element-ref.js";
import { capturedText } from "./health-privacy.js";
import { shadowRootOf } from "./shadow-roots.js";

export interface DiscoverableLink {
  /** Raw `href` attribute value, as authored. */
  href: string;
  /** Resolved against the document's base URI. */
  absoluteUrl: string;
  sameOrigin: boolean;
  /** Trimmed, length-bounded link text — for reporting only. */
  text: string;
  looksDestructive: boolean;
  /** The matched keyword, when `looksDestructive` is true. */
  destructiveReason: string | null;
  /** Where the anchor is, across shadow boundaries (`buildComposedDomPath`), so a click replay can find it again. */
  domPath: string;
}

/**
 * Keywords whose presence in a link's href/text/aria-label/class/id/title
 * suggests it triggers a state-mutating action rather than pure
 * navigation. Intentionally broad/conservative — a false positive here
 * only means a page is skipped for discovery, never that a destructive
 * action gets executed.
 */
const DESTRUCTIVE_KEYWORDS = [
  "delete",
  "remove",
  "logout",
  "log-out",
  "log_out",
  "log out",
  "signout",
  "sign-out",
  "sign_out",
  "sign out",
  "cancel",
  "reject",
  "approve",
  "submit",
  "save",
  "pay",
  "purchase",
  "checkout",
  "unsubscribe",
  "deactivate",
  "terminate",
  "destroy",
  "discard",
  "void",
  "reverse",
  "confirm",
  "finalize",
];

const SKIP_HREF_PATTERN = /^\s*(javascript|mailto|tel|data|sms|whatsapp):/i;

function matchesDestructiveKeyword(
  ...fields: Array<string | null | undefined>
): string | null {
  const joined = fields.filter(Boolean).join(" ").toLowerCase();
  for (const keyword of DESTRUCTIVE_KEYWORDS) {
    if (joined.includes(keyword)) return keyword;
  }
  return null;
}

export interface CollectDiscoverableLinksOptions {
  /** Caps how many links are returned (perf/message-size bound). Defaults to 300. */
  maxLinks?: number;
}

export function collectDiscoverableLinks(
  doc: Document,
  options: CollectDiscoverableLinksOptions = {},
): DiscoverableLink[] {
  const maxLinks = options.maxLinks ?? 300;
  const currentOrigin = doc.location?.origin ?? "";
  const seen = new Set<string>();
  const out: DiscoverableLink[] = [];

  for (const a of querySelectorAllDeep(doc, "a[href]")) {
    if (out.length >= maxLinks) break;
    const href = a.getAttribute("href");
    if (!href) continue;
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (SKIP_HREF_PATTERN.test(trimmed)) continue;

    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(trimmed, doc.baseURI).toString();
    } catch {
      continue;
    }
    if (seen.has(absoluteUrl)) continue;
    seen.add(absoluteUrl);

    let sameOrigin = false;
    try {
      sameOrigin = new URL(absoluteUrl).origin === currentOrigin;
    } catch {
      sameOrigin = false;
    }

    const text = capturedText(a);
    const destructiveReason = matchesDestructiveKeyword(
      trimmed,
      text,
      a.getAttribute("aria-label"),
      a.getAttribute("class"),
      a.getAttribute("id"),
      a.getAttribute("title"),
    );

    out.push({
      href: trimmed,
      absoluteUrl,
      sameOrigin,
      text,
      looksDestructive: destructiveReason !== null,
      destructiveReason,
      domPath: buildComposedDomPath(a),
    });
  }

  return out;
}

/**
 * Defense-in-depth re-check performed again by the orchestrator
 * immediately before navigating (`application-audit.ts`) — a link is only
 * ever queued for discovery when it passes this same check twice.
 */
export function isSafeToDiscover(link: DiscoverableLink): boolean {
  return link.sameOrigin && !link.looksDestructive;
}

/**
 * A candidate for triggering an in-place application-state transition that
 * is NOT a literal `<a href>` — a menu item, tab, or tree node an enterprise
 * app's navigation is built from. Read-only detection only: finding this
 * candidate never clicks anything by itself (see
 * `@apty/browser-runtime`'s `application-audit.ts` for the explicit,
 * off-by-default gate that decides whether any of these are ever actually
 * clicked).
 */
export interface SafeNavigationCandidate {
  /** A short, stable-ish description of where this element is in the DOM — used only to re-find it later via `document.elementsFromPoint`-free re-query, never persisted as a selector claim. */
  domPath: string;
  role: string | null;
  tagName: string;
  text: string;
  looksDestructive: boolean;
  destructiveReason: string | null;
}

/**
 * Containers whose descendants are conservatively assumed to be pure
 * navigation controls, never data-mutating actions — a real-world nav
 * menu, tab strip, or tree view. Deliberately narrow: this is an allowlist
 * of CONTAINERS, not a general "anything clickable" heuristic.
 */
const SAFE_NAV_CONTAINER_SELECTOR =
  'nav, [role="navigation"], [role="tablist"], [role="menu"], [role="menubar"], [role="tree"]';

/** Candidate item roles/tags inside a safe nav container — never a bare `<button>`/`<input>` outside this allowlist, and never anything inside a `<form>`. */
const SAFE_NAV_ITEM_SELECTOR = [
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="treeitem"]',
  "a",
  "li",
].join(", ");

const SUBMIT_LIKE_SELECTOR =
  'button[type="submit"], input[type="submit"], input[type="button"]';

/**
 * Items that change a setting rather than navigate. Measured: Infor LN's
 * theme and locale menus are `<a role="menuitemradio">` items ("Light",
 * "English") inside IDS shadow roots, and clicking one would change the
 * user's theme or language. The other roles are the remaining ARIA
 * toggle/selection roles, from the ARIA specification, not observed in the
 * exports.
 */
const SETTING_ITEM_SELECTOR =
  '[role="menuitemradio"], [role="menuitemcheckbox"], [role="switch"], [role="checkbox"], [role="radio"], [role="option"]';

function buildDomPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && depth < 6) {
    const tag = current.tagName.toLowerCase();
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index++;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${tag}:nth-of-type(${index})`);
    current = current.parentElement;
    depth++;
  }
  return parts.join(" > ");
}

/**
 * `buildDomPath` for the element and for each shadow host above it,
 * outermost first, joined with `SHADOW_BOUNDARY`. Each hop is valid only in
 * the root its host lives in; `resolveDomPath` walks them in order. A
 * light-DOM element's path has a single hop, exactly as before.
 */
export function buildComposedDomPath(el: Element): string {
  return [...shadowHostChain(el), el]
    .map((hop) => buildDomPath(hop))
    .join(SHADOW_BOUNDARY);
}

/** The element a `buildComposedDomPath` path points to, entering each host's shadow root (closed roots too, through `shadowRootOf`), or null. */
export function resolveDomPath(doc: Document, domPath: string): Element | null {
  const hops = domPath.split(SHADOW_BOUNDARY);
  let scope: Document | ShadowRoot = doc;
  for (let i = 0; i < hops.length; i++) {
    let found: Element | null;
    try {
      found = scope.querySelector(hops[i]!);
    } catch {
      return null;
    }
    if (!found) return null;
    if (i === hops.length - 1) return found;
    const shadow = shadowRootOf(found);
    if (!shadow) return null;
    scope = shadow;
  }
  return null;
}

/**
 * Read-only detection of safe-looking, non-anchor navigation controls
 * (menu items, tabs, tree nodes) inside a conservative container allowlist
 * — see the module doc comment for why `<a href>` alone misses these on a
 * menu-driven enterprise application. Excludes anything inside a `<form>`,
 * anything that looks like a submit/destructive control, settings toggles,
 * and anything not rendered (LN keeps its closed menus in the DOM).
 * Searches the composed tree: an item and its container may sit in
 * different shadow roots, joined by slot assignment, as in Infor's IDS
 * menus.
 */
export function collectSafeNavigationCandidates(
  doc: Document,
  options: { maxCandidates?: number } = {},
): SafeNavigationCandidate[] {
  const maxCandidates = options.maxCandidates ?? 100;
  const out: SafeNavigationCandidate[] = [];
  const seenPaths = new Set<string>();

  walkComposedTree(doc, (item) => {
    if (out.length >= maxCandidates) return false;
    if (
      !item.matches(SAFE_NAV_ITEM_SELECTOR) ||
      item.matches(SETTING_ITEM_SELECTOR) ||
      !closestComposed(item, SAFE_NAV_CONTAINER_SELECTOR) ||
      closestComposed(item, "form")
    ) {
      return true;
    }
    if (
      item.matches(SUBMIT_LIKE_SELECTOR) ||
      item.querySelector(SUBMIT_LIKE_SELECTOR)
    ) {
      return true;
    }
    if (!isRenderedInComposedTree(item)) return true;
    const text = capturedText(item);
    if (!text) return true;
    const domPath = buildComposedDomPath(item);
    if (seenPaths.has(domPath)) return true;
    seenPaths.add(domPath);

    const destructiveReason = matchesDestructiveKeyword(
      text,
      item.getAttribute("aria-label"),
      item.getAttribute("class"),
      item.getAttribute("id"),
      item.getAttribute("title"),
    );

    out.push({
      domPath,
      role: item.getAttribute("role"),
      tagName: item.tagName.toLowerCase(),
      text,
      looksDestructive: destructiveReason !== null,
      destructiveReason,
    });
    return true;
  });

  return out;
}

/** Same defense-in-depth shape as `isSafeToDiscover`, for non-anchor candidates. */
export function isSafeNavigationCandidate(
  candidate: SafeNavigationCandidate,
): boolean {
  return !candidate.looksDestructive;
}
