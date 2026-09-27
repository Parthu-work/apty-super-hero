/**
 * Apty Dynamic Element Selection (DES) engine — a faithful reconstruction
 * of the REAL Apty Studio algorithm, recovered by reverse-engineering the
 * actual shipped `studio-extension_63` build (`workflowPreview.js`'s
 * webpack modules; property/function names below are unmangled in that
 * bundle and are quoted here, not invented). This replaces an earlier
 * from-scratch engine (Jaccard similarity, 5 named strategies, a 70/±5
 * threshold, flat ignore/partial rule lists) that a prior session built
 * without access to real Apty source and that, on comparison, diverged
 * from the real product in nearly every load-bearing detail. See
 * `docs/development/des-engine.md` for the full reverse-engineering notes,
 * including exactly what was recovered with confidence and what is an
 * honestly-labeled best-effort reconstruction.
 *
 * Two distinct real algorithms are reconstructed here:
 *
 *  1. CAPTURE — `buildElementPattern`/`buildElementPath` build a FULL
 *     descriptive pattern per DOM level (every non-ignored attribute,
 *     class, and pseudo-fact — module 61503's `createPath`, which never
 *     early-exits). This is what a stored `ElementPath` actually contains,
 *     and what candidate patterns are compared against during recovery.
 *     `generateMinimalSelector` separately builds the MINIMAL unique CSS
 *     selector a Studio user would see (module 39842/59772's
 *     `match`/`optimize` — early-exits as soon as one attribute makes the
 *     selector-so-far unique, then trims). This second algorithm's exact
 *     trim ordering could not be recovered with full confidence from the
 *     minified bundle (see the doc comment on `generateMinimalSelector`);
 *     it is a faithful-intent reconstruction, not a byte-identical port,
 *     and is labeled as such.
 *
 *  2. RECOVERY — `findElement` is a faithful, byte-level port of module
 *     15906's `find()`: seed candidates from the literal captured path,
 *     score every candidate via `diffScore`, then run exactly four
 *     relaxation strategies (module 81948's `strategies` array) in order,
 *     early-accepting the first RENDERED candidate scoring >=0.92 as soon
 *     as one appears; once every strategy is exhausted or the candidate
 *     pool hits the 50-candidate ceiling, fall back to the best-scoring
 *     rendered candidate if it clears 0.90, else the single best-scoring
 *     candidate overall if it clears 0.90, else `null`. There is no
 *     discrete "ambiguous"/"wrong target" state in the real algorithm at
 *     all — it is a single ranked candidate pool with a top-1 pick above a
 *     floor. `runDes` in `health-selector-engine.ts` adds an evidence
 *     layer on top (comparing the real algorithm's actual pick against
 *     ground truth, and flagging a thin score margin as a stability risk)
 *     — that evidence layer is this package's own addition for DOM Health
 *     reporting purposes, never presented as part of Apty's own runtime
 *     decision.
 *
 * Ground rules preserved from this package's original design (never
 * relaxed to inflate a score): a selector is never "successful" merely
 * because `querySelectorAll` returned something; nothing here calls an
 * LLM or is tuned per fixture; every constant quoted above is a real,
 * confirmed Apty value, not an invented one.
 */
import {
  DEFAULT_DES_CONFIG,
  type DesConfig,
  ignoreFnForAttribute,
  ignoreFnForClass,
  ignoreFnForTag,
  isValueDynamic,
  partialFnForAttribute,
  resolveAttributeOrder,
} from "./health-attribute-classification.js";

// ---------------------------------------------------------------------------
// Pattern / Path — the real Apty shape (module 65913's `createPattern`,
// module 5757's `patternToSelector`). Deliberately NOT tag+id+class: every
// classifiable attribute, class token, and pseudo-fact (including
// position and text content) is preserved per level.
// ---------------------------------------------------------------------------

export type AttributeSelectionType = "exact" | "prefix" | "suffix" | "partial";

export interface PatternAttribute {
  name: string;
  /** undefined -> a value-less predicate, `[name]`. */
  value?: string;
  selectionType?: AttributeSelectionType;
}

export interface PatternClass {
  class: string;
  selectionType: AttributeSelectionType;
  length: number;
}

export interface PatternPseudo {
  /** e.g. "nth-child", "nth-of-type", "contains". */
  name: string;
  value?: string;
}

export interface ElementPattern {
  /** Combinator to the parent level: "child" (direct, `>`) or undefined (descendant). */
  relates?: "child";
  tag: string;
  attributes: PatternAttribute[];
  classes: PatternClass[];
  pseudo: PatternPseudo[];
}

/** Root-to-leaf order (outermost ancestor first, target element last) — matches real `createPath`'s `unshift`-while-walking-up construction. */
export type ElementPath = ElementPattern[];

