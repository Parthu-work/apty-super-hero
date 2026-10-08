/**
 * Shared helpers for turning a captured network response into something
 * safe and bounded to hand to the model — used by both response-body
 * retrieval paths this codebase has: `extension-network-inspector.ts`
 * (cross-extension messaging, a separate Apty Client extension reports
 * its own observed resources) and `network-capture-session.ts` (CDP
 * `chrome.debugger` capture against the current tab, see that file's own
 * header for why these are architecturally different transports). Both
 * need the identical decode/classify/bound logic — extracted here once
 * so neither can silently drift from the other.
 */

/** Preview cap for inline chat/tool-result display — keeps a single response from dominating a tool result. */
export const MAX_INLINE_BODY_CHARS = 8000;

const TEXTUAL_MIME_PATTERN =
  /^(text\/|application\/json|application\/javascript|application\/xml|application\/x-www-form-urlencoded)/i;

export function isTextualMime(mimeType: string | undefined): boolean {
  return !mimeType || TEXTUAL_MIME_PATTERN.test(mimeType);
}

export function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * True when `url` matches a deny-list entry: a bare host matches that host
 * and its subdomains, anything else matches as a URL substring.
 */
export function isUrlDenied(url: string, denyList: readonly string[]): boolean {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // Not a parseable URL: only substring entries can match.
  }
  const lowerUrl = url.toLowerCase();
  return denyList.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry) return false;
    if (/^[a-z0-9.-]+$/.test(entry) && host) {
      return host === entry || host.endsWith(`.${entry}`);
    }
    return lowerUrl.includes(entry);
  });
}

/** The last path segment of a URL, query string stripped — e.g. `https://x.com/api/segments.json?v=2` -> `segments.json`. Falls back to the whole (query-stripped) URL if there's no `/`. */
export function resourceNameFor(url: string): string {
  const withoutQuery = url.split("?")[0] ?? url;
  const segments = withoutQuery.split("/").filter(Boolean);
  return segments[segments.length - 1] || withoutQuery;
}
