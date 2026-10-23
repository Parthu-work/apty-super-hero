/**
 * The DOM analysis the console script SEs run (DOM Config brief, Appendix
 * A), done by the extension in one frame: tag counts, attribute values
 * with their counts, the highest z-index per scope and open and closed
 * shadow roots nested under their host's tag, in the script's JSON shape.
 * It adds what the script cannot see: the element behind each z-index of
 * 1000 or more, each frame element's real `src` and readability, every
 * shadow host with its mode, and which noise it left out.
 *
 * Differences from the script, all deliberate:
 * - Noise subtrees (`DEFAULT_IGNORED_ROOTS`: Apty, extensions, overlay
 *   vendors) are left out whole and counted in `meta.excludedRoots`, so a
 *   change in Apty's own markup never reads as a change in the page.
 * - Every shadow root of a host tag is read and merged under that tag; the
 *   script reads only the first. Closed roots are read when the extension
 *   API allows it (`meta.closedShadowRootsVisible`).
 * - Child frames are not entered: each frame is collected by its own
 *   responder and nested by the extension, cross-origin ones included.
 * - Values are bounded: a long value keeps its start, its length and a hash
 *   of the rest; an attribute with too many distinct values is flagged.
 *
 * It only reads: no click, scroll, focus or navigation.
 */
import {
  type CollectorBudgetOptions,
  createBudget,
  now,
} from "./collector-budget.js";
import { walkComposedTree } from "./composed-tree.js";
import type {
  DomProfileNode,
  DomProfileV2,
  FrameRecord,
  ShadowHostRecord,
  ZIndexSource,
} from "./dom-profile-types.js";
import { fnv1a } from "./health-state-signature.js";
import {
  findIgnoredRoots,
  type IgnoredRootMatcher,
  ignoredRootOf,
  ignoredRootPolicy,
  matchIgnoredRootTarget,
  type NoiseSource,
  noiseSourceOf,
} from "./ignored-roots.js";
import { shadowRootOf } from "./shadow-roots.js";
import { toUrlShape } from "./value-shapes.js";

export const DOM_PROFILE_LIMITS = {
  maxDistinctValuesPerAttribute: 5_000,
  /** Kept below the engine's 512 so a cut value is never cut again. */
  maxValueLength: 400,
  maxZIndexSources: 200,
  maxSourceTextLength: 80,
  /** A z-index at or above this gets its element recorded. */
  highZIndex: 1_000,
} as const;

/** DOM Config D4: an icon an extension draws with an inline z-index at or above this is not the application's. */
export const EXTENSION_ICON_Z_INDEX = 999_999;

export interface DomProfileCollectorOptions extends CollectorBudgetOptions {
  /** Settings → Troubleshooting entries, on top of the default noise list. */
  ignoredRoots?: readonly string[];
  /** The frame id an `<iframe>` or `<frame>` hosts, when the browser can say. */
  frameIdOf?: (element: Element) => number | null;
}

interface ChromeDomApi {
  openOrClosedShadowRoot?: unknown;
}

function closedRootsVisible(): boolean {
  const dom = (globalThis as { chrome?: { dom?: ChromeDomApi } }).chrome?.dom;
  return typeof dom?.openOrClosedShadowRoot === "function";
}

/** A value as the profile keeps it: up to the length limit, then its length and a hash of the rest. */
function bounded(value: string): { kept: string; cut: boolean } {
  const max = DOM_PROFILE_LIMITS.maxValueLength;
  if (value.length <= max) return { kept: value, cut: false };
  return {
    kept: `${value.slice(0, max)}…[${value.length}#${fnv1a(value.slice(max))}]`,
    cut: true,
  };
}

