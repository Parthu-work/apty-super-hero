/**
 * The validation bundle (WP B2): what an Apty engineer sends back after
 * running DOM Health on a real athenaOne or Infor LN tenant, so the
 * unverified thresholds and heuristics can be checked against evidence.
 *
 * Built field by field from an allow-list, never by copying a result and
 * removing what looks sensitive: hostnames and URL templates (never full
 * URLs), the frame tree with roles and why frames failed, the route probe's
 * signals as hashes and counts, a DOM Health summary of numbers, the
 * thresholds in effect, timings against the budget, and versions. There is
 * no element text, input value, page title, record number or cookie in it.
 * Every string then goes through the DOM Health exit redaction and strict
 * contract redaction, whatever the user's redaction mode.
 */
import { redactTextStrict } from "../runtime/redaction-mode.js";
import type {
  ApplicationAuditResult,
  PageAuditRecord,
} from "./application-scoring.js";
import {
  redactAuditUrl,
  redactDomHealthOutput,
} from "./dom-health-redaction.js";
import type { DomHealthAuditResult } from "./dom-health-scoring.js";
import {
  type ResolvedThresholds,
  thresholdReport,
} from "./dom-health-thresholds.js";
import type { DesEvidence } from "./element-explanation.js";
import type { FrameInventoryEntry } from "./frame-audit.js";
import type { RouteProbeFrameRecord, RouteProbeReport } from "./route-probe.js";
import { fnv1a } from "./state-fingerprint.js";

export const VALIDATION_BUNDLE_SCHEMA = "apty-dom-health-validation/1";

/** Frame keys that come from structure the application authors (`data-osp-id`, `name`, `id`), not from text a user could have typed. */
const STRUCTURAL_KEY_SOURCES = new Set(["top", "osp-id", "name", "id"]);

export interface ValidationBundleInput {
  page?: DomHealthAuditResult | null;
  application?: ApplicationAuditResult | null;
  probe?: RouteProbeReport | null;
  thresholds: ResolvedThresholds;
  versions: { extension: string; chrome: string | null };
  generatedAt?: Date;
}

/** `https://host/path?query#hash` → `https://host/path#hash-route`: the template's origin and path, and a hash route, but never a query. */
function urlTemplateOnly(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(redactAuditUrl(url));
    // about:blank, javascript: and data: frames have an opaque origin ("null").
    if (!/^https?:$/.test(parsed.protocol)) return parsed.protocol;
    const hashRoute = parsed.hash.startsWith("#/")
      ? parsed.hash.split("?")[0]
      : "";
    return `${parsed.origin}${parsed.pathname}${hashRoute}`;
  } catch {
    return null;
  }
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function frameSummary(frame: FrameInventoryEntry) {
  return {
    frameId: frame.frameId,
    parentFrameId: frame.parentFrameId,
    keySource: frame.keySource,
    keyStable: frame.keyStable,
    // A title key is text; only its hash goes out.
    key: STRUCTURAL_KEY_SOURCES.has(frame.keySource) ? frame.key : null,
    keyHash: fnv1a(frame.key),
    role: frame.role,
    roleReason: frame.roleReason,
    urlTemplate: urlTemplateOnly(frame.urlTemplate),
    status: frame.status,
    ...(frame.error ? { error: frame.error } : {}),
    score: frame.score ?? null,
    performance: frame.performance
      ? {
          totalMs: frame.performance.timings.totalMs,
          longestSliceMs: frame.performance.longestSliceMs,
          partialReasons: frame.performance.partialReasons,
        }
      : null,
  };
}

/** Counts per DES step and hit-test reason, and the attribute names left out as dynamic: names and numbers only. */
function desEvidenceSummary(evidence: DesEvidence | undefined) {
  if (!evidence) return null;
  return {
    steps: evidence.steps.map(({ step, elements }) => ({ step, elements })),
    hitTestReasons: evidence.hitTestReasons.map(({ reason, elements }) => ({
      reason,
      elements,
    })),
    dynamicValuesLeftOut: evidence.dynamicValuesLeftOut.map(
      ({ attribute, elements }) => ({ attribute, elements }),
    ),
  };
}

