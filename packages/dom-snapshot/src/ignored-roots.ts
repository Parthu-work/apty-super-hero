/**
 * Content that sits on the page but is not the application: the Agent's
 * own UI, Apty's Widget and Studio, digital-adoption overlays, consent
 * banners and chat launchers (DOM Health brief, section 4.9; defect D-6).
 * Audited as the application, their elements were scored, hit-tested and
 * read into the state signature as if the customer had built them.
 *
 * One policy, applied in the collector, the state signature, hit testing
 * and therefore scoring. Subtrees it removes are counted and reported per
 * matcher, never dropped silently. A user can add matchers, because the
 * next customer will have a different overlay vendor.
 *
 * A matcher is a prefix of an element's `id`, a prefix of one of its class
 * tokens, a tag name, or a prefix of its `src`, compared
 * case-insensitively. The outermost matching element is the root;
 * everything under it in the composed tree goes with it. An
 * `attribute-prefix` matcher names an attribute another product writes onto
 * the application's own elements: the attribute is not the application's,
 * the element is, so it never makes a root.
 */
import { composedParentElement, walkComposedTree } from "./composed-tree.js";

export type IgnoredRootMatchKind =
  | "id-prefix"
  | "class-prefix"
  | "tag"
  | "src-prefix"
  | "attribute-prefix";

export interface IgnoredRootMatcher {
  kind: IgnoredRootMatchKind;
  value: string;
  /** Who the content belongs to, for the report. */
  owner: string;
  /**
   * - `measured`: seen in a real customer export.
   * - `repository`: how this repository itself identifies the content.
   * - `unverified`: from general knowledge of the vendor's markup.
   * - `user`: added in Settings.
   */
  evidence: "measured" | "repository" | "unverified" | "user";
}

function matcher(
  kind: IgnoredRootMatchKind,
  value: string,
  owner: string,
  evidence: IgnoredRootMatcher["evidence"],
): IgnoredRootMatcher {
  return { kind, value, owner, evidence };
}

export const PASSWORD_MANAGER = "Password manager";
export const BROWSER_EXTENSION = "Browser extension";

