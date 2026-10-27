/**
 * The host a chat is about, as its record keeps it: the hostname of an
 * http(s) page and nothing else — no scheme, port, path, query, fragment
 * or page title. Undefined for any other page (a browser page, a file, no
 * page).
 */
export function siteHostOf(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.hostname || undefined;
  } catch {
    return undefined;
  }
}
