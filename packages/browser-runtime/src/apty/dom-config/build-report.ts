/**
 * The DOM Config engine: validated runs in, a deterministic report out
 * (R1). It reads no clock and no randomness, orders everything with a
 * total order, and gives byte-identical output for the same input
 * whatever order pages, runs or object keys arrive in (D9). Capture dates
 * come only from the input.
 */
import { fnv1a } from "@apty/dom-snapshot";
import { type AnalyzedPage, classifyPage } from "./classify.js";
import {
  clickAdvance,
  containerScoreThreshold,
  deriveAttributePriority,
  deriveDebounce,
  deriveIgnoreEvents,
  deriveMaxZIndex,
  deriveShadowDom,
} from "./derive-settings.js";
import { diffPageRuns } from "./diff-runs.js";
import { detectNoisePresence, type FlatRun, flattenRun } from "./flatten.js";
import { generateRules } from "./generate-rules.js";
import {
  DOM_CONFIG_LIMITS,
  DOM_CONFIG_RULE_LIST_VERSION,
  DOM_CONFIG_TOOL_VERSION,
} from "./limits.js";
import { noisePolicy } from "./noise.js";
import {
  buildCoverage,
  collectIframes,
  collectNoise,
  collectUnconfirmedNoise,
  countPii,
  findWeakSelectors,
} from "./report-sections.js";
import {
  compareText,
  isSafeLiteral,
  sortedUnique,
  toUrlShape,
} from "./text.js";
import type {
  ApplicationCapture,
  DomConfigReport,
  DomConfigReportOptions,
  PageCapture,
  PageSummary,
  ProfileRun,
  RunLabel,
  RunSummary,
  TruncationEntry,
} from "./types.js";
import {
  ASSUMPTIONS,
  buildNotMeasured,
  buildWarnings,
  OPEN_QUESTIONS,
} from "./warnings.js";

const LABEL_ORDER: RunLabel[] = ["initial", "after-reload", "repeat"];

