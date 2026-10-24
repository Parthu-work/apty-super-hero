/**
 * Iframes, coverage, weak selectors and noise for the report (R1.7). An
 * application frame needs handling in Apty; an extension's frame does not.
 * Coverage lists the kinds of state SEs most often miss, with the captured
 * pages whose markup suggests each one; whether a kind was captured is the
 * SE's call, never the engine's.
 */

import { noiseSourceOf } from "@apty/dom-snapshot";
import type { AnalyzedPage } from "./classify.js";
import { DOM_CONFIG_LIMITS } from "./limits.js";
import { type NoisePolicy, tagNoise, unconfirmedNoiseMarker } from "./noise.js";
import { compareText, isSafeLiteral, sortedUnique } from "./text.js";
import type {
  AttributePriority,
  CoverageKey,
  CoverageReport,
  DomConfigReportOptions,
  IframeEntry,
  NoiseEntry,
  PiiCounts,
  UnconfirmedNoiseEntry,
  WeakSelector,
} from "./types.js";

export function collectIframes(pages: AnalyzedPage[]): IframeEntry[] {
  const byKey = new Map<string, IframeEntry>();
  for (const page of pages) {
    for (const run of page.runs) {
      for (const frame of run.frames) {
        const entry: IframeEntry = {
          pages: [],
          src: frame.src ?? "(src not recorded)",
          crossOrigin: frame.crossOrigin,
          kind: frame.kind,
          analyzed: frame.analyzed,
          reason: frame.reason,
          needsHandling: frame.kind === "application",
        };
        const key = JSON.stringify([
          entry.src,
          entry.crossOrigin,
          entry.kind,
          entry.analyzed,
          entry.reason,
        ]);
        const existing = byKey.get(key) ?? entry;
        existing.pages = sortedUnique([...existing.pages, page.pageId]);
        byKey.set(key, existing);
      }
    }
  }
  return [...byKey.values()].sort(
    (a, b) =>
      Number(a.kind !== "application") - Number(b.kind !== "application") ||
      compareText(a.kind, b.kind) ||
      compareText(a.src, b.src) ||
      Number(a.analyzed) - Number(b.analyzed),
  );
}

const COVERAGE_KEYS: CoverageKey[] = [
  "entry-forms",
  "detail-pages",
  "list-grid-pages",
  "modals-dialogs",
  "popups",
  "dropdown-panels",
  "tooltips",
  "side-panels",
  "print-report-views",
  "embedded-documents",
  "click-only-states",
];

interface PageSignals {
  tags: Map<string, number>;
  roles: Set<string>;
  tokens: string[];
  urlShapes: string[];
  applicationFrames: number;
}

function signalsOf(page: AnalyzedPage): PageSignals {
  const tags = new Map<string, number>();
  const roles = new Set<string>();
  const tokens = new Set<string>();
  for (const run of page.runs) {
    for (const [tag, count] of run.tags)
      tags.set(tag, Math.max(tags.get(tag) ?? 0, count));
    for (const role of run.attributes.get("role")?.keys() ?? [])
      roles.add(role);
    for (const token of run.classTokens.keys()) tokens.add(token.toLowerCase());
    for (const id of run.attributes.get("id")?.keys() ?? [])
      tokens.add(id.toLowerCase());
  }
  return {
    tags,
    roles,
    tokens: [...tokens],
    urlShapes: page.runs.map((run) => run.meta.urlShape ?? ""),
    applicationFrames: page.runs.reduce(
      (most, run) =>
        Math.max(
          most,
          run.frames.filter((f) => f.kind === "application").length,
        ),
      0,
    ),
  };
}

const has = (s: PageSignals, ...words: string[]) =>
  s.tokens.some((token) => words.some((word) => token.includes(word)));
const tag = (s: PageSignals, name: string) => s.tags.get(name) ?? 0;

/** Markup that suggests each kind of state. Heuristic suggestions only. */
const SIGNALS: Record<CoverageKey, (s: PageSignals) => boolean> = {
  "entry-forms": (s) =>
    tag(s, "form") > 0 ||
    tag(s, "input") + tag(s, "textarea") + tag(s, "select") >= 3,
  "detail-pages": (s) => s.urlShapes.some((url) => url.includes(":id")),
  "list-grid-pages": (s) =>
    tag(s, "tr") >= 10 ||
    s.roles.has("grid") ||
    s.roles.has("treegrid") ||
    has(s, "ag-root"),
  "modals-dialogs": (s) =>
    tag(s, "dialog") > 0 ||
    s.roles.has("dialog") ||
    s.roles.has("alertdialog") ||
    has(s, "modal", "dialog"),
  popups: (s) => s.roles.has("menu") || has(s, "popup", "popover"),
  "dropdown-panels": (s) =>
    s.roles.has("listbox") || tag(s, "select") > 0 || has(s, "dropdown"),
  tooltips: (s) => s.roles.has("tooltip") || has(s, "tooltip"),
  "side-panels": (s) => has(s, "sidebar", "side-panel", "sidepanel", "drawer"),
  "print-report-views": (s) =>
    has(s, "print", "report") ||
    s.urlShapes.some((url) => /print|report/i.test(url)),
  "embedded-documents": (s) =>
    s.applicationFrames > 0 || tag(s, "embed") > 0 || tag(s, "object") > 0,
  "click-only-states": () => false,
};

export function buildCoverage(
  pages: AnalyzedPage[],
  statuses: DomConfigReportOptions["coverage"] = {},
): CoverageReport {
  const signals = pages.map((page) => [page.pageId, signalsOf(page)] as const);
  const items = COVERAGE_KEYS.map((key) => ({
    key,
    status: statuses[key] ?? ("not-captured" as const),
    candidates: signals.filter(([, s]) => SIGNALS[key](s)).map(([id]) => id),
  }));
  return {
    items,
    notCaptured: items
      .filter(
        (item) => item.status === "not-captured" || item.status === "planned",
      )
      .map((item) => item.key),
  };
}

