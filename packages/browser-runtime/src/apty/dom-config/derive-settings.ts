/**
 * The DOM Settings values other than ignore conditions (R1.6). Each one
 * says how it was reached (D5): `measured` from the capture, `derived` by
 * a stated heuristic from measurements, or `default` when nothing here
 * measured it. A default is never presented as a finding.
 */
import {
  DEFAULT_DES_CONFIG,
  DEFAULT_IGNORE,
  DEFAULT_PRIORITY,
} from "@apty/dom-snapshot";
import {
  type AnalyzedPage,
  isLayoutAttribute,
  isStateAttribute,
} from "./classify.js";
import type { FlatRun } from "./flatten.js";
import {
  DEBOUNCE_DEFAULT_MS,
  DEBOUNCE_MAX_MS,
  DEBOUNCE_MIN_MS,
  DEBOUNCE_P90_FACTOR,
  EXTENSION_Z_INDEX,
  HIGH_FREQUENCY_EVENTS_PER_SECOND,
  LARGE_DOM_DIVS,
  MAX_APTY_Z_INDEX,
  MAX_PRIORITY_ATTRIBUTES,
  RECOMMENDED_APTY_Z_INDEX,
  REFERENCE_CONTAINER_SCORE_THRESHOLD,
} from "./limits.js";
import {
  attributeNameNoise,
  attributeValueNoise,
  classNoise,
  inlineZIndex,
  type NoisePolicy,
  tagNoise,
} from "./noise.js";
import { compareText, isSafeLiteral, sortedUnique } from "./text.js";
import type {
  AttributePriority,
  AttributePriorityEntry,
  ContainerScoreThreshold,
  ExcludedZIndex,
  MaxZIndexSetting,
  PriorityDiffEntry,
  Setting,
  ZIndexSource,
  ZIndexSourceSummary,
} from "./types.js";

const TEST_ATTRIBUTES = ["data-automation-id", "data-testid", "data-test"];

/** What a person typed or the server pre-filled; never identity (as in the audit profile). */
const NEVER_PRIORITY = new Set(["value"]);

interface NameStats {
  pagesWithName: number;
  stablePages: number;
  stableDistinct: number;
  stableOccurrences: number;
  piiHeavy: boolean;
}

function nameStats(pages: AnalyzedPage[]): Map<string, NameStats> {
  const stats = new Map<string, NameStats>();
  for (const page of pages) {
    const perName = new Map<
      string,
      { stable: number; occurrences: number; pii: number }
    >();
    for (const item of page.classified.items) {
      const name = item.name.toLowerCase();
      const entry = perName.get(name) ?? { stable: 0, occurrences: 0, pii: 0 };
      if (item.bucket === "stable") {
        entry.stable++;
        entry.occurrences += item.count;
      } else if (item.bucket === "pii") {
        entry.pii++;
      }
      perName.set(name, entry);
    }
    for (const [name, entry] of perName) {
      const total = stats.get(name) ?? {
        pagesWithName: 0,
        stablePages: 0,
        stableDistinct: 0,
        stableOccurrences: 0,
        piiHeavy: false,
      };
      total.pagesWithName++;
      if (entry.stable > 0) total.stablePages++;
      total.stableDistinct += entry.stable;
      total.stableOccurrences += entry.occurrences;
      if (entry.pii > 0 && entry.pii >= entry.stable) total.piiHeavy = true;
      stats.set(name, total);
    }
  }
  return stats;
}

function excludedFromPriority(name: string, policy: NoisePolicy): boolean {
  return (
    NEVER_PRIORITY.has(name) ||
    attributeNameNoise(name, policy) !== null ||
    DEFAULT_IGNORE.attribute(name) ||
    isStateAttribute(name) ||
    isLayoutAttribute(name)
  );
}

/**
 * Test attributes first, then `id`, then `name`, then the rest by
 * uniqueness. `id` precedes `name`, as in the pMD worked example
 * (Appendix C) and Apty's own default order; the brief's R1.6 lists `name`
 * first, and docs/development/dom-config.md records the choice.
 */
