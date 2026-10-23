/**
 * Compares the runs of one page (D1). A schema 1 profile has no element
 * identity, so a change is a difference between the value sets an
 * attribute name has in two runs: it cannot tell an attribute that changed
 * from data that changed (different rows). Element fingerprints, when the
 * collector records them, confirm that the same element carried another
 * value. Noise differences are kept apart, and only complete runs of the
 * intended state feed observed-change rules.
 */
import type { FlatRun } from "./flatten.js";
import { DOM_CONFIG_LIMITS } from "./limits.js";
import {
  attributeNameNoise,
  attributeValueNoise,
  classNoise,
  type NoisePolicy,
  tagNoise,
} from "./noise.js";
import { displayValue, sortedUnique } from "./text.js";
import type {
  PageStatus,
  RunPairDiff,
  TagDiffEntry,
  ValueDiffEntry,
} from "./types.js";

export interface PageDiff {
  status: PageStatus;
  /** Runs that may feed observed-change rules: complete and of the intended state. */
  eligible: number[];
  /** Per attribute name (`class` for class tokens), the values not present in every eligible run, noise removed. */
  changed: Map<string, Set<string>>;
  /** Names an element fingerprint shows changing on the same element. */
  elementConfirmed: Set<string>;
  pairs: RunPairDiff[];
}

/** Every attribute name of the run, `class` included, with its values. */
export function valuesByName(flat: FlatRun): Map<string, Map<string, number>> {
  const all = new Map(flat.attributes);
  if (flat.classTokens.size > 0) all.set("class", flat.classTokens);
  return all;
}

export function isNoiseValue(
  name: string,
  value: string,
  policy: NoisePolicy,
): boolean {
  if (attributeNameNoise(name, policy)) return true;
  return name === "class"
    ? classNoise(value, policy) !== null
    : attributeValueNoise(name, value, policy) !== null;
}

function isEligible(flat: FlatRun): boolean {
  return !flat.incomplete && !flat.meta.stateMismatch;
}

function pairDiff(
  from: number,
  to: number,
  a: FlatRun,
  b: FlatRun,
  policy: NoisePolicy,
): { diff: RunPairDiff; differences: number } {
  const cap = DOM_CONFIG_LIMITS.maxDiffEntriesPerPair;
  const values: ValueDiffEntry[] = [];
  const noiseValues: ValueDiffEntry[] = [];
  const tags: TagDiffEntry[] = [];
  const noiseTags: TagDiffEntry[] = [];
  let differences = 0;
  let truncated = false;
  const push = <T>(list: T[], entry: T) => {
    if (list.length < cap) list.push(entry);
    else truncated = true;
  };

  const aValues = valuesByName(a);
  const bValues = valuesByName(b);
  for (const name of sortedUnique([...aValues.keys(), ...bValues.keys()])) {
    const aMap = aValues.get(name) ?? new Map<string, number>();
    const bMap = bValues.get(name) ?? new Map<string, number>();
    for (const value of sortedUnique([...aMap.keys(), ...bMap.keys()])) {
      const fromCount = aMap.get(value) ?? 0;
      const toCount = bMap.get(value) ?? 0;
      if (fromCount === toCount) continue;
      const entry: ValueDiffEntry = {
        name,
        change: fromCount === 0 ? "added" : toCount === 0 ? "removed" : "count",
        value: displayValue(value),
        fromCount,
        toCount,
      };
      if (isNoiseValue(name, value, policy)) {
        push(noiseValues, entry);
      } else {
        differences++;
        push(values, entry);
      }
    }
  }
  for (const tag of sortedUnique([...a.tags.keys(), ...b.tags.keys()])) {
    const fromCount = a.tags.get(tag) ?? 0;
    const toCount = b.tags.get(tag) ?? 0;
    if (fromCount === toCount) continue;
    if (tagNoise(tag, policy)) {
      push(noiseTags, { tag, fromCount, toCount });
    } else {
      differences++;
      push(tags, { tag, fromCount, toCount });
    }
  }
  return {
    diff: { from, to, values, tags, noiseValues, noiseTags, truncated },
    differences,
  };
}

function changedValues(
  runs: FlatRun[],
  policy: NoisePolicy,
): Map<string, Set<string>> {
  const changed = new Map<string, Set<string>>();
  if (runs.length < 2) return changed;
  const maps = runs.map(valuesByName);
  const truncated = new Set(runs.flatMap((run) => [...run.truncatedNames]));
  const names = sortedUnique(maps.flatMap((map) => [...map.keys()]));
  for (const name of names) {
    if (truncated.has(name)) continue;
    const perRun = maps.map(
      (map) => map.get(name) ?? new Map<string, number>(),
    );
    const union = sortedUnique(perRun.flatMap((values) => [...values.keys()]));
    const differing = union.filter(
      (value) =>
        !perRun.every((values) => values.has(value)) &&
        !isNoiseValue(name, value, policy),
    );
    if (differing.length > 0) changed.set(name, new Set(differing));
  }
  return changed;
}

function elementConfirmedNames(runs: FlatRun[]): Set<string> {
  const confirmed = new Set<string>();
  const prints = runs.map((run) => run.fingerprints);
  if (prints.length < 2 || prints.some((p) => p === null)) return confirmed;
  const [first, ...rest] = prints as Map<string, Record<string, string>>[];
  for (const [fingerprint, hashes] of first!) {
    for (const other of rest) {
      const otherHashes = other.get(fingerprint);
      if (!otherHashes) continue;
      for (const [name, hash] of Object.entries(hashes)) {
        const otherHash = otherHashes[name];
        if (otherHash !== undefined && otherHash !== hash) confirmed.add(name);
      }
    }
  }
  return confirmed;
}

export function diffPageRuns(runs: FlatRun[], policy: NoisePolicy): PageDiff {
  const eligible = runs.flatMap((run, index) =>
    isEligible(run) ? [index] : [],
  );
  const eligibleRuns = eligible.map((index) => runs[index]!);
  const pairs: RunPairDiff[] = [];
  let differences = 0;
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const result = pairDiff(i, j, runs[i]!, runs[j]!, policy);
      pairs.push(result.diff);
      differences += result.differences;
    }
  }
  const status: PageStatus =
    eligible.length < runs.length
      ? "unreliable"
      : runs.length < 2
        ? "single-run"
        : differences > 0
          ? "changing"
          : "stable";
  return {
    status,
    eligible,
    changed: changedValues(eligibleRuns, policy),
    elementConfirmed: elementConfirmedNames(eligibleRuns),
    pairs: pairs.sort((x, y) => x.from - y.from || x.to - y.to),
  };
}
