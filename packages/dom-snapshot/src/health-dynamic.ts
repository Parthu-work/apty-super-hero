/**
 * Dynamic-value detection shared by the DOM Health selector engine.
 *
 * Two distinct signals feed the "is this dynamic" question, and callers
 * should not conflate them:
 *  - `looksDynamic()` is a cheap, single-observation regex heuristic
 *    ("this value's *shape* suggests it's machine-generated").
 *  - Actually observing the same element's attribute change value across
 *    two or more snapshots (done in `health-collector.ts` via the element
 *    registry) is real evidence, and must be weighted higher than the
 *    heuristic alone — see `DynamicAttributeStats.hasMultiSnapshotEvidence`.
 *
 * This is the canonical definition of "looks dynamic" for the DOM Health
 * feature. `@apty/browser-runtime`'s `automation/selector-analysis.ts`
 * re-exports it from here rather than keeping its own copy, so the two
 * features can't quietly drift apart on what counts as "generated".
 */

/** Framework/tooling prefixes that generate non-deterministic class/id names on every build or render. */
const DYNAMIC_PREFIXES = [
  "css-", // styled-components / emotion
  "sc-", // styled-components
  "jss", // JSS
  "ember", // Ember.js auto-generated ids
  "react-select-", // react-select instance ids
  "mui-", // MUI auto-generated ids (lowercase form)
];

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** A trailing run of 4+ digits or a 6+ char hex-looking suffix, e.g. "input-928731" or "btn-4f9a21". */
const DYNAMIC_SUFFIX_PATTERN = /[-_:]?(\d{4,}|[0-9a-f]{6,})$/i;
/** A value that is *entirely* numeric (e.g. an auto-incrementing id: "382910"). */
const ALL_NUMERIC_PATTERN = /^\d+$/;

/**
 * Heuristic check for whether an id/class value looks machine-generated
 * and likely to change on the next build/render, as opposed to a stable,
 * intentionally-authored name. Single-observation signal only — see
 * module docstring.
 */
export function looksDynamic(value: string): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (ALL_NUMERIC_PATTERN.test(trimmed)) return true;
  if (UUID_PATTERN.test(trimmed)) return true;
  if (DYNAMIC_SUFFIX_PATTERN.test(trimmed)) return true;
  return DYNAMIC_PREFIXES.some((prefix) =>
    trimmed.toLowerCase().startsWith(prefix),
  );
}

const MIN_STABLE_PREFIX_LENGTH = 3;

/**
 * Discover a stable leading substring of a dynamic-looking value, for the
 * partial-selector-strategy simulation (spec section 11), e.g.
 * "app-wrapper-AIZdsf3f" -> "app-wrapper-". Returns null when no safe
 * prefix can be found (the value is dynamic through-and-through, e.g. a
 * bare UUID or an all-numeric id) — callers must never fabricate a partial
 * candidate from a null result.
 */
export function extractStablePrefix(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (ALL_NUMERIC_PATTERN.test(trimmed)) return null;

  const uuidMatch = trimmed.match(UUID_PATTERN);
  if (uuidMatch?.index) {
    const prefix = trimmed.slice(0, uuidMatch.index);
    return prefix.length >= MIN_STABLE_PREFIX_LENGTH ? prefix : null;
  }

  const suffixMatch = trimmed.match(DYNAMIC_SUFFIX_PATTERN);
  if (suffixMatch?.index !== undefined && suffixMatch.index > 0) {
    const prefix = trimmed.slice(0, suffixMatch.index);
    return prefix.length >= MIN_STABLE_PREFIX_LENGTH ? prefix : null;
  }

  // Shape-only prefixes (css-/sc-/jss/...) have no stable remainder worth
  // matching on — the whole value is the framework's generated token.
  return null;
}
