/**
 * The selector the Apty player actually runs, ported from Apty's
 * `lib-client-element-identification`:
 *
 * - CAPTURE (`selector.ts` `createSelector`): `match` walks up from the
 *   element, ending at the first level that is unique under the root and
 *   adding, below it, one pattern per level that is unique within its
 *   parent; `optimize` then drops the levels and conditions that are not
 *   needed. Studio stores the result with one such selector per shadow
 *   host (`picked-element.helper.ts`).
 * - PLAYBACK (`element-identification.ts` `getIdentifiedElement`): open
 *   the shadow hosts one root at a time, query the stored selector and
 *   take the first rendered match, else the first match.
 *
 * Only the CSS format is ported: it is what the element picker stores.
 * The optimizer's 1-second-per-query bailout is left out, so results do
 * not depend on timing. Two quirks of the source are kept because they
 * decide what the player does:
 *
 * - Capture always queries against the document (Studio passes
 *   `root: window.document`), and `document.querySelectorAll` cannot see
 *   into a shadow root. Inside one, no level is ever globally unique and
 *   nothing is optimized away: the selector is the full chain of
 *   locally-unique levels up to the shadow root.
 * - Playback opens hosts through `host.shadowRoot`. A closed root is
 *   `null` there, and the lookup falls back to the document.
 */
import {
  type ElementPath,
  type ElementPattern,
  emptyPattern,
  initAttributes,
  initNthChild,
  initTag,
  isElementRendered,
  pathToSelector,
  patternToSelector,
  scopeRootFor,
} from "./des-engine.js";
import { shadowHostChain } from "./element-ref.js";
import type { DesConfig } from "./health-attribute-classification.js";

/** What Studio stores for an element picked in the CSS format. */
export interface AptySelection {
  selector: string;
  /** One selector per shadow host, outermost first; empty in the document's own tree. */
  shadowRoots: string[];
}

/** How a captured selector identifies its element, read from the optimized path. */
export interface AptySelectorFacts {
  /** Levels in the optimized path; 1 means the element's own pattern alone. */
  levels: number;
  /** Some level depends on position (`nth-child` / `nth-of-type`). */
  positional: boolean;
  /** Some condition is a configured Partial Selector part (`^=`, `$=`, `*=`). */
  partial: boolean;
  /** The element is told apart by a descendant (`:has(...)`). */
  descendant: boolean;
  /** Attribute and class conditions on the element's own level. */
  leafConditions: number;
  /** Attribute names the element's own level is anchored on, `class` included. */
  leafAttributes: string[];
}

export interface CapturedSelector {
  selector: string;
  path: ElementPath;
  facts: AptySelectorFacts;
}

interface MatchOptions {
  config: DesConfig;
  root: ParentNode;
  strict: boolean;
}

type Check = (
  element: Element,
  path: ElementPath,
  options: MatchOptions,
) => boolean;