export const DEFAULT_IGNORED_ROOTS: readonly IgnoredRootMatcher[] = [
  /** The Agent's content script mounts `#apty-agent-content-root` and `#apty-agent-border-overlay` (`apps/browser-extension/src/entrypoints/content/index.tsx`). */
  matcher("id-prefix", "apty-agent-", "Apty Agent", "repository"),
  /** `widget-diagnostics.ts` detects the Apty Widget by `[id^="apty-"]` (other than the Agent's own `apty-agent-` nodes) and `[class*="apty-widget"]`; not checked against a live Widget or Studio DOM. */
  matcher("id-prefix", "apty-", "Apty Widget / Studio", "repository"),
  matcher("class-prefix", "apty-widget", "Apty Widget", "repository"),
  matcher("class-prefix", "apty-studio", "Apty Studio", "unverified"),
  /** Confirmed in the pMD DOM analysis runs (DOM Config brief, D4 and Appendix C): `apty-widget`, `apty-content-items`, `apty-focus-footer` elements, `apty-visibility-ignore-element` classes and `data-apty-root`. */
  matcher("class-prefix", "apty-", "Apty Widget / Studio", "measured"),
  matcher("tag", "apty-widget", "Apty Widget", "measured"),
  matcher("tag", "apty-content-items", "Apty Widget", "measured"),
  matcher("tag", "apty-focus-footer", "Apty Widget", "measured"),
  matcher("attribute-prefix", "data-apty-", "Apty Widget / Studio", "measured"),
  /** athenaOne Patient Registration export: `<button id="_pendo-badge_…" class="_pendo-badge _pendo-badge_">` wrapping `<img id="pendo-image-badge-…" class="_pendo-image …">`. */
  matcher("id-prefix", "_pendo-", "Pendo", "measured"),
  matcher("id-prefix", "pendo-", "Pendo", "measured"),
  matcher("class-prefix", "_pendo-", "Pendo", "measured"),
  matcher("id-prefix", "walkme-", "WalkMe", "unverified"),
  matcher("class-prefix", "walkme-", "WalkMe", "unverified"),
  matcher("id-prefix", "_wfx_", "Whatfix", "unverified"),
  matcher("class-prefix", "wfx-", "Whatfix", "unverified"),
  matcher("class-prefix", "appcues", "Appcues", "unverified"),
  matcher("tag", "appcues-container", "Appcues", "unverified"),
  matcher("id-prefix", "userguiding", "UserGuiding", "unverified"),
  matcher("class-prefix", "userguiding", "UserGuiding", "unverified"),
  matcher("id-prefix", "onetrust-", "OneTrust consent", "unverified"),
  matcher("id-prefix", "cybotcookiebot", "Cookiebot consent", "unverified"),
  matcher("id-prefix", "truste-", "TrustArc consent", "unverified"),
  matcher("class-prefix", "osano-cm-", "Osano consent", "unverified"),
  matcher("id-prefix", "usercentrics-", "Usercentrics consent", "unverified"),
  matcher("id-prefix", "intercom-", "Intercom chat", "unverified"),
  matcher("class-prefix", "intercom-", "Intercom chat", "unverified"),
  matcher("id-prefix", "drift-", "Drift chat", "unverified"),
  matcher("id-prefix", "hubspot-messages", "HubSpot chat", "unverified"),
  matcher("class-prefix", "embeddedservice", "Salesforce chat", "unverified"),
  /** Password managers and extensions confirmed in the pMD runs (D4): `jumpcloud_autofill_dialog`, `data-myki-*`, `data-form-preloader*`, `jcpwm-*`, and an extension page in an iframe. */
  matcher("id-prefix", "jumpcloud", PASSWORD_MANAGER, "measured"),
  matcher("class-prefix", "jumpcloud", PASSWORD_MANAGER, "measured"),
  matcher("id-prefix", "jcpwm-", PASSWORD_MANAGER, "measured"),
  matcher("class-prefix", "jcpwm-", PASSWORD_MANAGER, "measured"),
  matcher("attribute-prefix", "jcpwm-", PASSWORD_MANAGER, "measured"),
  matcher("attribute-prefix", "data-myki-", PASSWORD_MANAGER, "measured"),
  matcher(
    "attribute-prefix",
    "data-form-preloader",
    PASSWORD_MANAGER,
    "measured",
  ),
  matcher("src-prefix", "chrome-extension://", BROWSER_EXTENSION, "measured"),
];
/*
 * Datadog, also named in the brief, adds no page UI: what the athenaOne
 * exports contain is its inline loader `<script>` with a client token,
 * which is a script body, excluded from capture as such, not a root.
 */

export function describeMatcher(m: IgnoredRootMatcher): string {
  switch (m.kind) {
    case "id-prefix":
      return `id:${m.value}`;
    case "class-prefix":
      return `class:${m.value}`;
    case "tag":
      return `tag:${m.value}`;
    case "src-prefix":
      return `src:${m.value}`;
    case "attribute-prefix":
      return `attribute:${m.value}`;
  }
}

const USER_MATCHER = /^\s*(id|class|tag)\s*:\s*([A-Za-z0-9_-]+)\s*$/;

/** A Settings entry (`id:prefix`, `class:prefix` or `tag:name`) as a matcher, or null when it is not one. */
export function parseIgnoredRootMatcher(
  text: string,
): IgnoredRootMatcher | null {
  const match = text.match(USER_MATCHER);
  if (!match) return null;
  const kind: IgnoredRootMatchKind =
    match[1] === "tag"
      ? "tag"
      : match[1] === "id"
        ? "id-prefix"
        : "class-prefix";
  return matcher(kind, match[2]!, "Added in Settings", "user");
}

/** The defaults plus every valid Settings entry; invalid entries are skipped. */
export function ignoredRootPolicy(
  userEntries: readonly string[] = [],
): IgnoredRootMatcher[] {
  return [
    ...DEFAULT_IGNORED_ROOTS,
    ...userEntries
      .map(parseIgnoredRootMatcher)
      .filter((m): m is IgnoredRootMatcher => m !== null),
  ];
}

/** What a matcher is compared with: read off an element, or out of a DOM profile one value at a time. */
export interface IgnoredRootTarget {
  id?: string;
  tag?: string;
  classes?: readonly string[];
  src?: string;
  attributeNames?: readonly string[];
}

