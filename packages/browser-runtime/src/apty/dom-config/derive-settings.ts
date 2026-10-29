/**
 * The DOM Settings values other than ignore conditions (R1.6). Each one
 * says how it was reached (D5): `measured` from the capture, `derived` by
 * a stated heuristic from measurements, or `default` when nothing here
 * measured it. A default is never presented as a finding.
 */
import {
  classifyUnstableClass,
  DEFAULT_IGNORE,
  DEFAULT_PRIORITY,
  fnv1a,
  isValueDynamic,
  type MutationSource,
} from "@apty/dom-snapshot";
import {
  type AnalyzedPage,
  isLayoutAttribute,
  isStateAttribute,
} from "./classify.js";
import type { FlatRun } from "./flatten.js";
import {
  APTY_CONTAINER_SCORE_THRESHOLD,
  CONTINUOUS_CALLBACKS_PER_SECOND,
  CONTINUOUS_MIN_CALLBACKS,
  DEBOUNCE_DEFAULT_MS,
  DEBOUNCE_MAX_MS,
  DEBOUNCE_MIN_MS,
  DEBOUNCE_P90_FACTOR,
  EXTENSION_Z_INDEX,
  LARGE_CONTAINER_DESCENDANTS,
  LARGE_DOM_DIVS,
  MAX_APTY_Z_INDEX,
  MAX_PRIORITY_ATTRIBUTES,
  RECOMMENDED_APTY_Z_INDEX,
} from "./limits.js";
import {
  attributeNameNoise,
  attributeValueNoise,
  classNoise,
  inlineZIndex,
  type NoisePolicy,
  tagNoise,
} from "./noise.js";
import { escapeRegexLiteral } from "./regex.js";
import { compareText, isSafeLiteral, sortedUnique } from "./text.js";
import type {
  AttributePriority,
  AttributePriorityEntry,
  ContainerScoreThreshold,
  DomEventRule,
  ExcludedZIndex,
  IgnoreDomEventsSetting,
  MaxZIndexSetting,
  NotProposedSource,
  PriorityDiffEntry,
  RuleCondition,
  Setting,
  ZIndexSource,
  ZIndexSourceSummary,
} from "./types.js";

const TEST_ATTRIBUTES = ["data-automation-id", "data-testid", "data-test"];

/** `pattern.ts`: an attribute name a CSS selector cannot hold is never selected. */
const SELECTABLE_ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

/** Attribute priority of Apty's application-type presets (`init-data.sql`); a non-empty application list replaces the preset's. */
export const APPLICATION_TYPE_PRIORITIES: AttributePriority["typePresets"] = [
  { type: "Generic", priority: ["aria-label", "title", "href", "id"] },
  { type: "Oracle", priority: ["aria-label", "title", "href", "id"] },
  { type: "Salesforce", priority: ["href", "title", "id"] },
  { type: "Workday", priority: ["data-automation-id", "id", "href"] },
];

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
    !SELECTABLE_ATTRIBUTE_NAME.test(name) ||
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
      "Attributes stable on most captured pages, ordered test attributes, id, name, then by uniqueness. Entered in DOM Settings, the list replaces the application type's preset as a whole.",
    entries,
    defaultPriority: [...DEFAULT_PRIORITY],
    typePresets: APPLICATION_TYPE_PRIORITIES,
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
      } Apty's own default of ${DEBOUNCE_DEFAULT_MS} ms applies when the field is left empty.${note}`,
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

/** Tags never proposed: ignoring one hides every change on the page. */
const NEVER_IGNORED_TAGS = new Set(["html", "head", "body", "main", "form"]);

/** Tags specific enough to name an element by tag alone. */
const SPECIFIC_TAGS = new Set([
  "marquee",
  "canvas",
  "video",
  "audio",
  "progress",
  "meter",
  "svg",
]);

function isStableName(value: string): boolean {
  return (
    isSafeLiteral(value) && !isValueDynamic(value) && !/\d{2,}/.test(value)
  );
}

/**
 * The condition Apty's Ignore DOM events can name a source by: its id, a
 * stable class token, or a tag specific enough to stand alone. Apty drops
 * a change when the changed element or any ancestor matches, so the
 * condition names the element itself, never a container. Apty's
 * converter keeps neither negation nor `className`, so neither is used.
 */
function domEventCondition(source: MutationSource): RuleCondition | null {
  if (source.id && isStableName(source.id)) {
    return {
      category: "Attribute Value",
      attribute: "id",
      operator: "Equals",
      value: source.id,
    };
  }
  const classes = source.classes ?? [];
  const token = classes.find(
    (c) => isStableName(c) && classifyUnstableClass(c, classes) === null,
  );
  if (token) {
    return {
      category: "Attribute Value",
      attribute: "class",
      operator: "Regex",
      value: `(?:^|\\s)${escapeRegexLiteral(token)}(?:\\s|$)`,
    };
  }
  if (source.tag.includes("-") || SPECIFIC_TAGS.has(source.tag)) {
    return isSafeLiteral(source.tag)
      ? {
          category: "Attribute Value",
          attribute: "tag",
          operator: "Equals",
          value: source.tag,
        }
      : null;
  }
  return null;
}