/** Stable class tokens, ids and values of the proposed priority attributes that occur more than once on one page. */
export function findWeakSelectors(
  pages: AnalyzedPage[],
  priority: AttributePriority,
): { selectors: WeakSelector[]; total: number; withheld: number } {
  const names = new Set([
    "id",
    "class",
    ...priority.entries.map((e) => e.name),
  ]);
  const bySelector = new Map<string, WeakSelector>();
  const withheld = new Set<string>();
  for (const page of pages) {
    for (const item of page.classified.items) {
      if (item.bucket !== "stable" || item.count < 2 || !names.has(item.name))
        continue;
      if (!isSafeLiteral(item.value)) {
        withheld.add(`${item.name}\u0000${item.value}`);
        continue;
      }
      const selector =
        item.kind === "class"
          ? `.${item.value}`
          : item.kind === "id"
            ? `#${item.value}`
            : `[${item.name}="${item.value}"]`;
      const entry = bySelector.get(selector) ?? {
        selector,
        maxPerPage: 0,
        pages: [],
      };
      entry.maxPerPage = Math.max(entry.maxPerPage, item.count);
      entry.pages = sortedUnique([...entry.pages, page.pageId]);
      bySelector.set(selector, entry);
    }
  }
  const all = [...bySelector.values()].sort(
    (a, b) =>
      b.maxPerPage - a.maxPerPage || compareText(a.selector, b.selector),
  );
  return {
    selectors: all.slice(0, DOM_CONFIG_LIMITS.maxWeakSelectors),
    total: all.length,
    withheld: withheld.size,
  };
}

export function collectNoise(
  pages: AnalyzedPage[],
  policy: NoisePolicy,
): NoiseEntry[] {
  const byMatcher = new Map<string, NoiseEntry & { values: Set<string> }>();
  const note = (
    hit: { matcher: string; owner: string; source: NoiseEntry["source"] },
    value: string,
    page: string,
  ) => {
    const entry = byMatcher.get(hit.matcher) ?? {
      ...hit,
      count: 0,
      pages: [],
      values: new Set<string>(),
    };
    entry.values.add(value);
    entry.pages = sortedUnique([...entry.pages, page]);
    byMatcher.set(hit.matcher, entry);
  };
  /** Subtrees left out by the collector: the most roots one run of the page had, per matcher. */
  const roots = new Map<string, Map<string, number>>();
  for (const page of pages) {
    for (const item of page.classified.items) {
      if (item.noise)
        note(item.noise, `${item.name}\u0000${item.value}`, page.pageId);
    }
    for (const run of page.runs) {
      for (const excluded of run.excludedRoots) {
        const hit = {
          matcher: excluded.matcher,
          owner: excluded.owner,
          source: noiseSourceOf(excluded.owner),
        };
        const entry = byMatcher.get(hit.matcher);
        if (!entry) {
          byMatcher.set(hit.matcher, {
            ...hit,
            count: 0,
            pages: [],
            values: new Set(),
          });
        }
        byMatcher.get(hit.matcher)!.pages = sortedUnique([
          ...byMatcher.get(hit.matcher)!.pages,
          page.pageId,
        ]);
        const perPage = roots.get(hit.matcher) ?? new Map<string, number>();
        perPage.set(
          page.pageId,
          Math.max(perPage.get(page.pageId) ?? 0, excluded.roots),
        );
        roots.set(hit.matcher, perPage);
      }
    }
    for (const run of page.runs) {
      for (const tagName of run.tags.keys()) {
        const hit = tagNoise(tagName, policy);
        if (hit) note(hit, `tag\u0000${tagName}`, page.pageId);
      }
    }
  }
  return [...byMatcher.values()]
    .map(({ values, ...entry }) => ({
      ...entry,
      count:
        values.size +
        [...(roots.get(entry.matcher)?.values() ?? [])].reduce(
          (a, b) => a + b,
          0,
        ),
    }))
    .sort(
      (a, b) =>
        compareText(a.source, b.source) || compareText(a.matcher, b.matcher),
    );
}

export function collectUnconfirmedNoise(
  pages: AnalyzedPage[],
): UnconfirmedNoiseEntry[] {
  const byMarker = new Map<
    string,
    { values: Set<string>; pages: Set<string> }
  >();
  for (const page of pages) {
    for (const item of page.classified.items) {
      const marker =
        unconfirmedNoiseMarker("attribute", item.name) ??
        (item.kind !== "attribute"
          ? unconfirmedNoiseMarker(item.kind, item.value)
          : null);
      if (!marker) continue;
      const entry = byMarker.get(marker) ?? {
        values: new Set<string>(),
        pages: new Set<string>(),
      };
      entry.values.add(`${item.name}\u0000${item.value}`);
      entry.pages.add(page.pageId);
      byMarker.set(marker, entry);
    }
  }
  return [...byMarker]
    .map(([marker, entry]) => ({
      marker,
      count: entry.values.size,
      pages: sortedUnique(entry.pages),
    }))
    .sort((a, b) => compareText(a.marker, b.marker));
}

export function countPii(pages: AnalyzedPage[]): PiiCounts {
  const seen = {
    email: new Set<string>(),
    phone: new Set<string>(),
    digits: new Set<string>(),
  };
  for (const page of pages) {
    for (const item of page.classified.items) {
      if (item.pii) seen[item.pii].add(`${item.name}\u0000${item.value}`);
    }
  }
  return {
    email: seen.email.size,
    phone: seen.phone.size,
    digits: seen.digits.size,
  };
}