function shortText(value: string | null): string | undefined {
  if (!value) return undefined;
  const max = DOM_PROFILE_LIMITS.maxSourceTextLength;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** The script's z-index reading: the computed value as a number, 0 for `auto` or anything unreadable. */
function computedZIndex(element: Element): number {
  try {
    const view = element.ownerDocument?.defaultView;
    return Number(view?.getComputedStyle(element).zIndex) || 0;
  } catch {
    return 0;
  }
}

function frameRecord(
  element: HTMLIFrameElement | HTMLFrameElement,
  policy: readonly IgnoredRootMatcher[],
  frameIdOf: DomProfileCollectorOptions["frameIdOf"],
): FrameRecord {
  const srcAttribute = element.getAttribute("src") ?? "";
  const record: FrameRecord = {
    src: toUrlShape(srcAttribute),
    crossOrigin: false,
    readable: false,
  };
  if (srcAttribute && element.src) record.resolvedSrc = toUrlShape(element.src);
  const frameId = frameIdOf?.(element);
  if (typeof frameId === "number") record.frameId = frameId;
  if (ignoredRootOf(element, policy)) {
    record.reason = "noise";
    return record;
  }
  const view = element.contentWindow;
  if (!view) {
    record.reason = "not-loaded";
    return record;
  }
  let href: string;
  try {
    href = view.location.href;
  } catch {
    record.crossOrigin = true;
    record.reason = "blocked-cross-origin";
    return record;
  }
  record.readable = true;
  if (href === "about:blank") record.reason = "about:blank";
  else if (href === "about:srcdoc") record.reason = "srcdoc";
  return record;
}

interface Scope {
  node: DomProfileNode;
}

/** A map keyed by page data: no prototype, so a value such as `constructor` or `__proto__` is just a key. */
export function profileMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** `map[key]`, created with `make` the first time. */
export function profileEntry<T>(
  map: Record<string, T>,
  key: string,
  make: () => T,
): T {
  const existing = map[key];
  if (existing !== undefined) return existing;
  const created = make();
  map[key] = created;
  return created;
}

function nodeMap<K extends "tags" | "attributes" | "shadowRoots">(
  node: DomProfileNode,
  key: K,
): NonNullable<DomProfileNode[K]> {
  if (!node[key]) node[key] = profileMap() as DomProfileNode[K];
  return node[key] as NonNullable<DomProfileNode[K]>;
}

/**
 * Profile `doc` within the collector budget. Child frames are recorded,
 * not entered.
 */
export async function collectDomProfile(
  doc: Document,
  options: DomProfileCollectorOptions = {},
): Promise<DomProfileV2> {
  const startedAt = now();
  const budget = createBudget(options);
  const policy = ignoredRootPolicy(options.ignoredRoots);
  const ignored = findIgnoredRoots(doc, policy);
  const noiseSources = new Set<NoiseSource>(
    ignored.summary.map((entry) => noiseSourceOf(entry.owner)),
  );

  let shadowRootsEntered = 0;
  const elements: Array<{ element: Element; owner: Document | ShadowRoot }> =
    [];
  const walk = walkComposedTree(
    doc,
    (element, owner) => {
      if (!ignored.excluded.has(element)) elements.push({ element, owner });
    },
    {
      maxElements: budget.maxTotalElements,
      skipShadowOf: (host) => {
        if (ignored.excluded.has(host) || !shadowRootOf(host)) return true;
        if (shadowRootsEntered >= budget.maxShadowRoots) {
          budget.note(
            `Shadow-root ceiling of ${budget.maxShadowRoots} reached; roots after it were not entered.`,
          );
          return true;
        }
        shadowRootsEntered++;
        return false;
      },
    },
  );
  if (walk.truncated) {
    budget.note(
      `Element ceiling of ${budget.maxTotalElements} reached; elements after it were not read.`,
    );
  }

  const top: DomProfileNode = { tags: profileMap(), attributes: profileMap() };
  const scopes = new Map<Document | ShadowRoot, Scope>([[doc, { node: top }]]);
  const shadow: ShadowHostRecord[] = [];
  const zIndexSources: ZIndexSource[] = [];
  const frames: FrameRecord[] = [];
  const truncatedAttributes = new Set<string>();
  const attributeNoise = new Map<string, NoiseSource | null>();
  const distinctValues = new Map<Record<string, number>, number>();
  let cutValues = 0;
  let elementCount = 0;

  const attributeSource = (name: string): NoiseSource | null => {
    if (!attributeNoise.has(name)) {
      const m = matchIgnoredRootTarget({ attributeNames: [name] }, policy);
      attributeNoise.set(name, m ? noiseSourceOf(m.owner) : null);
    }
    return attributeNoise.get(name) ?? null;
  };

  const addValue = (node: DomProfileNode, name: string, value: string) => {
    const values = profileEntry(nodeMap(node, "attributes"), name, () =>
      profileMap<number>(),
    );
    const { kept, cut } = bounded(value);
    if (cut) cutValues++;
    const count = values[kept];
    if (count !== undefined) {
      values[kept] = count + 1;
      return;
    }
    const distinct = distinctValues.get(values) ?? 0;
    if (distinct >= DOM_PROFILE_LIMITS.maxDistinctValuesPerAttribute) {
      truncatedAttributes.add(name);
      return;
    }
    distinctValues.set(values, distinct + 1);
    values[kept] = 1;
  };

  for (const { element, owner } of elements) {
    if (await budget.tick()) break;
    const scope = scopes.get(owner);
    if (!scope) continue;
    const { node } = scope;
    elementCount++;
    const tag = (element.tagName || "").toLowerCase();
    const tags = nodeMap(node, "tags");
    tags[tag] = (tags[tag] ?? 0) + 1;

    for (const attribute of Array.from(element.attributes)) {
      addValue(node, attribute.name, attribute.value);
      const source = attributeSource(attribute.name);
      if (source) noiseSources.add(source);
    }

    const zIndex = computedZIndex(element);
    if (zIndex) {
      node.maxZIndex = Math.max(node.maxZIndex ?? 0, zIndex);
      if (zIndex >= DOM_PROFILE_LIMITS.highZIndex) {
        const inline = Boolean((element as HTMLElement).style?.zIndex);
        if (inline && zIndex >= EXTENSION_ICON_Z_INDEX) {
          noiseSources.add("extension");
        }
        zIndexSources.push({
          value: zIndex,
          tag,
          ...(element.id ? { id: shortText(element.id) } : {}),
          ...(element.getAttribute("class")
            ? { class: shortText(element.getAttribute("class")) }
            : {}),
          inline,
        });
      }
    }

    if (tag === "iframe" || tag === "frame") {
      frames.push(
        frameRecord(element as HTMLIFrameElement, policy, options.frameIdOf),
      );
    }

    const root = shadowRootOf(element);
    if (root && !ignored.excluded.has(element)) {
      shadow.push({
        hostTag: tag,
        mode: element.shadowRoot === root ? "open" : "closed",
      });
      scopes.set(root, {
        node: profileEntry(nodeMap(node, "shadowRoots"), tag, () => ({})),
      });
    }
  }
  budget.finish();
  for (const element of ignored.excluded) {
    if (element.localName === "iframe" || element.localName === "frame") {
      frames.push(
        frameRecord(element as HTMLIFrameElement, policy, options.frameIdOf),
      );
    }
  }

  if (zIndexSources.length > DOM_PROFILE_LIMITS.maxZIndexSources) {
    zIndexSources.sort((a, b) => b.value - a.value);
    zIndexSources.length = DOM_PROFILE_LIMITS.maxZIndexSources;
  }
  const view = doc.defaultView;
  const partial = budget.reasons.length > 0;
  return {
    schema: 2,
    tags: top.tags ?? {},
    attributes: top.attributes ?? {},
    ...(top.maxZIndex !== undefined ? { maxZIndex: top.maxZIndex } : {}),
    ...(top.shadowRoots ? { shadowRoots: top.shadowRoots } : {}),
    zIndexSources,
    frames,
    shadow,
    meta: {
      urlShape: toUrlShape(doc.location?.href ?? ""),
      ...(view
        ? { viewport: { width: view.innerWidth, height: view.innerHeight } }
        : {}),
      aptyPresent: noiseSources.has("apty"),
      extensionNoisePresent: noiseSources.has("extension"),
      elementCount,
      durationMs: Math.round(now() - startedAt),
      partial,
      ...(partial ? { partialReasons: [...budget.reasons] } : {}),
      truncatedAttributes: [...truncatedAttributes].sort(),
      cutValues,
      closedShadowRootsVisible: closedRootsVisible(),
      excludedRoots: ignored.summary,
    },
  };
}
