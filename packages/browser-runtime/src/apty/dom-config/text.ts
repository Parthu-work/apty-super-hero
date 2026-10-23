import { piiShapeOf } from "@apty/dom-snapshot";

export {
  isSafeLiteral,
  type PiiShape,
  piiShapeOf,
  queryParams,
  toUrlShape,
} from "@apty/dom-snapshot";

/** Code-unit order: the same on every machine and locale, unlike `localeCompare`. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
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

/** The value with its query removed, used to pair the same link across runs. */
export function withoutQuery(value: string): string {
  const end = value.search(/[?#]/);
  return end === -1 ? value : value.slice(0, end);
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
