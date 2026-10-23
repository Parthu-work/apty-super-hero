import { applyUrlPolicy } from "@apty/dom-snapshot";

/** Code-unit order: the same on every machine and locale, unlike `localeCompare`. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

export type PiiShape = "email" | "phone" | "digits";

/** Each pattern does bounded work per start position, so a long value costs linear time. */
const EMAIL_SHAPE = /[^\s@<>"'`]@[^\s@<>"'`]+\.[a-z]{2,}/i;
const PHONE_SHAPE =
  /(?<!\d)(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?!\d)/;
const LONG_DIGIT_RUN = /\d{5,}/;

/** D2: emails, phone-number shapes and runs of 5+ digits. Person names have no shape and are not detected. */
export function piiShapeOf(value: string): PiiShape | null {
  if (value.includes("@") && EMAIL_SHAPE.test(value)) return "email";
  if (PHONE_SHAPE.test(value)) return "phone";
  if (LONG_DIGIT_RUN.test(value)) return "digits";
  return null;
}

const IDENTIFIER_FRAGMENT = /^[A-Za-z0-9_.:-]{1,32}$/;

/** D3: a literal that may appear in a rule or as an example: short, identifier-shaped, no PII shape. */
export function isSafeLiteral(text: string): boolean {
  return IDENTIFIER_FRAGMENT.test(text) && piiShapeOf(text) === null;
}

export const PII_HIDDEN = "[PII value hidden]";
export const VALUE_WITHHELD = "[value withheld]";
const MAX_DISPLAY_LENGTH = 120;

/** A value as the report may show it in a diff: never a PII shape, never longer than a line. */
export function displayValue(value: string): string {
  if (piiShapeOf(value)) return PII_HIDDEN;
  return value.length > MAX_DISPLAY_LENGTH
    ? `${value.slice(0, MAX_DISPLAY_LENGTH)}…`
    : value;
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

/** The value with its query removed, used to pair the same link across runs. */
export function withoutQuery(value: string): string {
  const end = value.search(/[?#]/);
  return end === -1 ? value : value.slice(0, end);
}

/**
 * D11: the path through the strict path policy (record numbers, GUIDs and
 * emails become `:id` / `:email`) and the query reduced to parameter
 * names. A name that is not identifier-shaped is dropped.
 */
export function toUrlShape(url: string): string {
  const path = applyUrlPolicy(url, "withhold") ?? "";
  const names = sortedUnique(
    queryParams(url)
      .map(([name]) => name)
      .filter(isSafeLiteral),
  );
  return names.length ? `${path}?${names.join("&")}` : path;
}

const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "poster",
  "cite",
  "background",
  "data-url",
  "data-href",
  "data-src",
]);
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function isUrlLike(name: string, value: string): boolean {
  return (
    URL_ATTRIBUTES.has(name) ||
    HAS_SCHEME.test(value) ||
    value.startsWith("/") ||
    value.startsWith("?")
  );
}

const DIGIT_RUN = /\d+/g;
/** Stands for a digit run inside a skeleton; never occurs in an attribute value. */
export const DIGIT_SLOT = "\u0000";

/** The value with every digit run replaced by one slot: values sharing a skeleton differ only in their digits. */
export function skeletonOf(value: string): string {
  return value.replace(DIGIT_RUN, DIGIT_SLOT);
}

export function hasDigitSlot(skeleton: string): boolean {
  return skeleton.includes(DIGIT_SLOT);
}
