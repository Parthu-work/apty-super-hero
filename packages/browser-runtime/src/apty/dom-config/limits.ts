export const DOM_CONFIG_TOOL_VERSION = "dom-config-engine/1";
export const DOM_CONFIG_RULE_LIST_VERSION = "dom-config-rules/1";

/** What the engine holds and produces at most (D10). Anything cut is listed in the report's truncations. */
export const DOM_CONFIG_LIMITS = {
  /** One pasted or loaded profile. */
  maxInputChars: 20_000_000,
  maxPages: 200,
  maxRunsPerPage: 8,
  maxNestingDepth: 32,
  maxDistinctValuesPerAttribute: 5_000,
  maxStoredValueLength: 512,
  /** Total characters of attribute values held for one run. */
  maxStoredCharsPerRun: 8_000_000,
  maxRegexLength: 256,
  maxRules: 400,
  maxDiffEntriesPerPair: 200,
  maxExamples: 3,
  maxWeakSelectors: 20,
} as const;

/** D4: an icon an extension draws with an inline z-index at or above this sits on top of everything and is not the application's. */
export const EXTENSION_Z_INDEX = 999_999;

export const MAX_APTY_Z_INDEX = 2_147_483_647;
export const RECOMMENDED_APTY_Z_INDEX = 2_147_483_646;

/** Apty's application mapper hard-codes 75; Studio divides it by 100. */
export const APTY_CONTAINER_SCORE_THRESHOLD = 75;

/** `DomChangeService`: `domDebounceTime ?? 100`. */
export const DEBOUNCE_DEFAULT_MS = 100;
/** Never below Apty's own default. */
export const DEBOUNCE_MIN_MS = 100;
export const DEBOUNCE_MAX_MS = 1_500;
export const DEBOUNCE_P90_FACTOR = 1.2;

/** An element changing this often (observer callbacks per second), at least `CONTINUOUS_MIN_CALLBACKS` times, changes continuously: a clock ticks once a second. */
export const CONTINUOUS_CALLBACKS_PER_SECOND = 0.9;
export const CONTINUOUS_MIN_CALLBACKS = 3;

/** An element with this many descendants is a container, never proposed for Ignore DOM events. */
export const LARGE_CONTAINER_DESCENDANTS = 200;

export const LARGE_DOM_DIVS = 2_000;

export const MAX_PRIORITY_ATTRIBUTES = 6;