/** The first matcher in `policy` that `target` satisfies, or null. */
export function matchIgnoredRootTarget(
  target: IgnoredRootTarget,
  policy: readonly IgnoredRootMatcher[],
): IgnoredRootMatcher | null {
  const id = target.id?.toLowerCase() ?? "";
  const tag = target.tag?.toLowerCase() ?? "";
  const src = target.src?.toLowerCase() ?? "";
  const classes = (target.classes ?? []).map((token) => token.toLowerCase());
  const names = (target.attributeNames ?? []).map((name) => name.toLowerCase());
  for (const m of policy) {
    const value = m.value.toLowerCase();
    switch (m.kind) {
      case "id-prefix":
        if (id.startsWith(value)) return m;
        break;
      case "tag":
        if (tag === value) return m;
        break;
      case "src-prefix":
        if (src.startsWith(value)) return m;
        break;
      case "class-prefix":
        if (classes.some((token) => token.startsWith(value))) return m;
        break;
      case "attribute-prefix":
        if (names.some((name) => name.startsWith(value))) return m;
        break;
    }
  }
  return null;
}

/** The matcher `element` itself satisfies, or null. Ancestors are not consulted, and attribute markers never make a root. */
export function matchIgnoredRoot(
  element: Element,
  policy: readonly IgnoredRootMatcher[],
): IgnoredRootMatcher | null {
  return matchIgnoredRootTarget(
    {
      id: element.id,
      tag: element.localName,
      classes: (element.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter(Boolean),
      src: element.getAttribute("src") ?? "",
    },
    policy,
  );
}

/** The outermost ignored root `element` sits in (itself included), across shadow boundaries, or null. */
export function ignoredRootOf(
  element: Element,
  policy: readonly IgnoredRootMatcher[],
): Element | null {
  let outermost: Element | null = null;
  for (
    let current: Element | null = element;
    current;
    current = composedParentElement(current)
  ) {
    if (matchIgnoredRoot(current, policy)) outermost = current;
  }
  return outermost;
}

export interface ExcludedRootSummary {
  /** `describeMatcher` of the matcher that excluded it. */
  matcher: string;
  owner: string;
  evidence: IgnoredRootMatcher["evidence"];
  /** Outermost matching elements. */
  roots: number;
  /** Elements in those subtrees, roots included, shadow content included. */
  elementCount: number;
}

/** Merge per-frame or per-snapshot summaries by matcher. */
export function mergeExcludedRoots(
  lists: ReadonlyArray<readonly ExcludedRootSummary[]>,
): ExcludedRootSummary[] {
  const byMatcher = new Map<string, ExcludedRootSummary>();
  for (const list of lists) {
    for (const entry of list) {
      const existing = byMatcher.get(entry.matcher);
      if (existing) {
        existing.roots += entry.roots;
        existing.elementCount += entry.elementCount;
      } else {
        byMatcher.set(entry.matcher, { ...entry });
      }
    }
  }
  return [...byMatcher.values()].sort((a, b) =>
    a.matcher.localeCompare(b.matcher),
  );
}

/**
 * Find every ignored root in `root`'s composed tree and count what each
 * one removes. The walk does not descend into a root once found: its
 * subtree is counted, not inspected.
 */
export function findIgnoredRoots(
  root: Document | ShadowRoot,
  policy: readonly IgnoredRootMatcher[],
): {
  roots: Element[];
  /** Every element inside an ignored root, roots included. */
  excluded: ReadonlySet<Element>;
  summary: ExcludedRootSummary[];
} {
  const roots: Element[] = [];
  const byMatcher = new Map<string, ExcludedRootSummary>();
  /** Every element inside an ignored root, mapped to that root's summary entry. */
  const entryOf = new Map<Element, ExcludedRootSummary>();
  walkComposedTree(root, (element) => {
    const parent = composedParentElement(element);
    const inherited = parent ? entryOf.get(parent) : undefined;
    if (inherited) {
      inherited.elementCount++;
      entryOf.set(element, inherited);
      return true;
    }
    const m = matchIgnoredRoot(element, policy);
    if (!m) return true;
    const key = describeMatcher(m);
    const entry = byMatcher.get(key) ?? {
      matcher: key,
      owner: m.owner,
      evidence: m.evidence,
      roots: 0,
      elementCount: 0,
    };
    entry.roots++;
    entry.elementCount++;
    byMatcher.set(key, entry);
    entryOf.set(element, entry);
    roots.push(element);
    return true;
  });
  return {
    roots,
    excluded: new Set(entryOf.keys()),
    summary: mergeExcludedRoots([[...byMatcher.values()]]),
  };
}
