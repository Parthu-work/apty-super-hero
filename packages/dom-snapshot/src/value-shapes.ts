/**
 * What a value or URL may be reduced to before it is kept or shown: PII
 * shapes, identifier-shaped literals, and URL shapes (DOM Config D2, D3,
 * D11). Pure string functions, shared by the DOM profile collector in the
 * page and the DOM Config engine in the extension.
 */
import { applyUrlPolicy } from "./value-policy.js";

export type PiiShape = "email" | "phone" | "digits";

/** Each pattern does bounded work per start position, so a long value costs linear time. */
const EMAIL_SHAPE = /[^\s@<>"'`]@[^\s@<>"'`]+\.[a-z]{2,}/i;
const PHONE_SHAPE =
  /(?<!\d)(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?!\d)/;
const LONG_DIGIT_RUN = /\d{5,}/;

/** Emails, phone-number shapes and runs of 5+ digits. Person names have no shape and are not detected. */
export function piiShapeOf(value: string): PiiShape | null {
  if (value.includes("@") && EMAIL_SHAPE.test(value)) return "email";
  if (PHONE_SHAPE.test(value)) return "phone";
  if (LONG_DIGIT_RUN.test(value)) return "digits";
  return null;
}

const IDENTIFIER_FRAGMENT = /^[A-Za-z0-9_.:-]{1,32}$/;

/** A literal that may be kept or shown: short, identifier-shaped, no PII shape. */
export function isSafeLiteral(text: string): boolean {
  return IDENTIFIER_FRAGMENT.test(text) && piiShapeOf(text) === null;
}

/** The query of a URL-shaped value: everything after the first `?`, up to a `#`. */
function queryOf(value: string): string | null {
  const start = value.indexOf("?");
  if (start === -1) return null;
  const hash = value.indexOf("#", start);
  return value.slice(start + 1, hash === -1 ? undefined : hash);
}

/** Parameter names and values of a URL-shaped value, in order; empty when it has no query. */
export function queryParams(value: string): Array<[string, string]> {
  const query = queryOf(value);
  if (!query) return [];
  return query
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      return eq === -1 ? [pair, ""] : [pair.slice(0, eq), pair.slice(eq + 1)];
    });
}

const MEDIA_TYPE = /^[a-z]+\/[a-z0-9.+-]+$/i;

/** A URL that carries its content in itself: only its scheme, and a `data:` URL's media type, are kept. */
function inlineContentShape(url: string): string | null {
  const scheme = /^\s*(data|javascript):/i.exec(url)?.[1]?.toLowerCase();
  if (!scheme) return null;
  if (scheme === "javascript") return "javascript:";
  const mediaType = url.slice(url.indexOf(":") + 1).split(/[;,]/)[0] ?? "";
  return MEDIA_TYPE.test(mediaType)
    ? `data:${mediaType.toLowerCase()}`
    : "data:";
}

/**
 * The path through the strict path policy (record numbers, GUIDs and
 * emails become `:id` / `:email`) and the query reduced to parameter
 * names; a name that is not identifier-shaped is dropped. A `data:` or
 * `javascript:` URL keeps only its scheme (and media type), since the rest
 * is content.
 */
export function toUrlShape(url: string): string {
  const inline = inlineContentShape(url);
  if (inline !== null) return inline;
  const path = applyUrlPolicy(url, "withhold") ?? "";
  const names = [
    ...new Set(
      queryParams(url)
        .map(([name]) => name)
        .filter(isSafeLiteral),
    ),
  ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return names.length ? `${path}?${names.join("&")}` : path;
}
