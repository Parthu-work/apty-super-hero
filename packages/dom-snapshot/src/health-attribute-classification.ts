/**
 * Apty selector-generation configuration — Ignore Selector, Partial
 * Selector, and Attribute Priority — reconstructed from the REAL Apty
 * Studio extension (build `studio-extension_63`, specifically
 * `workflowPreview.js` modules 65913 (`initAttributes`/`addAttribute`) and
 * 92317 (`initOptions`/`defaultIgnore`)), not invented. A prior session
 * built these as a flat `{attribute: string}[]` rule list before any real
 * Apty source was available; that shape has been replaced entirely now
 * that the real one is known. See `docs/development/des-engine.md` for the
 * full reverse-engineering notes, including what could not be recovered
 * with confidence from the minified bundle.
 *
 * Real shape and precedence (module 65913's `addAttribute`, confirmed by
 * reading the actual minified-but-unmangled function): Ignore Selector and
 * Partial Selector are both FUNCTIONS keyed by attribute name, never a
 * flat rule list. For a given attribute, the Partial function is called
 * FIRST; only when it returns nothing does the Ignore function get
 * consulted at all. A Partial function returns the STABLE SUBSTRING(S) to
 * anchor on (a string or string array), not a boolean — the engine then
 * classifies each returned substring's relationship to the original value
 * as "prefix"/"suffix"/"partial" by whether the original value starts or
 * ends with it.
 */

export type AttributeSelectionType = "exact" | "prefix" | "suffix" | "partial";

/** `defaultFn` is the built-in default for this same key, passed through so a configured function can call it and extend rather than fully replace the default (mirrors the real `addAttribute`'s `r(e,t,n,r)` fallback pattern). */
export type IgnoreFn = (
  name: string,
  value?: string,
  defaultFn?: IgnoreFn,
) => boolean;

/** Returns the stable substring(s) to partial-match on, or undefined/empty when this value has no safe stable portion. */
export type PartialFn = (
  name: string,
  value: string,
) => string | string[] | undefined;

export interface IgnoreConfig {
  attribute?: IgnoreFn;
  class?: IgnoreFn;
  tag?: IgnoreFn;
  contains?: IgnoreFn;
  /** Per-attribute-name override, e.g. `ignore["data-row-id"]`. */
  [attributeName: string]: IgnoreFn | undefined;
}

export type PartialConfig = Record<string, PartialFn | undefined>;

/**
 * Real default ignore heuristic (`workflowPreview.js` module 92317,
 * `t.defaultIgnore`) — deliberately far coarser than a general "does this
 * look machine-generated" classifier: a small attribute-name blocklist,
 * `id`/`for` values containing 2+ consecutive digits anywhere, and classes
 * literally prefixed `tether` (a popup-positioning library Apty
 * special-cases). Nothing else is excluded by default — an arbitrary
 * `data-*` attribute, a non-id/for attribute containing digits, or a class
 * token that merely *looks* generated is INCLUDED by default unless Studio
 * configuration adds a rule for it. This is a real, confirmed divergence
 * from the previous (invented) `looksDynamic` classifier in
 * `health-dynamic.ts`, which is a different, unrelated heuristic used
 * elsewhere in this package and left untouched.
 */
export const DEFAULT_IGNORE: {
  attribute: IgnoreFn;
  class: IgnoreFn;
  tag: IgnoreFn;
  contains: IgnoreFn;
} = {
  attribute: (name, value) => {
    if (
      [
        "style",
        "data-reactid",
        "data-react-checksum",
        "tabindex",
        "apty-observer-added",
      ].includes(name)
    ) {
      return true;
    }
    if (value && ["id", "for"].includes(name) && /\d{2,}/.test(value)) {
      return true;
    }
    return /(^xmlns:)|lnid|apty/.test(name);
  },
  class: (name) => name.startsWith("tether"),
  tag: () => false,
  contains: () => false,
};

/**
 * Real default priority (`workflowPreview.js` module 92317, `initOptions`'s
 * `priority: r||["id","class","href","src"]`) — no built-in preference for
 * `data-testid`/`aria-label`/`name`/`role` at all. Those only get tried
 * before everything else when Studio configuration adds them via
 * `partialSelectorAttributes`, which always takes precedence over the
 * priority list regardless of its own order (see `resolveAttributeOrder`).
 */
export const DEFAULT_PRIORITY: readonly string[] = [
  "id",
  "class",
  "href",
  "src",
];