/** JSON with object keys sorted, so the same profile hashes the same whatever its key order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => compareText(a, b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sortRuns(runs: ProfileRun[]): ProfileRun[] {
  const keyed = runs.map((run) => ({ run, hash: fnv1a(canonicalJson(run)) }));
  keyed.sort(
    (a, b) =>
      LABEL_ORDER.indexOf(a.run.meta.label) -
        LABEL_ORDER.indexOf(b.run.meta.label) ||
      compareText(a.run.meta.capturedAt ?? "", b.run.meta.capturedAt ?? "") ||
      compareText(a.hash, b.hash),
  );
  return keyed.map((k) => k.run);
}

function sortPages(pages: PageCapture[]): PageCapture[] {
  return [...pages].sort(
    (a, b) => compareText(a.label, b.label) || compareText(a.pageId, b.pageId),
  );
}

const MAX_DATE_LENGTH = 40;

function captureDateOf(run: ProfileRun): string | null {
  const date = run.meta.capturedAt;
  return date ? date.slice(0, MAX_DATE_LENGTH) : null;
}

function runSummary(run: FlatRun, source: ProfileRun): RunSummary {
  return {
    label: run.meta.label,
    capturedAt: captureDateOf(source),
    urlShape: run.meta.urlShape ? toUrlShape(run.meta.urlShape) : null,
    aptyPresent: run.meta.aptyPresent,
    extensionNoisePresent: run.meta.extensionNoisePresent,
    partial: run.incomplete,
    stateMismatch: Boolean(run.meta.stateMismatch),
    elementCount: run.elementCount,
  };
}

function pageSummary(page: AnalyzedPage, sources: ProfileRun[]): PageSummary {
  const zs = page.runs.flatMap((run) => run.scopeMaxZIndexes);
  return {
    pageId: page.pageId,
    label: page.label,
    status: page.diff.status,
    runs: page.runs.map((run, i) => runSummary(run, sources[i]!)),
    diffs: page.diff.pairs,
    maxZIndex: zs.length ? Math.max(...zs) : null,
    shadowHosts: sortedUnique(
      page.runs
        .flatMap((run) => run.shadowHosts.map((h) => h.tag))
        .filter(isSafeLiteral),
    ),
    iframeCount: new Set(
      page.runs.flatMap((run) =>
        run.frames.map((f) => JSON.stringify([f.src, f.crossOrigin])),
      ),
    ).size,
  };
}

export function buildDomConfigReport(
  capture: ApplicationCapture,
  options: DomConfigReportOptions = {},
): DomConfigReport {
  const policy = noisePolicy(options.ignoredRoots);
  const truncations: TruncationEntry[] = [];
  const sortedPages = sortPages(capture.pages);
  if (sortedPages.length > DOM_CONFIG_LIMITS.maxPages) {
    truncations.push({
      pageId: "",
      run: -1,
      kind: "pages",
      name: null,
      dropped: sortedPages.length - DOM_CONFIG_LIMITS.maxPages,
    });
  }
  const sources = new Map<string, ProfileRun[]>();
  const analyzed: AnalyzedPage[] = sortedPages
    .slice(0, DOM_CONFIG_LIMITS.maxPages)
    .map((page) => {
      const sorted = sortRuns(page.runs);
      if (sorted.length > DOM_CONFIG_LIMITS.maxRunsPerPage) {
        truncations.push({
          pageId: page.pageId,
          run: -1,
          kind: "runs",
          name: null,
          dropped: sorted.length - DOM_CONFIG_LIMITS.maxRunsPerPage,
        });
      }
      const kept = sorted.slice(0, DOM_CONFIG_LIMITS.maxRunsPerPage);
      sources.set(page.pageId, kept);
      const runs = kept.map((run, index) => {
        const flat = flattenRun(run, policy);
        const presence = detectNoisePresence(flat, policy);
        flat.meta = {
          ...flat.meta,
          aptyPresent:
            flat.meta.aptyPresent ||
            presence.aptyPresent ||
            Boolean(run.profile.meta?.aptyPresent),
          extensionNoisePresent:
            flat.meta.extensionNoisePresent ||
            presence.extensionNoisePresent ||
            Boolean(run.profile.meta?.extensionNoisePresent),
        };
        for (const t of flat.truncations) {
          truncations.push({ pageId: page.pageId, run: index, ...t });
        }
        return flat;
      });
      const diff = diffPageRuns(runs, policy);
      return {
        pageId: page.pageId,
        label: page.label,
        runs,
        diff,
        classified: classifyPage(page.pageId, page.label, runs, diff, policy),
      };
    });

  const generated = generateRules(analyzed.map((page) => page.classified));
  const attributePriority = deriveAttributePriority(analyzed, policy);
  const weak = findWeakSelectors(analyzed, attributePriority);
  const unconfirmedNoise = collectUnconfirmedNoise(analyzed);
  const piiCounts = countPii(analyzed);
  const settings = {
    shadowDom: deriveShadowDom(analyzed),
    debounce: deriveDebounce(analyzed),
    ignoreEvents: deriveIgnoreEvents(analyzed),
    maxZIndex: deriveMaxZIndex(analyzed, policy),
  };
  return {
    applicationName: capture.applicationName,
    toolVersion: DOM_CONFIG_TOOL_VERSION,
    ruleListVersion: DOM_CONFIG_RULE_LIST_VERSION,
    captureDates: sortedUnique(
      [...sources.values()].flatMap((runs) =>
        runs.map(captureDateOf).filter((d): d is string => d !== null),
      ),
    ),
    pages: analyzed.map((page) => pageSummary(page, sources.get(page.pageId)!)),
    rules: generated.rules,
    rejectedRules: generated.rejectedRules,
    manualReview: generated.manualReview,
    coveredByDefaults: generated.coveredByDefaults,
    attributePriority,
    ...settings,
    containerScoreThreshold: containerScoreThreshold(),
    clickAdvance: clickAdvance(),
    iframes: collectIframes(analyzed),
    coverage: buildCoverage(analyzed, options.coverage),
    weakSelectors: weak.selectors,
    warnings: buildWarnings({
      pages: analyzed,
      generated,
      priority: attributePriority,
      weakSelectors: {
        total: weak.total,
        withheld: weak.withheld,
        pages: sortedUnique(weak.selectors.flatMap((s) => s.pages)),
      },
      piiCounts,
      truncations,
      unconfirmedNoise,
    }),
    unreadyPages: analyzed
      .filter(
        (page) =>
          page.diff.status === "single-run" ||
          page.diff.status === "unreliable",
      )
      .map((page) => ({
        pageId: page.pageId,
        label: page.label,
        reason: page.diff.status === "single-run" ? "single-run" : "unreliable",
      })),
    notMeasured: buildNotMeasured({ ...settings, unconfirmedNoise }),
    noise: collectNoise(analyzed, policy),
    unconfirmedNoise,
    truncations,
    piiCounts,
    assumptions: ASSUMPTIONS,
    openQuestions: OPEN_QUESTIONS,
  };
}
