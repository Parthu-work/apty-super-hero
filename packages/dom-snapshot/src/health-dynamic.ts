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
 * Generated-value shapes measured in real enterprise exports (DOM Health
 * brief, section 2.3), each one a value the patterns above let through.
 */
const GENERATED_PATTERNS: ReadonlyArray<{ pattern: RegExp; source: string }> = [
  {
    // athenaOne: `react-aria6837631407-:r0:`, `react-aria6745925057-:IXP0RLQXNUQr6:`.
    // The trailing `:` defeated DYNAMIC_SUFFIX_PATTERN.
    pattern: /^react-aria\d+-:[A-Za-z0-9]+:$/,
    source: "athenaOne react-aria ids",
  },
  {
    // React 18 `useId()` output without a library prefix. From general
    // knowledge of React; not seen bare in the exports, only inside the
    // react-aria form above.
    pattern: /^:r[0-9a-z]+:$/,
    source: "React useId (unverified against a real application)",
  },
  {
    // athenaOne: `_pendo-badge_2kHDZJNfO4ClXH-2ZnYuy6eYB_8`,
    // `pendo-image-badge-5762de01` (Pendo digital-adoption overlay).
    pattern: /^_?pendo/i,
    source: "athenaOne Pendo overlay",
  },
  {
    // Infor LN: `clip0_111_14045`, `clip0_5976_20` (the short tail let the
    // second through), and the gradient family `paint0_radial_99_3829`.
    pattern: /^(?:clip|paint)\d+_/,
    source: "Infor LN SVG ids",
  },
  {
    // athenaOne Forge (Emotion with key `fe-c`): `fe-c-7pg0cj-a11yText`,
    // `fe-c-1mkvw8y`. The hash is mid-token, so no prefix or suffix rule
    // applied.
    pattern: /^fe-c-[a-z0-9]+(?:-|$)/,
    source: "athenaOne Emotion classes",
  },
  {
    // Infor LN: `ng-tns-c349936244-0`, Angular's animation namespace class,
    // numbered per build like `_ngcontent-ng-c*`.
    pattern: /^ng-tns-c\d+-\d+$/,
    source: "Infor LN Angular animation class",
  },
];

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
  if (GENERATED_PATTERNS.some(({ pattern }) => pattern.test(trimmed))) {
    return true;
  }
  return DYNAMIC_PREFIXES.some((prefix) =>
    trimmed.toLowerCase().startsWith(prefix),
  );
}

/**
 * Why a class token is not identity. `generated`: per build or render.
 * `state`: per interaction (disabled, selected). `environment`: per
 * browser, OS, theme or deployment. `build`: per release.
 */
export type UnstableClassKind = "generated" | "state" | "environment" | "build";

/**
 * Browser, OS, rendering-mode, theme and deployment classes. Measured:
 * `is-chrome is-mac theme-new-light` on Infor LN's `<html>`;
 * `standards preview-background` on athenaOne's `<html>` and `safari` on
 * its `#tasknotifier`. `is-windows` and `quirks` come from the brief's
 * list (section 4.8) and were not seen in the exports.
 */
const ENVIRONMENT_CLASS_PATTERN =
  /^(?:is-(?:chrome|mac|windows)|safari|standards|quirks|theme-.+|preview-.+)$/i;

/**
 * Interaction-state classes. Measured: `fe_is-disabled` (65 times in the
 * athenaOne Patient Registration export), `fe_is-required`,
 * `fe_c_select--is-disabled`; Infor LN's active tab `selected pinned` and
 * its hidden menu items' `osp-display-none`. The bare state words are the
 * brief's list (section 4.8) plus `pinned`.
 */
const STATE_CLASS_PATTERN =
  /^(?:selected|active|disabled|open|expanded|collapsed|focus|focused|hover|required|invalid|error|pinned)$/i;

/** `is-…`, `…--is-…`, `…_is-…` and `…-display-none`, written without nested `.+` so a long token cannot make it backtrack. */
const STATE_CLASS_MARKER = /^is-.|.(?:--|_)is-.|.[-_]display-none$/i;

/**
 * Package-version classes athenaOne's Nimbus loader puts on every app
 * root: `anet-bookmark--2_1_0`, `forge--17_1_0`,
 * `react--18_2_0-jsx-runtime-client`. They change with each release.
 */
const PACKAGE_VERSION_CLASS_PATTERN = /--\d+_\d+_\d+(?:$|-)/;

/**
 * styled-components emits a component id (`sc-bdvvtL`) next to a generated
 * class (`goIptw`). Measured in athenaOne: `sc-bdvvtL goIptw`,
 * `sc-eCImPb hyZcLS`, `sc-gsDKAQ erBbkF`. The partner token is only
 * recognisable next to its `sc-` id, so this needs the whole class list.
 */
const STYLED_COMPONENTS_PARTNER = /^[A-Za-z]{5,7}$/;

/** Why `token` is not identity, or null when it is a stable, authored class. `siblings` is the element's whole class list. */
export function classifyUnstableClass(
  token: string,
  siblings: readonly string[] = [],
): UnstableClassKind | null {
  if (ENVIRONMENT_CLASS_PATTERN.test(token)) return "environment";
  if (STATE_CLASS_PATTERN.test(token) || STATE_CLASS_MARKER.test(token)) {
    return "state";
  }
  if (PACKAGE_VERSION_CLASS_PATTERN.test(token)) return "build";
  if (looksDynamic(token)) return "generated";
  if (
    STYLED_COMPONENTS_PARTNER.test(token) &&
    /[a-z]/.test(token) &&
    /[A-Z]/.test(token) &&
    siblings.some((other) => other.startsWith("sc-"))
  ) {
    return "generated";
  }
  return null;
}

const MIN_STABLE_PREFIX_LENGTH = 3;

/**
 * react-select instance ids: `react-select-<instance>-<part>`. Measured in
 * athenaOne: `react-select-94dJfC-input`, `react-select-TXQoB6-live-region`,
 * `react-select-94dJfC-placeholder`, `react-select-b2qe-m-input` (an
 * instance token can itself contain `-`). The parts are the ones observed.
 */
const REACT_SELECT_INSTANCE_PATTERN =
  /^(react-select-)[A-Za-z0-9_-]+?(-(?:input|placeholder|live-region))$/;

/**
 * Emotion class with a label after the hash: `fe-c-<hash>-<label>`, e.g.
 * athenaOne's `fe-c-1xc3v61-indicatorContainer`. The label is the stable
 * part; a bare `fe-c-1mkvw8y` has none.
 */
const EMOTION_LABEL_PATTERN = /^fe-c-[a-z0-9]+(-[A-Za-z][A-Za-z0-9]*)$/;

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

  const reactSelect = trimmed.match(REACT_SELECT_INSTANCE_PATTERN);
  if (reactSelect) return reactSelect[1]!;

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

/**
 * The stable trailing part of a generated value, for a suffix partial
 * selector (`[attr$="…"]`): `-indicatorContainer` from
 * `fe-c-1xc3v61-indicatorContainer`, `-input` from
 * `react-select-94dJfC-input`. Null when the value has no stable tail.
 */
export function extractStableSuffix(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match =
    trimmed.match(REACT_SELECT_INSTANCE_PATTERN) ??
    trimmed.match(EMOTION_LABEL_PATTERN);
  const suffix = match?.[match.length - 1];
  return suffix && suffix.length >= MIN_STABLE_PREFIX_LENGTH ? suffix : null;
}