// ---------------------------------------------------------------------------
// Rendered / visibility check (module 92516's `isElementRendered`).
// ---------------------------------------------------------------------------

export function isElementRendered(el: Element): boolean {
  const withCheckVisibility = el as Element & {
    checkVisibility?: (opts: {
      visibilityProperty: boolean;
      checkVisibilityCSS: boolean;
    }) => boolean;
  };
  if (typeof withCheckVisibility.checkVisibility === "function") {
    return withCheckVisibility.checkVisibility({
      visibilityProperty: true,
      checkVisibilityCSS: true,
    });
  }
  // Fallback for environments without `checkVisibility` (older browsers,
  // and jsdom — which has no layout engine at all, so `getClientRects()`
  // is always empty and cannot be used as a signal here). Computed
  // `display`/`visibility` is the real check's own first-order signal.
  const view = el.ownerDocument?.defaultView;
  if (!view) return true;
  const style = view.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

// ---------------------------------------------------------------------------
// elementMatches (module 99823) — the real "is this selector-so-far
// unique enough" check used during capture. Non-strict mode (the real
// default): several raw matches still count as unique if exactly one of
// them is actually rendered — a hidden template/duplicate row never
// blocks recognizing the one visible real instance.
// ---------------------------------------------------------------------------

export function elementMatches(
  target: Element,
  matches: Element[],
  strict: boolean,
): boolean {
  if (matches.length === 1) return matches[0] === target;
  if (strict) return false;
  let renderedWinner: Element | null = null;
  for (const m of matches) {
    if (isElementRendered(m)) {
      if (renderedWinner) return false;
      renderedWinner = m;
    }
  }
  return renderedWinner === target;
}

// ---------------------------------------------------------------------------
// Selector generation (module 5757's `patternToSelector`/`pathToSelector`).
// ---------------------------------------------------------------------------

function escapeSelectorValue(value: string): string {
  return value.replace(/['"`\\/:?&!#$%^()[\]{|}*+;,.<=>@~]/g, "\\$&");
}

const VALID_IDENTIFIER =
  /^(?!\d)(?!--)(?!-\d)(?:[^\\'"`/:?&!#$%^()[\]{|}*+;,.<=>@~]|\\.)+$/;

function isValidIdentifier(value: string): boolean {
  return VALID_IDENTIFIER.test(value);
}

function attributesToSelector(attributes: PatternAttribute[]): string {
  return attributes
    .map(({ name, value, selectionType }) => {
      if (value === undefined) return `[${name}]`;
      const escaped = escapeSelectorValue(value);
      switch (selectionType) {
        case "partial":
          return `[${name}*="${escaped}"]`;
        case "suffix":
          return `[${name}$="${escaped}"]`;
        case "prefix":
          return `[${name}^="${escaped}"]`;
        default:
          return `[${name}="${escaped}"]`;
      }
    })
    .join("");
}

function classesToSelector(classes: PatternClass[]): string {
  if (classes.length === 0) return "";
  return classes
    .map(({ class: className, selectionType }) => {
      const escaped = escapeSelectorValue(className);
      if (!isValidIdentifier(escaped)) return `[class~="${escaped}"]`;
      return selectionType === "partial"
        ? `[class*="${escaped}"]`
        : `.${escaped}`;
    })
    .join("");
}

function pseudoToSelector(pseudo: PatternPseudo[]): string {
  return pseudo
    .map(({ name, value }) => {
      const arg =
        name === "contains" ? `"${escapeSelectorValue(value ?? "")}"` : value;
      return `:${name}(${arg})`;
    })
    .join("");
}

export function patternToSelector(pattern: ElementPattern): string {
  const combinator = pattern.relates === "child" ? "> " : "";
  return (
    combinator +
    (pattern.tag ?? "") +
    attributesToSelector(pattern.attributes) +
    classesToSelector(pattern.classes) +
    pseudoToSelector(pattern.pseudo)
  );
}

export function pathToSelector(path: ElementPath): string {
  if (path.length === 0) return "";
  // Real `pathToSelector` (module 5757) explicitly clears the FIRST node's
  // `relates` combinator before joining — every node is captured with
  // `relates: "child"` unconditionally (real `createPath`), since a node
  // doesn't know until selector-generation time whether it will end up
  // first in the final path (no combinator needed) or receive an ancestor
  // before it (needs "> "). Skipping this produces an invalid leading
  // "> ..." selector that silently matches nothing.
  const [first, ...rest] = path;
  return [{ ...first!, relates: undefined }, ...rest]
    .map(patternToSelector)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Capture — full descriptive pattern (module 65913's `initAttributes`/
// `addAttribute`/`initTag`/`initNthChild`, module 61503's `createPath`).
// Never early-exits: every non-ignored attribute/class the priority order
// surfaces is added, because this is the pattern candidates get diffed
// against during recovery, not the minimal display selector.
// ---------------------------------------------------------------------------

function classifyRelation(
  original: string,
  matched: string,
): AttributeSelectionType {
  if (matched === original) return "exact";
  if (original.endsWith(matched)) return "suffix";
  if (original.startsWith(matched)) return "prefix";
  return "partial";
}

const VALID_ATTR_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

/** Real `addAttribute` (module 65913) — Partial Selector checked first, Ignore Selector only consulted when Partial returns nothing. */
function addAttribute(
  name: string,
  value: string,
  out: ElementPattern,
  config: DesConfig,
): boolean {
  if (!VALID_ATTR_NAME.test(name)) return false;

  if (name === "class") {
    const partialFn = partialFnForAttribute(config, "class");
    const partialResult = partialFn?.(name, value);
    const partialValues = (
      Array.isArray(partialResult) ? partialResult : [partialResult]
    ).filter((v): v is string => Boolean(v));
    if (partialValues.length > 0) {
      for (const v of partialValues) {
        out.classes.push({
          class: v,
          selectionType: classifyRelation(value, v),
          length: v.length,
        });
      }
      return out.classes.length > 0;
    }
    if (ignoreFnForClass(config)(name, value)) return false;
    const tokens = value.trim().split(/\s+/).filter(Boolean);
    out.classes = tokens.map((t) => ({
      class: t,
      selectionType: "exact" as const,
      length: t.length,
    }));
    return out.classes.length > 0;
  }

  const partialFn = partialFnForAttribute(config, name);
  const partialResult = partialFn?.(name, value);
  const partialValues = (
    Array.isArray(partialResult) ? partialResult : [partialResult]
  ).filter((v): v is string => Boolean(v));
  if (partialValues.length > 0) {
    const usable = partialValues.filter((v) => !/\n/.test(v) && v.length < 500);
    if (usable.length > 0) {
      for (const v of usable) {
        out.attributes.push({
          name,
          value: v,
          selectionType: classifyRelation(value, v),
        });
      }
      return true;
    }
    out.attributes.push({ name, value: undefined, selectionType: undefined });
    return true;
  }

  if (ignoreFnForAttribute(config, name)(name, value)) return false;
  const safeValue = !/\n/.test(value) && value.length < 500 ? value : undefined;
  out.attributes.push({ name, value: safeValue, selectionType: undefined });
  return true;
}

/** Real `initAttributes` (module 65913) — priority-ordered attribute names, `partialSelectorAttributes` always first, with an optional early-exit `stopCallback` (used only by `generateMinimalSelector`; full descriptive capture never passes one). */
function initAttributes(
  el: Element,
  out: ElementPattern,
  config: DesConfig,
  stopCallback?: (pattern: ElementPattern) => boolean,
): boolean {
  const attrs = Array.from(el.attributes);
  if (attrs.length === 0) return false;
  const order = resolveAttributeOrder(
    attrs.map((a) => a.name),
    config,
  );
  let addedAny = false;
  for (const name of order) {
    const attr = attrs.find((a) => a.name === name);
    if (!attr) continue;
    if (addAttribute(name, attr.value, out, config)) {
      addedAny = true;
      if (stopCallback?.(out)) return true;
    }
  }
  return addedAny;
}

function initTag(el: Element, out: ElementPattern, config: DesConfig): boolean {
  const tag = el.tagName.toLowerCase();
  if (ignoreFnForTag(config)("tag", tag)) return false;
  out.tag = tag;
  return true;
}

/**
 * Performance: a naive per-element `nth-child` scan (walking
 * `parent.children` to find `el`'s own index) is O(siblings) per call — on
 * a page with N siblings (a table of rows, a repeated list) that is O(N)
 * per element and O(N^2) across all of them, since recovery scoring calls
 * `buildElementPattern` once per candidate. This computes every sibling's
 * 1-based index for a given parent in ONE pass and caches it per-child, so
 * a page with 400 sibling rows costs one O(400) pass, not 400 of them.
 * Reset at the start of every `collectDomHealthSnapshot` round (see
 * `resetDesPerformanceCaches`) so a later round that legitimately
 * inserted/removed/reordered a sibling is never served a stale index.
 */
let nthChildCache = new WeakMap<Element, number>();

export function resetDesPerformanceCaches(): void {
  nthChildCache = new WeakMap();
}

/** Real `initNthChild` (module 65913) — 1-based index among ALL sibling elements (CSS `:nth-child`), not per-tag `:nth-of-type`. */
function initNthChild(el: Element): PatternPseudo | null {
  const cached = nthChildCache.get(el);
  if (cached !== undefined) return { name: "nth-child", value: String(cached) };
  const parent = el.parentElement;
  if (!parent) return null;
  const children = Array.from(parent.children);
  for (let i = 0; i < children.length; i++) {
    nthChildCache.set(children[i]!, i + 1);
  }
  const index = nthChildCache.get(el);
  return index === undefined
    ? null
    : { name: "nth-child", value: String(index) };
}

function emptyPattern(relates?: "child"): ElementPattern {
  return { relates, tag: "", attributes: [], classes: [], pseudo: [] };
}

/** Full descriptive pattern for one element (real `createPath`'s per-level body: tag + every non-ignored attribute/class + nth-child — never early-exits). */
export function buildElementPattern(
  el: Element,
  config: DesConfig = DEFAULT_DES_CONFIG,
): ElementPattern {
  const pattern = emptyPattern("child");
  initTag(el, pattern, config);
  initAttributes(el, pattern, config);
  const nthChild = initNthChild(el);
  if (nthChild) pattern.pseudo.push(nthChild);
  return pattern;
}

function resolveScopeRoot(el: Element, config: DesConfig): Element | Document {
  const doc = el.ownerDocument;
  if (config.scopeRootSelectors?.length) {
    let cur: Element | null = el.parentElement;
    while (cur) {
      for (const sel of config.scopeRootSelectors) {
        try {
          if (cur.matches(sel)) return cur;
        } catch {
          // invalid selector in config — ignore, keep climbing
        }
      }
      cur = cur.parentElement;
    }
  }
  return doc.body ?? doc;
}

/** Full descriptive ElementPath: walk from `el` up to the scope root (or document body), root-to-leaf order — real `createPath`. */
export function buildElementPath(
  el: Element,
  config: DesConfig = DEFAULT_DES_CONFIG,
): ElementPath {
  const root = resolveScopeRoot(el, config);
  const path: ElementPath = [];
  let cur: Element | null = el;
  while (cur && cur !== root && cur.nodeType === 1) {
    path.unshift(buildElementPattern(cur, config));
    cur = cur.parentElement;
  }
  return path;
}

// ---------------------------------------------------------------------------
// Scoring — module 17851's `arrayDiffScore`/`patternDiffScore`/`diffScore`.
// A Dice-coefficient-style diff ratio (exact-equality set intersection),
// never Jaccard, with tag weighted 7x, attributes/classes/pseudo 1x each
// (sum /10) at the pattern level, and ancestors (greedy sequential
// best-match alignment, never simple index-paired comparison) weighted 1x
// against the leaf's 3x at the path level (sum /4).
// ---------------------------------------------------------------------------

function attributeKey(a: PatternAttribute): string {
  return `attr:${a.name}=${a.value ?? ""}`;
}
function classKey(c: PatternClass): string {
  return `class:${c.class}`;
}
function pseudoKey(p: PatternPseudo): string {
  return `pseudo:${p.name}=${p.value ?? ""}`;
}

function arrayDiffScore<T>(a: T[], b: T[], key: (item: T) => string): number {
  const total = a.length + b.length;
  if (total === 0) return 1;
  const bKeys = new Set(b.map(key));
  let intersection = 0;
  const consumed = new Set<string>();
  for (const item of a) {
    const k = key(item);
    if (bKeys.has(k) && !consumed.has(k)) {
      intersection++;
      consumed.add(k);
    }
  }
  return (2 * intersection) / total;
}

const EMPTY_PATTERN: ElementPattern = emptyPattern();

export interface PatternDiffBreakdown {
  tagMatches: boolean;
  attributeScore: number;
  classScore: number;
  pseudoScore: number;
  total: number;
}

export function patternDiffScore(
  a: ElementPattern,
  b: ElementPattern,
): PatternDiffBreakdown {
  const tagMatches = a.tag === b.tag;
  const attributeScore = arrayDiffScore(
    a.attributes,
    b.attributes,
    attributeKey,
  );
  const classScore = arrayDiffScore(a.classes, b.classes, classKey);
  const pseudoScore = arrayDiffScore(a.pseudo, b.pseudo, pseudoKey);
  const total =
    (7 * (tagMatches ? 1 : 0) +
      1 * attributeScore +
      1 * classScore +
      1 * pseudoScore) /
    10;
  return { tagMatches, attributeScore, classScore, pseudoScore, total };
}

/** Greedy sequential best-match alignment (real `diffScore`'s inline ancestor-comparison closure): each ancestor from the shorter chain is matched to its best-scoring remaining candidate in the longer chain, consuming forward — never backward — so structure/order is preserved without requiring exact positional alignment (tolerates an inserted/removed ancestor level). */
function ancestorSequenceScore(
  a: ElementPattern[],
  b: ElementPattern[],
): number {
  const total = a.length + b.length;
  if (total === 0) return 1;
  const [shorter, longer] = a.length > b.length ? [b, a] : [a, b];
  const shorterCopy = [...shorter];
  let remainingLonger = longer;
  const scores: number[] = [];
  while (shorterCopy.length > 0 && remainingLonger.length > 0) {
    const next = shorterCopy.shift()!;
    let bestScore = 0;
    let bestIndex = -1;
    remainingLonger.forEach((candidate, idx) => {
      const score = patternDiffScore(next, candidate).total;
      if (idx === 0 || score > bestScore) {
        bestScore = score;
        bestIndex = idx;
      }
    });
    scores.push(bestScore);
    remainingLonger = remainingLonger.slice(bestIndex + 1);
  }
  return scores.reduce((sum, s) => sum + 2 * s, 0) / total;
}

export interface DiffScoreBreakdown {
  ancestorScore: number;
  leaf: PatternDiffBreakdown;
  total: number;
}

/** Real `diffScore`: `(1 * ancestorSequenceScore(ancestors) + 3 * patternDiffScore(leaf)) / 4` — the leaf is weighted 3x an ancestor-chain score that itself never simply pairs index-for-index. */
export function diffScore(
  pathA: ElementPath,
  pathB: ElementPath,
): DiffScoreBreakdown {
  const ancestorScore = ancestorSequenceScore(
    pathA.slice(0, -1),
    pathB.slice(0, -1),
  );
  const leaf = patternDiffScore(
    pathA[pathA.length - 1] ?? EMPTY_PATTERN,
    pathB[pathB.length - 1] ?? EMPTY_PATTERN,
  );
  const total = (1 * ancestorScore + 3 * leaf.total) / 4;
  return { ancestorScore, leaf, total };
}

// ---------------------------------------------------------------------------
// Recovery — module 15906's `find()`/`findElement()` and module 81948's
// `checkInitialPath`/`strategies`.
// ---------------------------------------------------------------------------

function safeQueryAll(
  root: ParentNode,
  selector: string,
  limit: number,
): Element[] {
  try {
    const result: Element[] = [];
    for (const el of Array.from(root.querySelectorAll(selector))) {
      result.push(el);
      if (result.length >= limit) break;
    }
    return result;
  } catch {
    return [];
  }
}

function dedupe(elements: Element[]): Element[] {
  const seen = new Set<Element>();
  const out: Element[] = [];
  for (const el of elements) {
    if (!seen.has(el)) {
      seen.add(el);
      out.push(el);
    }
  }
  return out;
}

/** Real `checkInitialPath` (module 81948) — the literal captured path, as-is, no relaxation. */
function checkInitialPath(
  path: ElementPath,
  limit: number,
  root: ParentNode,
): Element[] {
  return safeQueryAll(root, pathToSelector(path), limit);
}

/** Strategy 1 (real `f`): drop dynamic-looking attribute values and class tokens at EVERY level of the path. */
function dropDynamicValues(path: ElementPath): ElementPath {
  return path.map((node) => ({
    ...node,
    attributes: node.attributes.filter((a) => !isValueDynamic(a.value ?? "")),
    classes: node.classes.filter((c) => !isValueDynamic(c.class)),
  }));
}

/** Strategy 2 (real `d`): drop `nth-child`/`nth-of-type` pseudo entries at every level. */
function dropPositionalPseudo(path: ElementPath): ElementPath {
  return path.map((node) => ({
    ...node,
    pseudo: node.pseudo.filter(
      (p) => p.name !== "nth-of-type" && p.name !== "nth-child",
    ),
  }));
}

interface StrategyEvidence {
  name:
    | "dropDynamicValues"
    | "dropPositionalPseudo"
    | "dropOneAncestor"
    | "leafFieldCombinations";
  candidates: Element[];
}

/** Strategy 3 (real anonymous 3rd strategy): drop exactly ONE ancestor level at a time (never cumulative), stripping relationship/pseudo info from every remaining ancestor, unioning the resulting matches across every single-ancestor-dropped attempt. */
function dropOneAncestorAtATime(
  path: ElementPath,
  limit: number,
  root: ParentNode,
): Element[] {
  if (path.length === 0) return [];
  const stripped = path.map((node) => ({
    ...node,
    relates: undefined,
    pseudo: [] as PatternPseudo[],
  }));
  const leaf = stripped[stripped.length - 1]!;
  const ancestors = stripped.slice(0, -1);
  if (ancestors.length === 0) return [];
  let collected: Element[] = [];
  for (
    let dropIndex = 0;
    dropIndex < ancestors.length && collected.length <= limit;
    dropIndex++
  ) {
    const kept = ancestors.filter((_, i) => i !== dropIndex);
    collected = dedupe(
      collected.concat(
        safeQueryAll(root, pathToSelector([...kept, leaf]), limit),
      ),
    );
  }
  return collected.slice(0, limit);
}

function combinationsUpToSize<T>(items: T[], maxSize: number): T[][] {
  const combos: T[][] = [[]];
  for (const item of items) {
    const snapshot = combos;
    for (const combo of snapshot) {
      if (combo.length < maxSize) combos.push([...combo, item]);
    }
  }
  combos.shift();
  return combos;
}

type LeafField = { kind: "attribute" | "class" | "pseudo"; name: string };

/** Strategy 4 (real anonymous 4th strategy): leaf only, no ancestor context — every size-<=2 combination of dropped attribute/class/pseudo fields on the leaf alone. */
function leafFieldCombinations(
  path: ElementPath,
  limit: number,
  root: ParentNode,
): Element[] {
  if (path.length === 0) return [];
  const leaf = path[path.length - 1]!;
  const fields: LeafField[] = [
    ...leaf.attributes.map((a) => ({
      kind: "attribute" as const,
      name: a.name,
    })),
    ...leaf.classes.map((c) => ({ kind: "class" as const, name: c.class })),
    ...leaf.pseudo.map((p) => ({ kind: "pseudo" as const, name: p.name })),
  ].reverse();
  const drops = combinationsUpToSize(fields, 2);
  let collected: Element[] = [];
  for (let i = 0; i < drops.length && collected.length <= limit; i++) {
    const dropped = drops[i]!;
    const variant: ElementPattern = {
      ...leaf,
      attributes: leaf.attributes.filter(
        (a) =>
          !dropped.some((f) => f.kind === "attribute" && f.name === a.name),
      ),
      classes: leaf.classes.filter(
        (c) => !dropped.some((f) => f.kind === "class" && f.name === c.class),
      ),
      pseudo: leaf.pseudo.filter(
        (p) => !dropped.some((f) => f.kind === "pseudo" && f.name === p.name),
      ),
    };
    collected = dedupe(
      collected.concat(
        safeQueryAll(
          root,
          patternToSelector({ ...variant, relates: undefined }),
          limit,
        ),
      ),
    );
  }
  return collected;
}

const RECOVERY_STRATEGIES: Array<{
  name: StrategyEvidence["name"];
  run: (path: ElementPath, limit: number, root: ParentNode) => Element[];
}> = [
  {
    name: "dropDynamicValues",
    run: (path, limit, root) =>
      safeQueryAll(root, pathToSelector(dropDynamicValues(path)), limit),
  },
  {
    name: "dropPositionalPseudo",
    run: (path, limit, root) =>
      safeQueryAll(root, pathToSelector(dropPositionalPseudo(path)), limit),
  },
  { name: "dropOneAncestor", run: dropOneAncestorAtATime },
  { name: "leafFieldCombinations", run: leafFieldCombinations },
];

interface ScoredCandidate {
  element: Element;
  score: number;
  rendered: boolean;
  strategy: "checkInitialPath" | StrategyEvidence["name"];
}

function scoreCandidates(
  target: ElementPath,
  elements: Element[],
  config: DesConfig,
  strategy: ScoredCandidate["strategy"],
): ScoredCandidate[] {
  return elements.map((element) => ({
    element,
    score: diffScore(target, buildElementPath(element, config)).total,
    rendered: isElementRendered(element),
    strategy,
  }));
}

function byScoreThenRendered(a: ScoredCandidate, b: ScoredCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.rendered === b.rendered) return 0;
  return a.rendered ? -1 : 1;
}

export interface FindResult {
  element: Element | null;
  score: number | null;
  strategy: ScoredCandidate["strategy"] | null;
  /** Every strategy attempted, in order, with how many raw candidates it produced (before scoring/dedup) — compact evidence, never a raw DOM dump. */
  attemptsEvidence: Array<{
    strategy: ScoredCandidate["strategy"];
    candidatesFound: number;
  }>;
  /** Full ranked candidate pool at the moment a decision was made — this package's own addition (the real `find()` never exposes this), used only to flag a thin score margin as a stability risk. */
  rankedCandidates: ScoredCandidate[];
}

/**
 * Faithful, byte-level port of real Apty's `find()` (module 15906):
 * seed from the literal captured path, score everything via `diffScore`,
 * then run the four relaxation strategies in order, early-accepting the
 * first RENDERED candidate scoring >= `earlyAcceptScore` (0.92) as soon as
 * one appears; once every strategy is exhausted or the candidate pool hits
 * `candidateCeiling` (50), fall back to the best-scoring rendered
 * candidate if it clears `fallbackAcceptScore` (0.90), else the single
 * best-scoring candidate overall if it clears 0.90, else `null`.
 */
export function findElement(
  target: ElementPath,
  root: ParentNode,
  config: DesConfig = DEFAULT_DES_CONFIG,
): FindResult {
  const attemptsEvidence: FindResult["attemptsEvidence"] = [];
  const ceiling = config.candidateCeiling;

  const initial = checkInitialPath(target, ceiling, root);
  attemptsEvidence.push({
    strategy: "checkInitialPath",
    candidatesFound: initial.length,
  });
  if (initial.length === 1 && isElementRendered(initial[0]!)) {
    return {
      element: initial[0]!,
      score: 1,
      strategy: "checkInitialPath",
      attemptsEvidence,
      rankedCandidates: [
        {
          element: initial[0]!,
          score: 1,
          rendered: true,
          strategy: "checkInitialPath",
        },
      ],
    };
  }

  let ranked = scoreCandidates(
    target,
    initial,
    config,
    "checkInitialPath",
  ).sort(byScoreThenRendered);

  for (const strategy of RECOVERY_STRATEGIES) {
    if (ranked.length > ceiling) break;
    const found = strategy.run(target, ceiling - ranked.length, root);
    attemptsEvidence.push({
      strategy: strategy.name,
      candidatesFound: found.length,
    });
    ranked = ranked
      .concat(scoreCandidates(target, found, config, strategy.name))
      .sort(byScoreThenRendered);
    const earlyWinner = ranked.find(
      (c) => c.rendered && c.score >= config.earlyAcceptScore,
    );
    if (earlyWinner) {
      return {
        element: earlyWinner.element,
        score: earlyWinner.score,
        strategy: earlyWinner.strategy,
        attemptsEvidence,
        rankedCandidates: ranked,
      };
    }
  }

  let firstAboveFloor: ScoredCandidate | null = null;
  for (const candidate of ranked) {
    if (candidate.score < config.fallbackAcceptScore) break;
    if (candidate.rendered) {
      return {
        element: candidate.element,
        score: candidate.score,
        strategy: candidate.strategy,
        attemptsEvidence,
        rankedCandidates: ranked,
      };
    }
    if (!firstAboveFloor) firstAboveFloor = candidate;
  }
  if (firstAboveFloor) {
    return {
      element: firstAboveFloor.element,
      score: firstAboveFloor.score,
      strategy: firstAboveFloor.strategy,
      attemptsEvidence,
      rankedCandidates: ranked,
    };
  }
  return {
    element: null,
    score: null,
    strategy: null,
    attemptsEvidence,
    rankedCandidates: ranked,
  };
}

// ---------------------------------------------------------------------------
// checkContainersScore (module 74456) — a runtime context-validity gate,
// distinct from `findElement`: given a previously-captured ancestor
// container chain (as CSS selectors) and a fraction threshold, checks
// whether at least `ceil(containers.length * threshold)` of those
// selectors still resolve to SOMETHING in `root`. Exported for a future
// "verify a stored selector is still contextually sound" flow; not yet
// wired into `health-collector.ts`'s per-round resolution — see
// docs/development/des-engine.md's explicit scoping note on this.
// ---------------------------------------------------------------------------

export function getContainerSelectors(
  el: Element,
  config: DesConfig = DEFAULT_DES_CONFIG,
): string[] {
  const root = resolveScopeRoot(el, config);
  const containers: Element[] = [];
  let cur = el.parentElement;
  while (cur && cur !== root) {
    containers.push(cur);
    cur = cur.parentElement;
  }
  return containers.filter(isElementRendered).map((c) =>
    patternToSelector({
      ...buildElementPattern(c, config),
      relates: undefined,
    }),
  );
}

export function checkContainersScore(
  containerSelectors: string[],
  root: ParentNode,
  threshold: number,
): boolean {
  if (containerSelectors.length === 0) return true;
  let remaining = Math.ceil(containerSelectors.length * threshold);
  for (const selector of containerSelectors) {
    if (safeQueryAll(root, selector, 1).length > 0) {
      remaining--;
      if (remaining <= 0) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Minimal selector generation — faithful-intent reconstruction of real
// `match()`/`optimize()` (modules 39842/59772). The real algorithm's exact
// per-branch trim ordering (a live 1-second-per-step timing budget, a
// dual attribute/text-content-first-node special case) could not be
// recovered with full confidence from the minified bundle; this
// reconstruction preserves the documented INTENT (try one attribute in
// priority order that alone makes the selector-so-far unique via the same
// non-strict `elementMatches`; else fall back to `nth-child`; climb one
// ancestor level and repeat until unique or the scope root is reached)
// without claiming byte-identical behavior.
// ---------------------------------------------------------------------------

export interface MinimalSelectorResult {
  selector: string;
  /** Attribute names actually used to build the winning selector, root-to-leaf. */
  attributesUsed: string[];
  ancestorLevelsUsed: number;
  usesPositionalSelector: boolean;
  /** The leaf (target) level's own final pattern — exposed so a caller can tell an exact-match attribute from one a Partial Selector function anchored on a substring (`selectionType !== "exact"`), without re-deriving it. */
  leafPattern: ElementPattern;
}

/**
 * Build one level's pattern by growing it ONE attribute at a time, in
 * priority order (real `u()`'s `initAttributes(..., stopCallback)`):
 * after each attribute is added, re-check whether the FULL selector so
 * far (every already-fixed outer level, plus this level's growing
 * pattern) already uniquely resolves to `el` within `root`. Only when no
 * combination of this level's attributes achieves that does it fall back
 * to a bare tag match, and finally to `nth-child` (real `d()`/`f()`).
 * This is what lets a single level's Attribute Priority walk combine
 * MULTIPLE attributes (e.g. `.btn` + `[name="submit"]` together) when
 * neither alone is unique — never just "the first attribute added".
 */
function buildLevelWithLiveUniquenessCheck(
  /** The element THIS level's pattern describes — an ancestor of `target` on every iteration after the first. */
  levelElement: Element,
  /** The ORIGINAL element `generateMinimalSelector` is building a selector for — uniqueness is always checked against THIS, never against `levelElement` (which trivially "matches itself" and would make every level look falsely unique). */
  target: Element,
  config: DesConfig,
  relates: "child" | undefined,
  /** Already-fixed INNER levels (closer to the leaf; built by an earlier iteration of `generateMinimalSelector`'s climb) — the new pattern built here is an ANCESTOR of these, so it must be prepended, never appended, when composing a root-to-leaf selector. */
  innerLevels: ElementPattern[],
  root: ParentNode,
): { pattern: ElementPattern; usedAttributes: string[] } {
  const pattern = emptyPattern(relates);
  initTag(levelElement, pattern, config);
  const usedAttributes: string[] = [];

  const attrs = Array.from(levelElement.attributes);
  const order = resolveAttributeOrder(
    attrs.map((a) => a.name),
    config,
  );
  let achievedUnique = false;
  for (const name of order) {
    const attr = attrs.find((a) => a.name === name);
    if (!attr) continue;
    if (!addAttribute(name, attr.value, pattern, config)) continue;
    usedAttributes.push(name);
    const candidateSelector = pathToSelector([pattern, ...innerLevels]);
    if (
      elementMatches(
        target,
        safeQueryAll(root, candidateSelector, 2),
        config.strictUniqueness,
      )
    ) {
      achievedUnique = true;
      break;
    }
  }

  if (!achievedUnique) {
    // Real `d()`: bare tag alone, no attributes.
    const tagOnly = emptyPattern(relates);
    initTag(levelElement, tagOnly, config);
    const tagSelector = pathToSelector([tagOnly, ...innerLevels]);
    if (
      elementMatches(
        target,
        safeQueryAll(root, tagSelector, 2),
        config.strictUniqueness,
      )
    ) {
      pattern.attributes = [];
      pattern.classes = [];
      usedAttributes.length = 0;
      achievedUnique = true;
    }
  }

  if (!achievedUnique) {
    // Real `f()`: nth-child fallback — the level's only remaining lever.
    const nthChild = initNthChild(levelElement);
    pattern.attributes = [];
    pattern.classes = [];
    pattern.pseudo = nthChild ? [nthChild] : [];
    usedAttributes.length = 0;
  }

  return { pattern, usedAttributes };
}

export function generateMinimalSelector(
  el: Element,
  root: ParentNode,
  config: DesConfig = DEFAULT_DES_CONFIG,
): MinimalSelectorResult | null {
  const scopeRoot = resolveScopeRoot(el, config);
  const levels: ElementPattern[] = [];
  const usedAttributesPerLevel: string[][] = [];
  let cur: Element | null = el;
  let ancestorLevelsUsed = 0;

  while (cur && cur !== scopeRoot && cur.nodeType === 1) {
    const relates: "child" | undefined = cur === el ? undefined : "child";
    const { pattern, usedAttributes } = buildLevelWithLiveUniquenessCheck(
      cur,
      el,
      config,
      relates,
      levels,
      root,
    );
    levels.unshift(pattern);
    usedAttributesPerLevel.unshift(usedAttributes);

    const selector = pathToSelector(levels);
    if (
      elementMatches(
        el,
        safeQueryAll(root, selector, 2),
        config.strictUniqueness,
      )
    ) {
      return {
        selector,
        attributesUsed: usedAttributesPerLevel.flat(),
        ancestorLevelsUsed,
        usesPositionalSelector: usedAttributesPerLevel.every(
          (names) => names.length === 0,
        ),
        leafPattern: levels[levels.length - 1]!,
      };
    }
    cur = cur.parentElement;
    ancestorLevelsUsed++;
  }
  return null;
}
