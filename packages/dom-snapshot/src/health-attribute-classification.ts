/**
 * Apty selector-generation configuration — Ignore Selector, Partial
 * Selector and Attribute Priority — ported from Apty's own
 * `lib-client-element-identification` (`options.ts`, `pattern.ts`). An
 * earlier version was reconstructed from the minified Studio build 63;
 * the defaults and the class handling below now follow the source.
 *
 * Shape and precedence (`pattern.ts` `addAttribute`): Ignore Selector and
 * Partial Selector are both FUNCTIONS keyed by attribute name. For a given
 * attribute the Partial function is called FIRST; a non-empty result
 * bypasses every ignore rule. A Partial function returns the STABLE
 * SUBSTRING(S) to anchor on, and each one becomes a `^=`, `$=` or `*=`
 * condition by where it sat in the original value.
 *
 * Classes take two passes: the attribute ignore sees the WHOLE `class`
 * value (a hit drops every class on the element), then each token goes
 * through the class ignore (`tether*` by default).
 */

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
 * Framework noise ignored by default that an application re-enables by
 * listing it in its attribute priority (`options.ts`
 * `OVERRIDABLE_IGNORED_ATTRIBUTES`). Apty-internal attributes and the
 * digit heuristic always apply.
 */
export const OVERRIDABLE_IGNORED_ATTRIBUTES: readonly string[] = [
  "style",
  "data-reactid",
  "data-react-checksum",
  "tabindex",
];

const ALWAYS_IGNORED_ATTRIBUTES: readonly string[] = [
  ...OVERRIDABLE_IGNORED_ATTRIBUTES,
  "apty-observer-added",
  "data-apty-qa",
  "data-apty-qa-state",
];

/**
 * Apty's default ignore (`options.ts` `defaultIgnore`): a short attribute
 * list, `id`/`for` values with 2+ consecutive digits, `xmlns:` and `lnid`
 * names, and class tokens starting `tether`. Nothing else is excluded:
 * an arbitrary `data-*` attribute or a generated-looking class token is
 * kept unless the application configures a rule for it.
 */
export const DEFAULT_IGNORE: {
  attribute: IgnoreFn;
  class: IgnoreFn;
  tag: IgnoreFn;
  contains: IgnoreFn;
} = {
  attribute: (name, value) =>
    ALWAYS_IGNORED_ATTRIBUTES.includes(name) ||
    (Boolean(value) && ["id", "for"].includes(name) && /\d{2,}/.test(value!)) ||
    /(^xmlns:)|lnid/.test(name),
  class: (name) => name.startsWith("tether"),
  tag: () => false,
  contains: () => false,
};

/**
 * The library's own priority when nothing is configured (`options.ts`
 * `initOptions`). Application-type presets replace it: Generic and Oracle
 * use `aria-label,title,href,id`, Salesforce `href,title,id`, Workday
 * `data-automation-id,id,href`.
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
  /**
   * Attributes the application declared as carrying identity: its configured priority plus its partial-selector attributes (`initOptions` `identityAttributes`). Selector optimization never reduces their value to a bare `[name]`. Empty when nothing is configured: the library's default priority is a guess at an order, not a claim about identity.
   */
  identityAttributes?: readonly string[];
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

function ignoreFnFor(config: DesConfig, key: "class" | "tag"): IgnoreFn {
  const configured = config.ignore[key];
  const defaultFn = DEFAULT_IGNORE[key];
  if (configured) {
    return (name, value) => configured(name, value, defaultFn);
  }
  return defaultFn;
}

/** `createSelectorOptions`: an overridable default ignore stops applying once the application lists the attribute in its priority. */
function defaultAttributeIgnore(config: DesConfig): IgnoreFn {
  return (name, value) =>
    config.priority.includes(name) &&
    OVERRIDABLE_IGNORED_ATTRIBUTES.includes(name)
      ? false
      : DEFAULT_IGNORE.attribute(name, value);
}

/** The ignore function for one attribute name (`pattern.ts`: `ignore[name] ?? ignore.attribute`, handed the default as its fallback). */
export function ignoreFnForAttribute(
  config: DesConfig,
  name: string,
): IgnoreFn {
  const defaultFn = defaultAttributeIgnore(config);
  const configured = config.ignore[name] ?? config.ignore.attribute;
  if (configured) {
    return (n, v) => configured(n, v, defaultFn);
  }
  return defaultFn;
}

/** Applied to each class token; Apty passes no value, this port passes the whole `class` value so a hook can see a token's siblings. */
export function ignoreFnForClass(config: DesConfig): IgnoreFn {
  return ignoreFnFor(config, "class");
}

export function ignoreFnForTag(config: DesConfig): IgnoreFn {
  return ignoreFnFor(config, "tag");
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