export function deriveAttributePriority(
  pages: AnalyzedPage[],
  policy: NoisePolicy,
): AttributePriority {
  const stats = nameStats(pages);
  const candidates = [...stats]
    .filter(
      ([name, s]) =>
        !excludedFromPriority(name, policy) &&
        !s.piiHeavy &&
        s.stablePages * 2 > s.pagesWithName,
    )
    .map(([name, s]) => ({
      name,
      ...s,
      uniqueness: s.stableDistinct / s.stableOccurrences,
    }));
  const byName = new Map(candidates.map((c) => [c.name, c]));
  const fixed = [...TEST_ATTRIBUTES, "id", "name"].filter((name) =>
    byName.has(name),
  );
  const others = candidates
    .filter((c) => !fixed.includes(c.name))
    .sort((a, b) => b.uniqueness - a.uniqueness || compareText(a.name, b.name))
    .map((c) => c.name);
  const chosen = [...fixed, ...others].slice(0, MAX_PRIORITY_ATTRIBUTES);
  const entries: AttributePriorityEntry[] = chosen.map((name) => {
    const c = byName.get(name)!;
    const pagesText = `stable on ${c.stablePages} of ${c.pagesWithName} page(s)`;
    const isFixed = fixed.includes(name);
    const reason = TEST_ATTRIBUTES.includes(name)
      ? `Written for test automation; ${pagesText}.`
      : name === "id"
        ? `Unique by definition once the generated ids in the ignore conditions are ignored; ${pagesText}.`
        : name === "name"
          ? `Form field name; ${pagesText}.`
          : `${pagesText[0]!.toUpperCase()}${pagesText.slice(1)}; uniqueness ${c.uniqueness.toFixed(2)} (distinct stable values / occurrences).`;
    return {
      name,
      reason,
      uniqueness: isFixed ? null : c.uniqueness,
      stablePages: c.stablePages,
    };
  });
  const diff: PriorityDiffEntry[] = [
    ...chosen.map((name, i) => ({
      name,
      proposedPosition: i + 1,
      defaultPosition: DEFAULT_PRIORITY.includes(name)
        ? DEFAULT_PRIORITY.indexOf(name) + 1
        : null,
    })),
    ...DEFAULT_PRIORITY.filter((name) => !chosen.includes(name)).map(
      (name) => ({
        name,
        proposedPosition: null,
        defaultPosition: DEFAULT_PRIORITY.indexOf(name) + 1,
      }),
    ),
  ];
  return {
    value: chosen.join(","),
    basis: "derived",
    reason:
      "Attributes stable on most captured pages, ordered test attributes, id, name, then by uniqueness.",
    entries,
    defaultPriority: [...DEFAULT_PRIORITY],
    diff,
  };
}

export function hasTestAttributes(priority: AttributePriority): boolean {
  return priority.entries.some((e) => TEST_ATTRIBUTES.includes(e.name));
}

export function deriveShadowDom(pages: AnalyzedPage[]): Setting<boolean> {
  const appHosts = new Set<string>();
  let noiseHosts = 0;
  let legacyOnly = true;
  for (const page of pages) {
    for (const run of page.runs) {
      if (run.seesClosedShadowRoots) legacyOnly = false;
      for (const host of run.shadowHosts) {
        if (host.noise) noiseHosts++;
        else
          appHosts.add(isSafeLiteral(host.tag) ? host.tag : "[tag withheld]");
      }
    }
  }
  if (appHosts.size > 0) {
    return {
      value: true,
      basis: "measured",
      reason: `Shadow roots with application content: ${sortedUnique(appHosts).join(", ")}.`,
    };
  }
  if (noiseHosts > 0) {
    return {
      value: true,
      basis: "default",
      reason:
        "Only Apty or extension shadow roots were seen. On by convention, not a finding.",
    };
  }
  return {
    value: false,
    basis: "measured",
    reason: `No shadow roots on the ${pages.length} captured page(s)${
      legacyOnly
        ? " (a console-script profile cannot see closed shadow roots)"
        : ""
    }. Turn it on if a page not captured uses Web Components.`,
  };
}