/** `select.ts` `selectCSS`: every match, or none for a selector the engine rejects. */
function select(selector: string, parent: ParentNode): Element[] {
  try {
    return Array.from(parent.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/** `utilities.ts` `elementMatches`: one match, or exactly one rendered match unless strict. */
function aptyElementMatches(
  element: Element,
  matches: Element[],
  strict: boolean,
): boolean {
  if (matches.length === 1) return matches[0] === element;
  if (strict || matches.length === 0) return false;
  let onlyRendered: Element | null = null;
  for (const match of matches) {
    if (!isElementRendered(match)) continue;
    if (onlyRendered) return false;
    onlyRendered = match;
  }
  return onlyRendered === element;
}

function parentOf(element: Element, options: MatchOptions): ParentNode {
  return (element.parentNode as ParentNode | null) ?? options.root;
}

function checkAttributes(
  element: Element,
  path: ElementPath,
  options: MatchOptions,
  parent: ParentNode = parentOf(element, options),
): boolean {
  const pattern = emptyPattern();
  pattern.tag = element.tagName.toLowerCase();
  const isOptimal = (test: ElementPattern) =>
    aptyElementMatches(
      element,
      select(patternToSelector(test), parent),
      options.strict,
    );
  if (initAttributes(element, pattern, options.config, isOptimal)) {
    path.unshift(pattern);
    return true;
  }
  return false;
}

function checkTag(
  element: Element,
  path: ElementPath,
  options: MatchOptions,
  parent: ParentNode = parentOf(element, options),
): boolean {
  const pattern = emptyPattern();
  if (
    initTag(element, pattern, options.config) &&
    aptyElementMatches(
      element,
      select(patternToSelector(pattern), parent),
      options.strict,
    )
  ) {
    path.unshift(pattern);
    return true;
  }
  return false;
}

function checkNthChild(element: Element, path: ElementPath): boolean {
  if (element.parentNode?.nodeType !== Node.ELEMENT_NODE) return false;
  const nth = initNthChild(element);
  if (!nth) return false;
  path.unshift({ ...emptyPattern("child"), pseudo: [nth] });
  return true;
}

/** `match.ts` `MAX_DESCENDANT_CANDIDATES`. */
const MAX_DESCENDANT_CANDIDATES = 200;

function hasPositional(path: ElementPath): boolean {
  return path.some((pattern) =>
    pattern.pseudo.some((p) => p.name === "nth-child"),
  );
}

/** `match.ts` `checkRecursiveDescendants`: the element told apart by a descendant, those carrying a priority attribute tried first. */
function checkRecursiveDescendants(
  element: Element,
  path: ElementPath,
  options: MatchOptions,
): boolean {
  const pattern = emptyPattern("child");
  if (!initTag(element, pattern, options.config)) return false;
  const { priority } = options.config;
  const candidates = Array.from(element.querySelectorAll("*"))
    .map((candidate, index) => ({
      candidate,
      index,
      preferred: priority.some((name) => candidate.hasAttribute(name)),
    }))
    .sort(
      (a, b) => Number(b.preferred) - Number(a.preferred) || a.index - b.index,
    )
    .slice(0, MAX_DESCENDANT_CANDIDATES)
    .map(({ candidate }) => candidate);
  const parent =
    (element.parentNode as ParentNode | null) ?? element.ownerDocument;
  for (const candidate of candidates) {
    const candidatePath = match(candidate, { ...options, root: element }, true);
    const descendantPath: ElementPath =
      candidatePath[0] && candidate.parentElement === element
        ? [{ ...candidatePath[0], relates: "child" }, ...candidatePath.slice(1)]
        : candidatePath;
    if (hasPositional(descendantPath)) continue;
    const test = {
      ...pattern,
      relates: undefined,
      descendants: [descendantPath],
    };
    if (select(patternToSelector(test), parent).length === 1) {
      pattern.descendants = [descendantPath];
      path.unshift(pattern);
      return true;
    }
  }
  return false;
}

const ROOT_CHECKS: Check[] = [checkAttributes, checkTag];
const LEVEL_CHECKS: Check[] = [...ROOT_CHECKS, checkNthChild];
const TARGET_CHECKS: Check[] = [
  ...ROOT_CHECKS,
  checkRecursiveDescendants,
  checkNthChild,
];

function isDocumentOrFragment(node: Node): boolean {
  return (
    node.nodeType === Node.DOCUMENT_NODE ||
    node.nodeType === Node.DOCUMENT_FRAGMENT_NODE
  );
}

/** `match.ts` `match`: a partially optimized path of the element. */
function match(
  element: Element,
  options: MatchOptions,
  nested = false,
): ElementPath {
  const path: ElementPath = [];
  let current: Node | null = element;
  while (
    current &&
    current !== options.root &&
    !isDocumentOrFragment(current)
  ) {
    const el = current as Element;
    if (checkAttributes(el, path, options, options.root)) break;
    if (checkTag(el, path, options, options.root)) break;
    const checks = el === element && !nested ? TARGET_CHECKS : LEVEL_CHECKS;
    for (const check of checks) {
      if (check(el, path, options)) break;
    }
    current = current.parentNode;
  }
  if (
    current &&
    current === options.root &&
    current.nodeType === Node.ELEMENT_NODE
  ) {
    for (const check of ROOT_CHECKS) {
      if (check(current as Element, path, options)) break;
    }
  }
  return path;
}

interface OptimizeContext {
  element: Element;
  options: MatchOptions;
  identityAttributes: readonly string[];
}

type Optimizer = (
  context: OptimizeContext,
  pre: ElementPath,
  current: ElementPattern,
  post: ElementPath,
) => ElementPattern;

function uniqueUnder(
  { element, options }: OptimizeContext,
  path: ElementPath,
  root: ParentNode = options.root,
): boolean {
  return aptyElementMatches(
    element,
    select(pathToSelector(path), root),
    options.strict,
  );
}

const optimizeAttributes: Optimizer = (context, pre, current, post) => {
  if (current.attributes.length === 0) return current;
  const simplify = (
    original: ElementPattern["attributes"],
    simplified: (
      attrs: ElementPattern["attributes"],
      i: number,
    ) => ElementPattern["attributes"],
  ) => {
    let attributes = original;
    for (let i = attributes.length - 1; i >= 0; i--) {
      const next = simplified(attributes, i);
      if (
        !uniqueUnder(context, [
          ...pre,
          { ...current, attributes: next },
          ...post,
        ])
      ) {
        break;
      }
      attributes = next;
    }
    return attributes;
  };
  const noValue = simplify(current.attributes, (attrs, i) =>
    context.identityAttributes.includes(attrs[i]!.name)
      ? attrs
      : [...attrs.slice(0, i), { name: attrs[i]!.name }, ...attrs.slice(i + 1)],
  );
  const removed = simplify(noValue, (attrs) => attrs.slice(0, -1));
  return { ...current, attributes: removed };
};

/** Queries the document, not the scope root, as Apty's `optimizeDescendant` does. */
const optimizeDescendant: Optimizer = (context, pre, current, post) => {
  if (current.relates !== "child") return current;
  const descendant = { ...current, relates: undefined };
  return uniqueUnder(
    context,
    [...pre, descendant, ...post],
    context.element.ownerDocument,
  )
    ? descendant
    : current;
};

const optimizeRecursiveDescendants: Optimizer = (
  context,
  pre,
  current,
  post,
) => {
  if (!current.descendants?.length || post.length === 0) return current;
  const base = { ...current, descendants: [...current.descendants] };
  while (base.descendants.length > 0) {
    const optimized = base.descendants.slice(0, -1);
    if (
      !uniqueUnder(context, [
        ...pre,
        { ...base, descendants: optimized },
        ...post,
      ])
    ) {
      break;
    }
    base.descendants = optimized;
  }
  return base;
};

const optimizeNthOfType: Optimizer = (context, pre, current, post) => {
  const i = current.pseudo.findIndex((p) => p.name === "nth-child");
  if (i < 0) return current;
  const nthOfType = {
    ...current,
    pseudo: [
      ...current.pseudo.slice(0, i),
      { name: "nth-of-type", value: current.pseudo[i]!.value },
      ...current.pseudo.slice(i + 1),
    ],
  };
  return uniqueUnder(context, [...pre, nthOfType, ...post])
    ? nthOfType
    : current;
};

/** Drops the longest classes while the selector stays unique; with more than two left, tries the ancestor they describe by its tag alone. */
const optimizeClasses: Optimizer = (context, pre, current, post) => {
  if (current.classes.length <= 1) return current;
  let classes = [...current.classes].sort((a, b) => a.length - b.length);
  let result = current;
  while (classes.length > 1) {
    const optimized = classes.slice(0, -1);
    if (
      !uniqueUnder(context, [
        ...pre,
        { ...result, classes: optimized },
        ...post,
      ])
    ) {
      break;
    }
    classes = optimized;
    result = { ...result, classes: optimized };
  }
  if (classes.length > 2) {
    const base = { ...emptyPattern(), classes };
    const reference = select(
      pathToSelector([...pre, base]),
      context.options.root,
    ).find((candidate) => candidate.contains(context.element));
    if (reference) {
      const description = {
        ...emptyPattern(),
        tag: reference.tagName.toLowerCase(),
      };
      if (uniqueUnder(context, [...pre, description, ...post])) {
        result = description;
      }
    }
  }
  return result;
};

const OPTIMIZERS: Optimizer[] = [
  optimizeAttributes,
  optimizeDescendant,
  optimizeRecursiveDescendants,
  optimizeNthOfType,
  optimizeClasses,
];

function optimizePattern(
  context: OptimizeContext,
  pre: ElementPath,
  current: ElementPattern,
  post: ElementPath,
): ElementPattern {
  return OPTIMIZERS.reduce(
    (acc, optimizer) => optimizer(context, pre, acc, post),
    current,
  );
}

/** `optimize.ts` `optimize`: drop the levels that are not needed, then tidy the first and last. */
function optimize(context: OptimizeContext, input: ElementPath): ElementPath {
  if (input.length === 0) return [];
  if (input.length === 1) {
    return [optimizePattern(context, [], input[0]!, [])];
  }
  let path = [...input];
  let endOptimized = false;
  if (path[path.length - 1]!.relates === "child") {
    path[path.length - 1] = optimizePattern(
      context,
      path.slice(0, -1),
      path[path.length - 1]!,
      [],
    );
    endOptimized = true;
  }
  const shortened = [path.pop()!];
  while (path.length > 0) {
    const current = path.pop()!;
    if (!uniqueUnder(context, [...path, ...shortened])) {
      shortened.unshift(optimizePattern(context, path, current, shortened));
    }
  }
  path = shortened;
  path[0] = optimizePattern(context, [], path[0]!, path.slice(1));
  if (!endOptimized) {
    path[path.length - 1] = optimizePattern(
      context,
      path.slice(0, -1),
      path[path.length - 1]!,
      [],
    );
  }
  return path;
}

function factsOf(path: ElementPath): AptySelectorFacts {
  const all: ElementPattern[] = [];
  const collect = (patterns: ElementPath) => {
    for (const pattern of patterns) {
      all.push(pattern);
      for (const descendant of pattern.descendants ?? []) collect(descendant);
    }
  };
  collect(path);
  const leaf = path[path.length - 1];
  const leafAttributes = leaf
    ? [
        ...leaf.attributes.map((a) => a.name),
        ...(leaf.classes.length ? ["class"] : []),
      ]
    : [];
  return {
    levels: path.length,
    positional: all.some((p) =>
      p.pseudo.some((q) => q.name === "nth-child" || q.name === "nth-of-type"),
    ),
    partial: all.some(
      (p) =>
        p.attributes.some(
          (a) => a.selectionType !== undefined && a.selectionType !== "exact",
        ) || p.classes.some((c) => c.selectionType !== "exact"),
    ),
    descendant: all.some((p) => (p.descendants?.length ?? 0) > 0),
    leafConditions: leaf ? leaf.attributes.length + leaf.classes.length : 0,
    leafAttributes,
  };
}

/**
 * `createSelector` for one element, in CSS: scoped to the nearest
 * configured scope root, otherwise to the element's document.
 */
export function captureSelector(
  element: Element,
  config: DesConfig,
  overrides: { strict?: boolean } = {},
): CapturedSelector {
  const options: MatchOptions = {
    config,
    root: scopeRootFor(element, config) ?? element.ownerDocument,
    strict: overrides.strict ?? config.strictUniqueness,
  };
  const context: OptimizeContext = {
    element,
    options,
    identityAttributes: config.identityAttributes ?? [],
  };
  const path = optimize(context, match(element, options));
  return { selector: pathToSelector(path), path, facts: factsOf(path) };
}

/** What Studio's picker stores: the element's selector and one per shadow host above it. */
export function captureSelection(
  element: Element,
  config: DesConfig,
): AptySelection & { facts: AptySelectorFacts } {
  const captured = captureSelector(element, config);
  return {
    selector: captured.selector,
    shadowRoots: shadowHostChain(element).map(
      (host) => captureSelector(host, config).selector,
    ),
    facts: captured.facts,
  };
}

/** A shadow host whose root is closed, which Apty can neither pick into nor open at playback; null when every host is open. */
export function closedShadowHost(element: Element): Element | null {
  return (
    shadowHostChain(element).find((host) => host.shadowRoot === null) ?? null
  );
}

export interface AptyPlayback {
  element: Element | null;
  matchCount: number;
  renderedCount: number;
  /** The first shadow host selector that found no open root; the lookup then ran against the document, as Apty's does. */
  brokenHostIndex: number | null;
}

/** `containers.ts` `selectElementRoot` + `getIdentifiedElement`. */
export function playSelection(
  selection: AptySelection,
  doc: Document,
): AptyPlayback {
  let root: ParentNode = doc;
  let brokenHostIndex: number | null = null;
  for (let i = 0; i < selection.shadowRoots.length; i++) {
    const host = select(selection.shadowRoots[i]!, root)[0];
    const shadow = host?.shadowRoot ?? null;
    if (!shadow) {
      brokenHostIndex = i;
      root = doc;
      break;
    }
    root = shadow;
  }
  const matches = select(selection.selector, root);
  const rendered = matches.filter(isElementRendered);
  return {
    element: rendered[0] ?? matches[0] ?? null,
    matchCount: matches.length,
    renderedCount: rendered.length,
    brokenHostIndex,
  };
}