function auditSummary(result: DomHealthAuditResult) {
  return {
    score: result.score,
    grade: result.grade,
    confidence: result.confidence,
    evidenceState: result.evidenceState,
    confidenceCaps: result.confidenceCaps,
    frameAccessibility: {
      framesTotal: result.frameAccessibility.framesTotal,
      framesAccessible: result.frameAccessibility.framesAccessible,
      framesFailed: result.frameAccessibility.framesFailed,
      framesInaccessible: result.frameAccessibility.framesInaccessible,
      framesPlaceholder: result.frameAccessibility.framesPlaceholder ?? 0,
    },
    frames: (result.frames ?? []).map(frameSummary),
    coverage: {
      elementsAnalyzed: result.coverage.elementsAnalyzed,
      interactiveElementsInPage: result.coverage.interactiveElementsInPage,
      candidatesFound: result.coverage.analysis.candidatesFound,
      candidatesAnalyzed: result.coverage.analysis.candidatesAnalyzed,
      capped: result.coverage.analysis.capped,
    },
    overlays: (result.excludedRoots ?? []).map((entry) => ({
      matcher: entry.matcher,
      owner: entry.owner,
      evidence: entry.evidence,
      roots: entry.roots,
      elementCount: entry.elementCount,
    })),
    desEvidence: desEvidenceSummary(result.desEvidence),
    duplicateIds: {
      valuesDuplicatedWithinARoot:
        result.duplicateIds.valuesDuplicatedWithinARoot,
      valuesDuplicatedPageWide: result.duplicateIds.valuesDuplicatedPageWide,
      elementsWithDuplicatedId: result.duplicateIds.elementsWithDuplicatedId,
    },
    virtualized: {
      containers: result.virtualized.containers,
      observedItems: result.virtualized.observedItems,
      declaredTotal: result.virtualized.declaredTotal,
      signals: result.virtualized.samples.map((s) => s.signals),
    },
    performance: {
      timings: result.performance.timings,
      longestSliceMs: result.performance.longestSliceMs,
      longestStepMs: result.performance.longestStepMs,
      limits: result.performance.limits,
      withinBudget:
        result.performance.timings.totalMs <=
        result.performance.limits.timeBudgetMs,
      partialReasons: result.performance.partialReasons,
    },
  };
}

function pageSummary(page: PageAuditRecord) {
  return {
    urlTemplate: urlTemplateOnly(page.url),
    discoverySource: page.discoverySource,
    status: page.status,
    navigation: page.navigationModel
      ? {
          usesHistoryApiRouting: page.navigationModel.usesHistoryApiRouting,
          historyApiCallCount: page.navigationModel.historyApiCallCount,
          routingEvidence: page.navigationModel.routingEvidence ?? "observed",
          ...(page.navigationModel.routingEvidenceReason
            ? {
                routingEvidenceReason:
                  page.navigationModel.routingEvidenceReason,
              }
            : {}),
        }
      : null,
    audit: page.result ? auditSummary(page.result) : null,
  };
}

function applicationSummary(result: ApplicationAuditResult) {
  return {
    score: result.score,
    grade: result.grade,
    confidence: result.confidence,
    evidenceState: result.evidenceState,
    confidenceCaps: result.confidenceCaps,
    coverage: {
      pagesDiscovered: result.coverage.pagesDiscovered,
      pagesAudited: result.coverage.pagesAudited,
      pagesFailed: result.coverage.pagesFailed,
      pagesSkippedUnsafe: result.coverage.pagesSkippedUnsafe,
      pagesSkippedDuplicate: result.coverage.pagesSkippedDuplicate,
      pagesNotDiscovered: result.coverage.pagesNotDiscovered,
      pagesExploredNoNewState: result.coverage.pagesExploredNoNewState,
      coveragePercent: result.coverage.coveragePercent,
      framesDiscovered: result.coverage.framesDiscovered,
      framesInspected: result.coverage.framesInspected,
      framesInaccessible: result.coverage.framesInaccessible,
      framesPlaceholder: result.coverage.framesPlaceholder,
    },
    desEvidence: desEvidenceSummary(result.desEvidence),
    states: result.stateGraph
      ? {
          count: result.stateGraph.nodes.length,
          transitions: result.stateGraph.edges.length,
          routeConfidence: result.stateGraph.routeConfidence,
        }
      : null,
    traversal: result.traversal
      ? {
          mode: result.traversal.mode,
          reason: result.traversal.reason,
          clicksAllowed: result.traversal.clicksAllowed,
          evidence: result.traversal.evidence,
          changes: result.traversal.history.length,
        }
      : null,
    pages: result.pages.map(pageSummary),
  };
}