function sourceIsNoise(
  source: ZIndexSource,
  policy: NoisePolicy,
): string | null {
  const tokens = (source.class ?? "").split(/\s+/).filter(Boolean);
  const hit =
    tagNoise(source.tag, policy) ??
    (source.id ? attributeValueNoise("id", source.id, policy) : null) ??
    tokens.map((t) => classNoise(t, policy)).find(Boolean) ??
    null;
  if (hit) return hit.owner;
  return source.inline && source.value >= EXTENSION_Z_INDEX
    ? `inline z-index at or above ${EXTENSION_Z_INDEX} (extension icon)`
    : null;
}

function describeSource(source: ZIndexSource): string {
  const id = source.id && isSafeLiteral(source.id) ? `#${source.id}` : "";
  return `${source.tag}${id}`;
}

interface RunZ {
  appMax: number | null;
  source: ZIndexSource | null;
  excluded: Array<{ value: number; source: string }>;
}

function runZIndex(run: FlatRun, policy: NoisePolicy): RunZ {
  const excluded: RunZ["excluded"] = [];
  if (run.zIndexSourcesKnown) {
    let best: ZIndexSource | null = null;
    for (const source of run.zIndexSources) {
      const noise = sourceIsNoise(source, policy);
      if (noise)
        excluded.push({
          value: source.value,
          source: `${describeSource(source)} (${noise})`,
        });
      else if (!best || source.value > best.value) best = source;
    }
    if (best) return { appMax: best.value, source: best, excluded };
    const below = run.scopeMaxZIndexes.filter((z) => z < 1000);
    return {
      appMax: below.length ? Math.max(...below) : null,
      source: null,
      excluded,
    };
  }
  const styles = [...(run.attributes.get("style")?.keys() ?? [])]
    .map(inlineZIndex)
    .filter((z): z is number => z !== null);
  const noiseZ = new Set(styles.filter((z) => z >= EXTENSION_Z_INDEX));
  const kept: number[] = [];
  for (const z of run.scopeMaxZIndexes) {
    if (noiseZ.has(z)) {
      excluded.push({
        value: z,
        source: `inline z-index at or above ${EXTENSION_Z_INDEX} (extension icon; element unknown)`,
      });
    } else {
      kept.push(z);
    }
  }
  if (kept.length === 0)
    kept.push(...styles.filter((z) => z < EXTENSION_Z_INDEX));
  return {
    appMax: kept.length ? Math.max(...kept) : null,
    source: null,
    excluded,
  };
}

export function deriveMaxZIndex(
  pages: AnalyzedPage[],
  policy: NoisePolicy,
): MaxZIndexSetting {
  let appMax: number | null = null;
  let appMaxSource: ZIndexSource | null = null;
  const appMaxPages = new Set<string>();
  const excluded = new Map<string, ExcludedZIndex>();
  for (const page of pages) {
    for (const run of page.runs) {
      const z = runZIndex(run, policy);
      for (const e of z.excluded) {
        const key = `${e.value}\u0000${e.source}`;
        const entry = excluded.get(key) ?? {
          value: e.value,
          source: e.source,
          pages: [],
        };
        entry.pages = sortedUnique([...entry.pages, page.pageId]);
        excluded.set(key, entry);
      }
      if (z.appMax === null) continue;
      if (appMax === null || z.appMax > appMax) {
        appMax = z.appMax;
        appMaxSource = z.source;
        appMaxPages.clear();
      }
      if (z.appMax === appMax) {
        appMaxPages.add(page.pageId);
        appMaxSource ??= z.source;
      }
    }
  }
  const summary: ZIndexSourceSummary | null =
    appMax !== null && appMaxSource
      ? {
          value: appMax,
          tag: appMaxSource.tag,
          id:
            appMaxSource.id && isSafeLiteral(appMaxSource.id)
              ? appMaxSource.id
              : null,
          class:
            appMaxSource.class && isSafeLiteral(appMaxSource.class)
              ? appMaxSource.class
              : null,
          pages: sortedUnique(appMaxPages),
        }
      : null;
  const value =
    appMax !== null && appMax >= RECOMMENDED_APTY_Z_INDEX
      ? Math.min(appMax + 1, MAX_APTY_Z_INDEX)
      : RECOMMENDED_APTY_Z_INDEX;
  return {
    value,
    basis: appMax === null ? "default" : "derived",
    reason:
      appMax === null
        ? "No application z-index was recorded; the usual value keeps Apty above the page."
        : `The highest application z-index is ${appMax} (${
            summary ? describeSource(appMaxSource!) : "element unknown"
          }); Apty's layer must sit above it.`,
    appMax,
    appMaxSource: summary,
    excluded: [...excluded.values()].sort(
      (a, b) => b.value - a.value || compareText(a.source, b.source),
    ),
  };
}