function whyNotProposed(source: MutationSource): string | null {
  if (NEVER_IGNORED_TAGS.has(source.tag)) {
    return "A page-level element: ignoring it would hide every change.";
  }
  if (source.interactive > 0) {
    return `It holds ${source.interactive} control(s); ignoring it would hide changes to them.`;
  }
  if (source.descendants >= LARGE_CONTAINER_DESCENDANTS) {
    return `A container of ${source.descendants} element(s); ignoring it would hide changes to all of them.`;
  }
  return null;
}

/**
 * Ignore DOM events (`ignoreDomChangeConditions`): elements that changed
 * continuously while the behavior probe watched (a clock, a spinner, a
 * ticker), whose changes would otherwise make Apty re-resolve every step
 * on each tick. An element holding controls, a large container and a
 * page-level element are listed, never proposed.
 */
export function deriveIgnoreEvents(
  pages: AnalyzedPage[],
): IgnoreDomEventsSetting {
  const rules = new Map<string, DomEventRule>();
  const notProposed = new Map<string, NotProposedSource>();
  let probed = 0;
  let sourcesSeen = 0;
  for (const page of pages) {
    for (const run of page.runs) {
      const probe = run.probe;
      if (!probe?.ran) continue;
      probed++;
      const seconds = Math.max(1, probe.windowMs / 1000);
      for (const source of probe.mutationSources ?? []) {
        sourcesSeen++;
        const rate = source.callbacks / seconds;
        if (
          source.callbacks < CONTINUOUS_MIN_CALLBACKS ||
          rate < CONTINUOUS_CALLBACKS_PER_SECOND
        ) {
          continue;
        }
        const tag = isSafeLiteral(source.tag) ? source.tag : "[tag withheld]";
        const blocked = whyNotProposed(source);
        const condition = blocked ? null : domEventCondition(source);
        if (!condition) {
          const reason =
            blocked ?? "Nothing stable names it: no stable id or class.";
          const key = `${tag}\u0000${reason}`;
          const entry = notProposed.get(key) ?? { tag, reason, pages: [] };
          entry.pages = sortedUnique([...entry.pages, page.pageId]);
          notProposed.set(key, entry);
          continue;
        }
        const key = JSON.stringify(condition);
        const existing = rules.get(key);
        const callbacksPerSecond = Math.round(rate * 100) / 100;
        if (existing) {
          existing.pages = sortedUnique([...existing.pages, page.pageId]);
          existing.callbacksPerSecond = Math.max(
            existing.callbacksPerSecond,
            callbacksPerSecond,
          );
          continue;
        }
        rules.set(key, {
          id: `e-${fnv1a(key)}`,
          condition,
          tag,
          callbacksPerSecond,
          pages: [page.pageId],
          reason: `A ${tag} element changed ${callbacksPerSecond} time(s) per second while the probe watched${
            source.attributeNames.length
              ? ` (${source.attributeNames.filter(isSafeLiteral).join(", ") || "attributes"})`
              : ""
          }, holding no control. Each change makes Apty re-resolve its steps.`,
        });
      }
    }
  }
  const list = [...rules.values()].sort(
    (a, b) =>
      b.callbacksPerSecond - a.callbacksPerSecond ||
      compareText(JSON.stringify(a.condition), JSON.stringify(b.condition)),
  );
  const skipped = [...notProposed.values()].sort(
    (a, b) => compareText(a.tag, b.tag) || compareText(a.reason, b.reason),
  );
  if (list.length) {
    return {
      value: list.map((rule) => rule.condition),
      basis: "measured",
      reason: `Elements that changed at least ${CONTINUOUS_CALLBACKS_PER_SECOND} time(s) per second while the probe watched, and hold no control.`,
      rules: list,
      notProposed: skipped,
    };
  }
  return {
    value: [],
    basis: "default",
    reason: !probed
      ? "Not measured: no behavior probe ran."
      : sourcesSeen
        ? "Nothing that can be ignored safely changed continuously while the probe watched."
        : "Nothing changed while the probe watched.",
    rules: [],
    notProposed: skipped,
  };
}

export function containerScoreThreshold(): ContainerScoreThreshold {
  return {
    referenceConfigValue: APTY_CONTAINER_SCORE_THRESHOLD,
    reconstructedModelValue: APTY_CONTAINER_SCORE_THRESHOLD / 100,
    basis: "default",
    reason: `Fixed by Apty: its application mapper sets ${APTY_CONTAINER_SCORE_THRESHOLD}, read as ${APTY_CONTAINER_SCORE_THRESHOLD / 100} of a step's stored containers. It is not a DOM Settings field, and steps captured by Apty 5 store no containers, so it changes nothing.`,
  };
}

export function clickAdvance(): Setting<null> {
  return {
    value: null,
    basis: "default",
    reason: "Not measured by DOM analysis; keep the value Apty proposes.",
  };
}
