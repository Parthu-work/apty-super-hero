/**
 * Values a model may pass into page CSS. Anything else could close the rule
 * and load a URL from the page (`red} body{background:url(…)}`).
 */

const NAMED_COLOR = /^[a-z]{3,30}$/i;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const NUMBER = String.raw`\s*\d{1,3}(?:\.\d+)?%?\s*`;
const FUNCTION_COLOR = new RegExp(
  String.raw`^(?:rgba?|hsla?)\(${NUMBER},${NUMBER},${NUMBER}(?:,\s*(?:\d?\.\d+|[01])\s*)?\)$`,
  "i",
);
const FONT_WEIGHT = /^(?:normal|bold|[1-9]00)$/;

/** @internal */
export function isSafeCssColor(value: string): boolean {
  return (
    NAMED_COLOR.test(value) ||
    HEX_COLOR.test(value) ||
    FUNCTION_COLOR.test(value)
  );
}

/** @internal */
export function isSafeFontWeight(value: string): boolean {
  return FONT_WEIGHT.test(value);
}

/** A message naming the first unsafe value, or null when every given value is safe. */
export function cssValueError(values: {
  colors: Record<string, string | null | undefined>;
  fontWeight?: string | null;
}): string | null {
  for (const [name, value] of Object.entries(values.colors)) {
    if (value != null && !isSafeCssColor(value)) {
      return `${name} must be a named colour, #rgb, #rrggbb, or rgb()/rgba()/hsl()/hsla() with numbers.`;
    }
  }
  if (values.fontWeight != null && !isSafeFontWeight(values.fontWeight)) {
    return "fontWeight must be normal, bold, or 100-900 in steps of 100.";
  }
  return null;
}