function percentile90(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)]!;
}

export function largeDomPages(pages: AnalyzedPage[]): string[] {
  return pages
    .filter((page) =>
      page.runs.some((run) => (run.tags.get("div") ?? 0) > LARGE_DOM_DIVS),
    )
    .map((page) => page.pageId);
}

export function deriveDebounce(pages: AnalyzedPage[]): Setting<number> {
  const runs = pages.flatMap((page) => page.runs);
  const probed = runs.filter((run) => run.probe?.ran);
  const bursts = probed.flatMap((run) =>
    run.probe!.mutationBursts.map((b) => b.durationMs),
  );
  const large = largeDomPages(pages).length;
  const note = large
    ? ` ${large} page(s) have more than ${LARGE_DOM_DIVS} div elements; a longer debounce may suit them.`
    : "";
  if (bursts.length === 0) {
    return {
      value: DEBOUNCE_DEFAULT_MS,
      basis: "default",
      reason: `${
        probed.length
          ? "Not measured: the behavior probe saw no mutation bursts."
          : "Not measured: no behavior probe ran."
      } ${DEBOUNCE_DEFAULT_MS} ms is this tool's default.${note}`,
    };
  }
  const p90 = percentile90(bursts);
  const value = Math.round(
    Math.min(
      DEBOUNCE_MAX_MS,
      Math.max(DEBOUNCE_MIN_MS, p90 * DEBOUNCE_P90_FACTOR),
    ),
  );
  return {
    value,
    basis: "derived",
    reason: `Heuristic: the 90th percentile of ${bursts.length} mutation burst(s) is ${p90} ms; times ${DEBOUNCE_P90_FACTOR}, kept within ${DEBOUNCE_MIN_MS}-${DEBOUNCE_MAX_MS} ms.${note}`,
  };
}

export function deriveIgnoreEvents(pages: AnalyzedPage[]): Setting<string[]> {
  const rates = new Map<string, number>();
  for (const page of pages) {
    for (const run of page.runs) {
      if (!run.probe?.ran) continue;
      for (const [event, rate] of Object.entries(run.probe.eventRates)) {
        if (isSafeLiteral(event))
          rates.set(event, Math.max(rates.get(event) ?? 0, rate));
      }
    }
  }
  const high = [...rates]
    .filter(([, rate]) => rate > HIGH_FREQUENCY_EVENTS_PER_SECOND)
    .map(([event]) => event)
    .sort(compareText);
  if (high.length) {
    return {
      value: high,
      basis: "measured",
      reason: `Fired more than ${HIGH_FREQUENCY_EVENTS_PER_SECOND} times per second while the probe watched.`,
    };
  }
  return {
    value: [],
    basis: "default",
    reason:
      "None measured. An automatic capture has no human input, so mouse and scroll events rarely fire while it watches.",
  };
}

export function containerScoreThreshold(): ContainerScoreThreshold {
  return {
    referenceConfigValue: REFERENCE_CONTAINER_SCORE_THRESHOLD,
    reconstructedModelValue: DEFAULT_DES_CONFIG.containerScoreThreshold,
    basis: "default",
    reason: `Not measured. Reference configurations use ${REFERENCE_CONTAINER_SCORE_THRESHOLD}; the model reconstructed from Apty Studio build 63 uses ${DEFAULT_DES_CONFIG.containerScoreThreshold}. They may be one setting in different units; this tool neither converts nor chooses (open question 5).`,
  };
}

export function clickAdvance(): Setting<null> {
  return {
    value: null,
    basis: "default",
    reason: "Not measured by DOM analysis; keep the value Apty proposes.",
  };
}
