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

  const anchors = doc.querySelectorAll("a[href]");
  for (const a of Array.from(anchors)) {
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

    const text = (a.textContent ?? "").trim().slice(0, 120);
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
 * Read-only detection of safe-looking, non-anchor navigation controls
 * (menu items, tabs, tree nodes) inside a conservative container allowlist
 * — see the module doc comment for why `<a href>` alone misses these on a
 * menu-driven enterprise application. Excludes anything inside a `<form>`
 * and anything that looks like a submit/destructive control, exactly like
 * `collectDiscoverableLinks` excludes destructive-looking hrefs.
 */
export function collectSafeNavigationCandidates(
  doc: Document,
  options: { maxCandidates?: number } = {},
): SafeNavigationCandidate[] {
  const maxCandidates = options.maxCandidates ?? 100;
  const out: SafeNavigationCandidate[] = [];
  const seenPaths = new Set<string>();

  const containers = Array.from(
    doc.querySelectorAll(SAFE_NAV_CONTAINER_SELECTOR),
  );
  for (const container of containers) {
    if (out.length >= maxCandidates) break;
    const items = Array.from(
      container.querySelectorAll(SAFE_NAV_ITEM_SELECTOR),
    );
    for (const item of items) {
      if (out.length >= maxCandidates) break;
      if (item.closest("form")) continue;
      if (
        item.matches(SUBMIT_LIKE_SELECTOR) ||
        item.querySelector(SUBMIT_LIKE_SELECTOR)
      ) {
        continue;
      }
      const text = (item.textContent ?? "").trim().slice(0, 120);
      if (!text) continue;
      const domPath = buildDomPath(item);
      if (seenPaths.has(domPath)) continue;
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
    }
  }

  return out;
}

/** Same defense-in-depth shape as `isSafeToDiscover`, for non-anchor candidates. */
export function isSafeNavigationCandidate(
  candidate: SafeNavigationCandidate,
): boolean {
  return !candidate.looksDestructive;
}