export interface DesConfig {
  priority: readonly string[];
  ignore: IgnoreConfig;
  partialSelectors?: PartialConfig;
  /** Attribute names always tried first, ahead of `priority`, when building a selector (real `initAttributes`: `partialSelectorAttributes` is unshifted ahead of the priority-ordered list). */
  partialSelectorAttributes?: readonly string[];
  /** CSS selectors identifying a container to root path-building/searching at, instead of walking all the way to `document.body` (real `scopeRootSelectors`/`getScopeRootForElement`). */
  scopeRootSelectors?: readonly string[];
  /** Real `elementMatches`: when false (the default), a selector matching several elements is still treated as resolved if exactly one of them is actually rendered/visible. */
  strictUniqueness: boolean;
  /** Recovery-search acceptance floors (real `find()`, module 15906): 0.92 early-accepts the first rendered candidate found while still iterating strategies; 0.90 is the final fallback floor once every strategy is exhausted. Both are fixed Apty constants, never tuned per fixture. */
  earlyAcceptScore: number;
  fallbackAcceptScore: number;
  /** `checkContainersScore`'s (module 74456) required fraction of originally-captured ancestor-container selectors that must still resolve to something before trusting an otherwise-unique direct hit. */
  containerScoreThreshold: number;
  /** Bound on ancestor climb / candidate pool depth (real `find()` caps candidate pools at 50; this package reuses that constant rather than inventing a new one). */
  candidateCeiling: number;
}

export const DEFAULT_DES_CONFIG: DesConfig = {
  priority: DEFAULT_PRIORITY,
  ignore: {},
  strictUniqueness: false,
  earlyAcceptScore: 0.92,
  fallbackAcceptScore: 0.9,
  containerScoreThreshold: 0.5,
  candidateCeiling: 50,
};

/** Attribute-name order to try attributes in when building a pattern: `partialSelectorAttributes` first (real `initAttributes`), then `priority`-ordered present attributes, then every other present attribute in original document order. */
export function resolveAttributeOrder(
  presentAttributeNames: readonly string[],
  config: DesConfig,
): string[] {
  const priorityFirst = [
    ...config.priority.filter((name) => presentAttributeNames.includes(name)),
    ...presentAttributeNames.filter((name) => !config.priority.includes(name)),
  ];
  const partialFirst = config.partialSelectorAttributes?.length
    ? [
        ...config.partialSelectorAttributes,
        ...priorityFirst.filter(
          (name) => !config.partialSelectorAttributes!.includes(name),
        ),
      ]
    : priorityFirst;
  return partialFirst;
}

function ignoreFnFor(config: DesConfig, key: string): IgnoreFn {
  const configured = config.ignore[key];
  const defaultFn =
    key === "class" || key === "tag" || key === "contains"
      ? DEFAULT_IGNORE[key]
      : DEFAULT_IGNORE.attribute;
  if (configured) {
    return (name, value) => configured(name, value, defaultFn);
  }
  return defaultFn;
}

/** The ignore function to use for one specific attribute name — a per-name override (`config.ignore[name]`) if present, else the general attribute-ignore function. */
export function ignoreFnForAttribute(
  config: DesConfig,
  name: string,
): IgnoreFn {
  const perAttribute = config.ignore[name];
  const general = ignoreFnFor(config, "attribute");
  if (perAttribute) {
    return (n, v) => perAttribute(n, v, general);
  }
  return general;
}

export function ignoreFnForClass(config: DesConfig): IgnoreFn {
  return ignoreFnFor(config, "class");
}

export function ignoreFnForTag(config: DesConfig): IgnoreFn {
  return ignoreFnFor(config, "tag");
}

export function ignoreFnForContains(config: DesConfig): IgnoreFn {
  return ignoreFnFor(config, "contains");
}

export function partialFnForAttribute(
  config: DesConfig,
  name: string,
): PartialFn | undefined {
  return config.partialSelectors?.[name];
}

/**
 * Real runtime-recovery dynamic-value heuristic (`workflowPreview.js`
 * module 81948, `t.isValueDynamic`) — used ONLY by the recovery strategy
 * that drops dynamic-looking values from an already-built path when the
 * literal captured path fails to resolve. This is deliberately a
 * DIFFERENT, cruder check than `DEFAULT_IGNORE` above (which governs what
 * goes into a pattern at capture time): a value is "dynamic" here if it is
 * a bare digit string, contains any run of 3+ consecutive digits, or is
 * more than half digit characters by count.
 */
export function isValueDynamic(value: string): boolean {
  if (value.length === 0) return false;
  if (/^\d+$/.test(value) || /\d{3}/.test(value)) return true;
  let digitCount = 0;
  for (const ch of value) {
    if (ch >= "0" && ch <= "9") digitCount++;
  }
  return digitCount / value.length > 0.5;
}
