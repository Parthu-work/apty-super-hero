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

/** Reference configurations use 75; `DEFAULT_DES_CONFIG.containerScoreThreshold` is 0.5. The units may differ (open question 5). */
export const REFERENCE_CONTAINER_SCORE_THRESHOLD = 75;

export const DEBOUNCE_DEFAULT_MS = 500;
export const DEBOUNCE_MIN_MS = 200;
export const DEBOUNCE_MAX_MS = 1_500;
export const DEBOUNCE_P90_FACTOR = 1.2;

/** Events per second above which an event is worth ignoring. */
export const HIGH_FREQUENCY_EVENTS_PER_SECOND = 20;

export const LARGE_DOM_DIVS = 2_000;

export const MAX_PRIORITY_ATTRIBUTES = 6;
