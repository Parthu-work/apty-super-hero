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
