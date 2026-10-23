/**
 * One run as flat maps: tags, attribute values and class tokens with their
 * counts, merged across the document, its open shadow roots and the
 * same-origin frames the profile could read. Values are held within the
 * D10 caps; what a cap cut is recorded, never dropped silently.
 */
import { type ExcludedRootSummary, fnv1a } from "@apty/dom-snapshot";
import { DOM_CONFIG_LIMITS } from "./limits.js";
import {
  attributeNameNoise,
  attributeValueNoise,
  classNoise,
  type NoisePolicy,
  tagNoise,
} from "./noise.js";
import { compareText, toUrlShape } from "./text.js";
import type {
  BehaviorProbe,
  DomProfileFrame,
  DomProfileNode,
  ProfileRun,
  RunMeta,
  TruncationEntry,
  ZIndexSource,
} from "./types.js";

export interface FlatFrame {
  /** URL shape (D11) of the frame's real `src`, or null when the profile does not say. */
  src: string | null;
  crossOrigin: boolean | null;
  /** An extension's page or an overlay vendor's frame is listed, never treated as the application. */
  kind: "application" | "extension" | "overlay";
  analyzed: boolean;
  reason: string;
}

export interface FlatShadowHost {
  tag: string;
  mode: "open" | "closed" | "unknown";
  noise: boolean;
}

export interface FlatRun {
  meta: RunMeta;
  tags: Map<string, number>;
  /** Every attribute but `class`, by name, then value. */
  attributes: Map<string, Map<string, number>>;
  classTokens: Map<string, number>;
  /** The highest z-index of each scope (document, shadow root, frame). */
  scopeMaxZIndexes: number[];
  /** The collector listed the element behind every z-index of 1000 or more. */
  zIndexSourcesKnown: boolean;
  zIndexSources: ZIndexSource[];
  shadowHosts: FlatShadowHost[];
  /** A schema 1 profile reads `element.shadowRoot`, which is null for a closed root. */
  seesClosedShadowRoots: boolean;
  frames: FlatFrame[];
  /** Names whose value set is incomplete in this run. */
  truncatedNames: Set<string>;
  /** The run as a whole is incomplete: its own `partial` flag, or the stored-character cap. */
  incomplete: boolean;
  truncations: Omit<TruncationEntry, "pageId" | "run">[];
  probe: BehaviorProbe | null;
  /** Noise subtrees the collector left out whole (schema 2). */
  excludedRoots: ExcludedRootSummary[];
  fingerprints: Map<string, Record<string, string>> | null;
  elementCount: number;
}

const LEGACY_CROSS_ORIGIN_KEY = /^Cross Origin \d+ \(src: ([\s\S]*)\)$/;

/** D8: the console script names an unreadable frame `Cross Origin N (src: …)`; the `src` inside is real, the number is not. */
export function parseLegacyFrameKey(key: string): {
  src: string | null;
  placeholder: boolean;
} {
  const match = key.match(LEGACY_CROSS_ORIGIN_KEY);
  if (match) return { src: match[1] || null, placeholder: true };
  return { src: key === "null" || key === "" ? null : key, placeholder: false };
}

function isExtensionSrc(src: string | null, policy: NoisePolicy): boolean {
  return src !== null && attributeValueNoise("src", src, policy) !== null;
}

function storedValue(value: string): { stored: string; cut: boolean } {
  const max = DOM_CONFIG_LIMITS.maxStoredValueLength;
  if (value.length <= max) return { stored: value, cut: false };
  return {
    stored: `${value.slice(0, max)}…#${fnv1a(value.slice(max))}`,
    cut: true,
  };
}

function hasContent(node: DomProfileNode): boolean {
  return Boolean(node.tags && Object.keys(node.tags).length > 0);
}