function probeFrame(frame: RouteProbeFrameRecord) {
  return {
    frameId: frame.frameId,
    parentFrameId: frame.parentFrameId,
    status: frame.status,
    ...(frame.error ? { error: frame.error } : {}),
    urlTemplate: urlTemplateOnly(frame.url),
    titleHash: frame.title?.hash ?? null,
    headingHash: frame.heading?.hash ?? null,
    activeNavHash: frame.activeNav?.hash ?? null,
    ownerKey: frame.owner?.ospId ?? null,
    historyApiCallCount: frame.historyApiCallCount,
    pushStateCount: frame.pushStateCount,
    firstRequest: frame.firstRequest
      ? {
          initiatorType: frame.firstRequest.initiatorType,
          path: urlTemplateOnly(
            `https://request.invalid${frame.firstRequest.path}`,
          )?.replace("https://request.invalid", ""),
          msAfterClick: frame.firstRequest.msAfterClick,
        }
      : null,
    virtualized: frame.virtualized
      ? {
          containers: frame.virtualized.containers,
          observedItems: frame.virtualized.observedItems,
          declaredTotal: frame.virtualized.declaredTotal,
        }
      : null,
  };
}

function probeSummary(probe: RouteProbeReport) {
  return {
    steps: probe.steps.map((step) => ({
      index: step.index,
      trigger: step.trigger,
      clickLabelHash: step.clickLabel?.hash ?? null,
      ...(step.error ? { error: step.error } : {}),
      frames: step.frames.map(probeFrame),
    })),
    analysis: {
      clicks: probe.analysis.clicks,
      hint: probe.analysis.hint,
      reasons: probe.analysis.reasons,
    },
  };
}

/** Every string, recursively, through strict contract redaction. */
function redactStrings(value: unknown): unknown {
  if (typeof value === "string") return redactTextStrict(value);
  if (Array.isArray(value)) return value.map(redactStrings);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactStrings(child)]),
    );
  }
  return value;
}

export function buildValidationBundle(input: ValidationBundleInput) {
  const urls = [
    ...(input.page?.frames ?? []).map((f) => f.urlTemplate),
    ...(input.application?.pages ?? []).flatMap((p) => [
      p.url,
      ...(p.result?.frames ?? []).map((f) => f.urlTemplate),
    ]),
    ...(input.probe?.steps ?? []).flatMap((s) => s.frames.map((f) => f.url)),
  ];
  const bundle = {
    schema: VALIDATION_BUNDLE_SCHEMA,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    versions: input.versions,
    hosts: [...new Set(urls.map(hostOf).filter((h): h is string => !!h))],
    thresholds: thresholdReport(input.thresholds),
    thresholdOverrides: {
      active: input.thresholds.active,
      rejected: input.thresholds.rejected.map((r) => ({
        name: r.name,
        reason: r.reason,
      })),
    },
    page: input.page ? auditSummary(input.page) : null,
    application: input.application
      ? applicationSummary(input.application)
      : null,
    routeProbe: input.probe ? probeSummary(input.probe) : null,
  };
  return redactStrings(redactDomHealthOutput(bundle)) as typeof bundle;
}

export type ValidationBundle = ReturnType<typeof buildValidationBundle>;

/** The Chrome major.minor.build.patch from a user-agent string, or null. */
export function chromeVersionFrom(userAgent: string): string | null {
  return /Chrome\/([\d.]+)/.exec(userAgent)?.[1] ?? null;
}