export function flattenRun(run: ProfileRun, policy: NoisePolicy): FlatRun {
  const flat: FlatRun = {
    meta: run.meta,
    tags: new Map(),
    attributes: new Map(),
    classTokens: new Map(),
    scopeMaxZIndexes: [],
    zIndexSourcesKnown: run.profile.zIndexSources !== undefined,
    zIndexSources: run.profile.zIndexSources ?? [],
    shadowHosts: [],
    seesClosedShadowRoots:
      run.profile.meta?.closedShadowRootsVisible ??
      run.profile.shadow !== undefined,
    frames: [],
    truncatedNames: new Set(run.profile.meta?.truncatedAttributes ?? []),
    incomplete: Boolean(run.meta.partial || run.profile.meta?.partial),
    truncations: (run.profile.meta?.truncatedAttributes ?? []).map((name) => ({
      kind: "collector",
      name,
      dropped: 0,
    })),
    probe: run.profile.probe ?? null,
    excludedRoots: run.profile.meta?.excludedRoots ?? [],
    fingerprints: run.profile.elementFingerprints
      ? new Map(
          run.profile.elementFingerprints.map((e) => [
            e.fingerprint,
            e.attributeHashes,
          ]),
        )
      : null,
    elementCount: 0,
  };
  const cutLengths = new Map<string, number>();

  const addValue = (name: string, value: string, count: number) => {
    const { stored, cut } = storedValue(value);
    if (cut) cutLengths.set(name, (cutLengths.get(name) ?? 0) + 1);
    if (name === "class") {
      for (const token of stored.split(/\s+/)) {
        if (token) {
          flat.classTokens.set(
            token,
            (flat.classTokens.get(token) ?? 0) + count,
          );
        }
      }
      return;
    }
    let values = flat.attributes.get(name);
    if (!values) {
      values = new Map();
      flat.attributes.set(name, values);
    }
    values.set(stored, (values.get(stored) ?? 0) + count);
  };

  const visit = (node: DomProfileNode, depth: number) => {
    if (depth > DOM_CONFIG_LIMITS.maxNestingDepth) return;
    for (const [tag, count] of Object.entries(node.tags ?? {})) {
      flat.tags.set(tag, (flat.tags.get(tag) ?? 0) + count);
      flat.elementCount += count;
    }
    for (const [name, values] of Object.entries(node.attributes ?? {})) {
      for (const [value, count] of Object.entries(values)) {
        addValue(name, value, count);
      }
    }
    if (typeof node.maxZIndex === "number") {
      flat.scopeMaxZIndexes.push(node.maxZIndex);
    }
    for (const [hostTag, root] of Object.entries(node.shadowRoots ?? {})) {
      if (!run.profile.shadow) {
        flat.shadowHosts.push({
          tag: hostTag,
          mode: "open",
          noise: tagNoise(hostTag, policy) !== null,
        });
      }
      visit(root, depth + 1);
    }
    for (const [key, frame] of Object.entries(node.iframes ?? {})) {
      visitFrame(key, frame, depth);
    }
  };

  const visitFrame = (key: string, frame: DomProfileFrame, depth: number) => {
    const { src } = parseLegacyFrameKey(key);
    const extension = isExtensionSrc(src, policy);
    const analyzed = hasContent(frame) && !extension;
    const kind = extension ? "extension" : "application";
    if (!run.profile.frames) {
      flat.frames.push({
        src: src === null ? null : toUrlShape(src),
        crossOrigin:
          typeof frame.isCrossOrigin === "boolean" ? frame.isCrossOrigin : null,
        kind,
        analyzed,
        reason: analyzed
          ? "analyzed"
          : frame.isCrossOrigin
            ? "cross-origin: the console script cannot read it"
            : "no content recorded",
      });
    }
    if (analyzed) visit(frame, depth + 1);
  };

  visit(run.profile, 0);

  for (const record of run.profile.frames ?? []) {
    const src = record.src || record.resolvedSrc || null;
    flat.frames.push({
      src: src === null ? null : toUrlShape(src),
      crossOrigin: record.crossOrigin,
      kind: isExtensionSrc(src, policy)
        ? "extension"
        : record.reason === "noise"
          ? "overlay"
          : "application",
      analyzed: record.readable,
      reason: record.readable ? "analyzed" : (record.reason ?? "not readable"),
    });
  }
  for (const record of run.profile.shadow ?? []) {
    flat.shadowHosts.push({
      tag: record.hostTag,
      mode: record.mode,
      noise: tagNoise(record.hostTag, policy) !== null,
    });
  }

  capDistinctValues(flat);
  capStoredChars(flat);
  for (const [name, dropped] of [...cutLengths].sort(([a], [b]) =>
    compareText(a, b),
  )) {
    flat.truncations.push({ kind: "value-length", name, dropped });
  }
  return flat;
}

function byCountThenValue(
  [aValue, aCount]: [string, number],
  [bValue, bCount]: [string, number],
): number {
  return bCount - aCount || compareText(aValue, bValue);
}

function capDistinctValues(flat: FlatRun): void {
  const max = DOM_CONFIG_LIMITS.maxDistinctValuesPerAttribute;
  for (const [name, values] of flat.attributes) {
    if (values.size <= max) continue;
    const kept = [...values].sort(byCountThenValue).slice(0, max);
    flat.attributes.set(name, new Map(kept));
    flat.truncatedNames.add(name);
    flat.truncations.push({
      kind: "distinct-values",
      name,
      dropped: values.size - max,
    });
  }
  if (flat.classTokens.size > max) {
    const dropped = flat.classTokens.size - max;
    flat.classTokens = new Map(
      [...flat.classTokens].sort(byCountThenValue).slice(0, max),
    );
    flat.truncatedNames.add("class");
    flat.truncations.push({ kind: "distinct-values", name: "class", dropped });
  }
}

/** Keeps the most frequent values, name by name in name order, until the run holds the most characters it may. */
function capStoredChars(flat: FlatRun): void {
  let stored = 0;
  let dropped = 0;
  const names = [...flat.attributes.keys()].sort(compareText);
  for (const name of names) {
    const values = flat.attributes.get(name)!;
    const kept: Array<[string, number]> = [];
    for (const entry of [...values].sort(byCountThenValue)) {
      if (stored + entry[0].length > DOM_CONFIG_LIMITS.maxStoredCharsPerRun) {
        dropped++;
        continue;
      }
      stored += entry[0].length;
      kept.push(entry);
    }
    if (kept.length < values.size) {
      flat.attributes.set(name, new Map(kept));
      flat.truncatedNames.add(name);
    }
  }
  if (dropped > 0) {
    flat.incomplete = true;
    flat.truncations.push({ kind: "stored-chars", name: null, dropped });
  }
}

export interface NoisePresence {
  aptyPresent: boolean;
  extensionNoisePresent: boolean;
}

/** Whether any Apty or extension marker is in the run. */
export function detectNoisePresence(
  flat: FlatRun,
  policy: NoisePolicy,
): NoisePresence {
  const sources = new Set<string>();
  const note = (source: string | undefined) => {
    if (source) sources.add(source);
  };
  for (const tag of flat.tags.keys()) note(tagNoise(tag, policy)?.source);
  for (const token of flat.classTokens.keys()) {
    note(classNoise(token, policy)?.source);
  }
  for (const [name, values] of flat.attributes) {
    note(attributeNameNoise(name, policy)?.source);
    for (const value of values.keys()) {
      note(attributeValueNoise(name, value, policy)?.source);
    }
  }
  if (flat.frames.some((frame) => frame.kind === "extension")) {
    sources.add("extension");
  }
  return {
    aptyPresent: sources.has("apty"),
    extensionNoisePresent: sources.has("extension"),
  };
}
