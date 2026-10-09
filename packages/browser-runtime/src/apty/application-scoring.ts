/**
 * Application-wide DOM Health aggregation (spec sections 2, 26, 45, 54).
 *
 * Deliberately NOT an average of per-page scores — that would let one
 * excellent page hide a catastrophic one. Instead, the raw verified counts
 * behind every metric (direct/recovered/positional/ambiguous/... selector
 * outcomes, stability tracking, hit-test results) are SUMMED across every
 * successfully-audited page, and the exact same scoring kernels used for a
 * single page (`dom-health-scoring.ts`) are re-run on that summed total —
 * an element-weighted rollup, per spec section 26.
 *
 * `scope` is only ever `"application"` when at least two pages were
 * actually audited; a single-page result is always labeled `"page"`, even
 * if application-wide discovery was requested (spec section 54: never call
 * a single-page score an application score).
 */

import type { AnalysisCoverage } from "@apty/dom-snapshot";
import {
  buildRecommendations,
  buildRisks,
  buildStrengths,
  DEFAULT_FRAME_ACCESSIBILITY,
  DEFAULT_SELECTOR_CONFIGURATION,
  type DomHealthAuditResult,
  type DomHealthConfidence,
  type DomHealthGrade,
  type DomHealthMetricDetails,
  type DomHealthMetricKey,
  type DomHealthMetrics,
  type DomHealthRecommendation,
  type DomHealthRisk,
  determineEvidenceState,
  type EvidenceState,
  gradeForScore,
  isScoreMeaningful,
  METHODOLOGY,
  pct,
  type SelectorConfigurationEvidence,
  scoreAccessibilitySignal,
  scoreAmbiguityRisk,
  scoreAutomaticSelection,
  scoreHitTestTargetability,
  scoreRecoveryEfficacy,
  scoreSelectorComplexity,
  scoreSelectorStability,
  WEIGHTS,
} from "./dom-health-scoring.js";
import {
  type FrameAccessibilitySummary,
  sampleFailureReasons,
} from "./frame-tree.js";
import type { RouteKeyConfidence, RouteKeySummary } from "./route-key.js";
import type { TraversalReport } from "./traversal-strategy.js";

export type PageAuditStatus =
  | "completed"
  | "failed"
  | "skipped-unsafe"
  | "skipped-cross-origin"
  | "skipped-duplicate"
  /** A candidate application state was detected (e.g. a menu/tab/tree item with no real href) but never acted on — see `application-audit.ts`'s `allowClickDiscovery` gate. Reported explicitly, never folded into "discovered". */
  | "not-discovered";

export type PageDiscoverySource =
  | "seed"
  | "same-origin-link"
  | "safe-navigation-control";

export interface PageNavigationModel {
  usesHistoryApiRouting: boolean;
  historyApiCallCount: number;
}

export interface PageAuditRecord {
  url: string;
  title: string | null;
  discoverySource: PageDiscoverySource;
  status: PageAuditStatus;
  failureReason?: string;
  /** Present only when `status === "completed"`. */
  result?: DomHealthAuditResult;
  /** Diagnostic only (spec section 24) — never affects scoring. */
  navigationModel?: PageNavigationModel;
  /** How this audited state's identity was determined — "url" when the URL changed, or a description of which structural signal did (see `state-fingerprint.ts`) when it did not. Present only when `status === "completed"`. */
  transitionReason?: string;
  /** This state's own frame-tree accessibility — summed into the application-level `frameAccessibility` below. Present only when `status === "completed"`. */
  frameAccessibility?: FrameAccessibilitySummary;
}

/**
 * Deliberately called "observed", not "total" — this audit can only ever
 * report what it discovered and attempted; it has no way to know how many
 * states/pages an application actually has (spec section 9's honesty
 * requirement). `coveragePercent` is coverage OF WHAT WAS DISCOVERED, never
 * a claim of total application coverage.
 */
export interface ApplicationCoverage {
  pagesDiscovered: number;
  pagesAudited: number;
  pagesFailed: number;
  pagesSkippedUnsafe: number;
  pagesSkippedDuplicate: number;
  /** States a candidate was detected for but never acted on (click-discovery gate off, or a click that didn't produce a new state) — visibility into what discovery COULD explore further, never hidden. */
  pagesNotDiscovered: number;
  coveragePercent: number;
  /** Always "OBSERVED_COVERAGE" — never "TOTAL_APPLICATION_COVERAGE", because this audit cannot know the true size of the application. */
  coverageLabel: "OBSERVED_COVERAGE";
  /** How additional states were looked for: literal `<a href>` links, and (only when explicitly enabled) safe non-anchor navigation controls. */
  discoveryMethod: string;
  framesDiscovered: number;
  framesInspected: number;
  framesInaccessible: number;
}

/** One state-graph node, presentation-shaped (see `state-graph.ts`'s `ApplicationStateNode` for the full internal model this is derived from). */
export interface StateGraphNodeSummary {
  stateId: string;
  url: string;
  title: string | null;
  /** True when this state's URL template equals the seed state's — the Infor LN-shaped case same-URL discovery exists for. */
  sameUrlAsSeed: boolean;
  discoveredAt: number;
  /** How this state was identified, and how confidently (`route-key.ts`). */
  route: RouteKeySummary;
}

/** One state-graph edge, presentation-shaped. */
export interface StateGraphEdgeSummary {
  id: string;
  sourceStateId: string;
  targetStateId: string;
  triggerKind: "seed" | "url-navigation" | "click";
  /** Human-readable label for the transition — the clicked control's text, or the navigated-to URL. */
  triggerLabel: string;
  sameUrl: boolean;
  historyEventDelta: number;
  confidence: "confirmed" | "restored";
  /** For a click: which signals besides the DOM corroborated it. Empty for an uncorroborated click; absent for a URL load. */
  corroboratedBy?: Array<"history" | "frame-src" | "network">;
  /** For a click: whether a network capture was running, so `network` could have corroborated it. */
  networkObserved?: boolean;
}

export interface StateGraphSummary {
  seedStateId: string | null;
  nodes: StateGraphNodeSummary[];
  edges: StateGraphEdgeSummary[];
  /** States per route-key confidence. A `low` state was told apart by its structure alone. */
  routeConfidence: Record<RouteKeyConfidence, number>;
}

/** Evidence for one backtracking attempt — restoring the live tab to a previously-discovered state before exploring one of its other children. */
export interface RestorationEvidence {
  targetStateId: string;
  success: boolean;
  stepCount: number;
  /** Set only on failure — the 0-based step where replay diverged from the originally-recorded transition. */
  failedAtStep?: number;
  reason?: string;
  /** "direct-url": loaded the state's URL. "replay": reloaded the seed and replayed the recorded path, clicking links and controls. */
  method?: "direct-url" | "replay";
  /** True when a direct URL load was tried first and did not reproduce the state. */
  fellBackFromDirectUrl?: boolean;
}

/**
 * Cross-APPLICATION-STATE selector validation (spec section 7) — the
 * primary answer to "can a selector/path captured in one application state
 * still resolve correctly when the application changes state", as distinct
 * from same-state, time-spaced volatility (which each page's own
 * `stability` already covers). Real `ElementPath`s captured at the seed
 * state are REPLAYED (via `verifyStoredElementPath`, never regenerated)
 * against every other state this run actually audited.
 *
 * Deliberately seed-vs-every-other-state, not a full all-pairs replay
 * across every discovered state — a tractable, honestly-scoped design
 * documented as a known limitation (see
 * `docs/development/dom-health-architecture.md`), not an attempt at
 * exhaustive cross-state coverage.
 */
export interface CrossStateSelectorEvidence {
  /** Total replay attempts across every non-seed state this run audited. */
  attempted: number;
  directStable: number;
  recoveredStable: number;
  positionalStable: number;
  wrongTarget: number;
  /** Includes `hostChainBroken`. */
  notResolved: number;
  /** Replays that failed at a shadow host before reaching the element. */
  hostChainBroken: number;
  /** A few of those, with the frame, the hop index and that host's own selector. */
  hostChainBreaks: Array<{
    frameId: number;
    hop: number;
    hostSelector: string;
  }>;
  /** Samples in the pre-`ElementRef` shape, replayed against the document only. Always 0 for samples this version captured. */
  legacySamples: number;
  /** How many OTHER states (beyond the seed itself) had at least one replay attempted against them. */
  statesTested: number;
}

export const EMPTY_CROSS_STATE_SELECTOR_EVIDENCE: CrossStateSelectorEvidence = {
  attempted: 0,
  directStable: 0,
  recoveredStable: 0,
  positionalStable: 0,
  wrongTarget: 0,
  notResolved: 0,
  hostChainBroken: 0,
  hostChainBreaks: [],
  legacySamples: 0,
  statesTested: 0,
};

export interface ApplicationAuditResult {
  auditId: string;
  timestamp: number;
  /** "application" only when >=2 pages were actually audited — never a lie about coverage. */
  scope: "application" | "page";
  /** Null exactly when `evidenceState` is not HEALTHY_EVIDENCE/PARTIAL_EVIDENCE — see `dom-health-scoring.ts`'s `EvidenceState`. */
  score: number | null;
  grade: DomHealthGrade;
  confidence: DomHealthConfidence;
  evidenceState: EvidenceState;
  frameAccessibility: FrameAccessibilitySummary;
  coverage: ApplicationCoverage;
  analysisCoverage: AnalysisCoverage;
  manualSelectorDependency: number;
  metrics: DomHealthMetrics;
  metricDetails: DomHealthMetricDetails;
  summary: string;
  strengths: string[];
  risks: DomHealthRisk[];
  recommendations: DomHealthRecommendation[];
  pages: PageAuditRecord[];
  methodology: string[];
  /** The real state-discovery tree this run built — never a flat page list — see `state-graph.ts`. Absent only if the caller didn't pass one (e.g. an older/degenerate call path). */
  stateGraph?: StateGraphSummary;
  /** URL-first or click-first, and why (`traversal-strategy.ts`); absent for a single-page result. */
  traversal?: TraversalReport;
  /** Every backtracking attempt made during this run (restoring the live tab to a previously-discovered state before exploring one of its other children), success or failure — never silently retried and hidden. */
  restorations: RestorationEvidence[];
  /** Real Apty ElementPaths captured at the seed state, replayed against every other audited state (spec section 7) — see `CrossStateSelectorEvidence`'s doc comment. Its counts are already folded into `metricDetails.selectorStability`, and reported here again on their own so this specific evidence is never buried. */
  crossStateEvidence: CrossStateSelectorEvidence;
  /** Human-readable companion to `scope` — "APPLICATION" when `scope === "application"`, "CURRENT_PAGE" otherwise (spec sections 1/18). A result labeled CURRENT_PAGE here is never described as application health, however this tool was invoked. */
  scopeLabel: "APPLICATION" | "CURRENT_PAGE";
  /** Whether real customer-specific Apty Studio configuration or Apty's own defaults were used (spec section 8) — see `dom-health-scoring.ts`'s `DEFAULT_SELECTOR_CONFIGURATION`. */
  selectorConfiguration: SelectorConfigurationEvidence;
}

/**
 * The direct fix for "the tool reported 92/100 on an application that was
 * never actually comprehensively explored": per-element evidence (real
 * selector resolution/stability on the states that WERE audited) is never
 * enough on its own to call the APPLICATION well-evidenced. Real coverage
 * signals — candidates detected but never explored, and backtracking
 * restorations that failed (meaning whatever lay beyond that failure point
 * was never reached at all) — can downgrade an otherwise-healthy page-level
 * evidence state to `INCOMPLETE_EVIDENCE`, which is never scoreable (see
 * `isScoreMeaningful`): a real number is never reported standing in for
 * "we don't actually know how much of this application this covers."
 */
export function determineApplicationEvidenceState(inputs: {
  pageLevelEvidenceState: EvidenceState;
  audited: number;
  /** Total known page/state inventory rows (`pages.length`) — completed, failed, and skipped alike. */
  discovered: number;
  /** Detected navigation candidates that were never explored (click discovery off, or a click that produced nothing new). */
  notDiscovered: number;
  /** Backtracking attempts (`restorations`) that did not reproduce their originally-recorded target state. */
  restorationFailures: number;
}): EvidenceState {
  const {
    pageLevelEvidenceState,
    audited,
    discovered,
    notDiscovered,
    restorationFailures,
  } = inputs;
  // No per-element evidence exists at all, or a frame that should have
  // answered didn't — those states already say everything that needs
  // saying; application-coverage gating on top would only obscure it.
  if (
    pageLevelEvidenceState === "FAILED" ||
    pageLevelEvidenceState === "NO_EVIDENCE" ||
    pageLevelEvidenceState === "INACCESSIBLE"
  ) {
    return pageLevelEvidenceState;
  }
  // `discovered` (`pages.length`) already includes every `not-discovered`
  // row as a subset — it is the full known-about universe, not a disjoint
  // count to add `notDiscovered` on top of.
  const unexploredShare = discovered === 0 ? 0 : notDiscovered / discovered;
  const insufficientCoverage =
    // At least one branch of the discovery tree could not be reliably
    // reached again — whatever lies beyond it was never audited, and never
    // will be reported as if it had been.
    restorationFailures > 0 ||
    // Real navigation candidates were detected, proving a larger
    // application exists, yet this run never got beyond the seed state.
    (notDiscovered > 0 && audited < 2) ||
    // A large, statistically meaningful share of everything this run knew
    // about was never actually explored.
    (discovered >= 5 && unexploredShare > 0.5);
  return insufficientCoverage ? "INCOMPLETE_EVIDENCE" : pageLevelEvidenceState;
}

function sumField<K extends DomHealthMetricKey>(
  completed: PageAuditRecord[],
  metric: K,
  field: string,
): number {
  return completed.reduce((sum, page) => {
    const detail = page.result?.metricDetails[metric] as
      | Record<string, number>
      | undefined;
    return sum + (detail?.[field] ?? 0);
  }, 0);
}

const APPLICATION_METHODOLOGY_PREFIX: string[] = [
  "Discover same-origin pages via real <a href> elements already present in the DOM — never by simulating a click, so no destructive action (delete/logout/submit/...) is ever triggered during discovery.",
  "Choose URL-first or click-first traversal from what the run observes (links at the seed, same-URL transitions, whether loading a recorded URL reproduces its screen) and report the choice and the reason; clicking still requires the explicit application-deep discovery mode.",
  "Navigate the tab to each discovered, filtered-safe page in turn, wait for the browser's own load-complete signal, then wait for the DOM to stop mutating (a quiet-period observer, not a fixed delay) before analyzing it.",
  "Run the full single-page DOM Health pipeline on every visited page (see below), maintaining an explicit page inventory — audited, failed, and skipped pages are all reported, never silently dropped.",
];

/**
 * Build the application-level result from every page this audit run
 * attempted, in the order they were visited.
 */
export function buildApplicationAuditResult(
  pages: PageAuditRecord[],
  auditId: string,
  options: {
    discoveryMethod?: string;
    stateGraph?: StateGraphSummary;
    restorations?: RestorationEvidence[];
    crossStateEvidence?: CrossStateSelectorEvidence;
    traversal?: TraversalReport;
  } = {},
): ApplicationAuditResult {
  const crossStateEvidence =
    options.crossStateEvidence ?? EMPTY_CROSS_STATE_SELECTOR_EVIDENCE;
  const completed = pages.filter((p) => p.status === "completed" && p.result);
  const failed = pages.filter((p) => p.status === "failed").length;
  const skippedUnsafe = pages.filter(
    (p) => p.status === "skipped-unsafe" || p.status === "skipped-cross-origin",
  ).length;
  const skippedDuplicate = pages.filter(
    (p) => p.status === "skipped-duplicate",
  ).length;
  const notDiscovered = pages.filter(
    (p) => p.status === "not-discovered",
  ).length;
  const discovered = pages.length;
  const audited = completed.length;

  const framesDiscovered = completed.reduce(
    (sum, p) => sum + (p.frameAccessibility?.framesTotal ?? 0),
    0,
  );
  const framesInspected = completed.reduce(
    (sum, p) => sum + (p.frameAccessibility?.framesAccessible ?? 0),
    0,
  );
  const framesFailedAcrossPages = completed.reduce(
    (sum, p) => sum + (p.frameAccessibility?.framesFailed ?? 0),
    0,
  );
  const framesInaccessibleAcrossPages = completed.reduce(
    (sum, p) => sum + (p.frameAccessibility?.framesInaccessible ?? 0),
    0,
  );

  const coverage: ApplicationCoverage = {
    pagesDiscovered: discovered,
    pagesAudited: audited,
    pagesFailed: failed,
    pagesSkippedUnsafe: skippedUnsafe,
    pagesSkippedDuplicate: skippedDuplicate,
    pagesNotDiscovered: notDiscovered,
    coveragePercent: discovered === 0 ? 0 : pct(audited, discovered),
    coverageLabel: "OBSERVED_COVERAGE",
    discoveryMethod: options.discoveryMethod ?? "anchor-links",
    framesDiscovered,
    framesInspected,
    framesInaccessible: framesFailedAcrossPages + framesInaccessibleAcrossPages,
  };

  const automaticSelection = scoreAutomaticSelection({
    totalAnalyzed: sumField(completed, "automaticSelection", "totalAnalyzed"),
    directSuccess: sumField(completed, "automaticSelection", "directSuccess"),
    recoveredByIgnore: sumField(
      completed,
      "automaticSelection",
      "recoveredByIgnore",
    ),
    recoveredByPartial: sumField(
      completed,
      "automaticSelection",
      "recoveredByPartial",
    ),
    recoveredByContext: sumField(
      completed,
      "automaticSelection",
      "recoveredByContext",
    ),
  });

  // Cross-application-state replay evidence (spec section 7) is folded
  // into the SAME totals as same-state stability, rather than a parallel
  // scoring system — both answer "does a captured selector/path still
  // resolve correctly", just at different time/state scales. This makes
  // cross-state stability a REAL, additive contributor to the application's
  // selectorStability metric, never a side channel the score can ignore.
  const selectorStability = scoreSelectorStability({
    trackedFromPrevious:
      sumField(completed, "selectorStability", "trackedFromPrevious") +
      crossStateEvidence.attempted,
    directStable:
      sumField(completed, "selectorStability", "directStable") +
      crossStateEvidence.directStable,
    recoveredStable:
      sumField(completed, "selectorStability", "recoveredStable") +
      crossStateEvidence.recoveredStable,
    positionalStable:
      sumField(completed, "selectorStability", "positionalStable") +
      crossStateEvidence.positionalStable,
    wrongTarget:
      sumField(completed, "selectorStability", "wrongTarget") +
      crossStateEvidence.wrongTarget,
    notResolved:
      sumField(completed, "selectorStability", "notResolved") +
      crossStateEvidence.notResolved,
    detached: sumField(completed, "selectorStability", "detached"),
    new: sumField(completed, "selectorStability", "new"),
  });

  const recoveryEfficacy = scoreRecoveryEfficacy({
    totalAnalyzed: sumField(completed, "automaticSelection", "totalAnalyzed"),
    directSuccess: sumField(completed, "automaticSelection", "directSuccess"),
    recoveredByIgnore: sumField(
      completed,
      "automaticSelection",
      "recoveredByIgnore",
    ),
    recoveredByPartial: sumField(
      completed,
      "automaticSelection",
      "recoveredByPartial",
    ),
    recoveredByContext: sumField(
      completed,
      "automaticSelection",
      "recoveredByContext",
    ),
  });

  const selectorComplexity = scoreSelectorComplexity({
    totalAnalyzed: sumField(completed, "selectorComplexity", "totalAnalyzed"),
    deepTraversalCount: sumField(
      completed,
      "selectorComplexity",
      "deepTraversalCount",
    ),
    positionalCount: sumField(
      completed,
      "selectorComplexity",
      "positionalCount",
    ),
  });

  const ambiguityRisk = scoreAmbiguityRisk({
    totalAnalyzed: sumField(completed, "ambiguityRisk", "totalAnalyzed"),
    ambiguous: sumField(completed, "ambiguityRisk", "ambiguous"),
    wrongTarget: sumField(completed, "ambiguityRisk", "wrongTarget"),
  });

  const hitTestTargetability = scoreHitTestTargetability({
    tested: sumField(completed, "hitTestTargetability", "tested"),
    fullyTargetable: sumField(
      completed,
      "hitTestTargetability",
      "fullyTargetable",
    ),
    partiallyTargetable: sumField(
      completed,
      "hitTestTargetability",
      "partiallyTargetable",
    ),
  });

  const accessibilitySignal = scoreAccessibilitySignal({
    totalInteractive: sumField(
      completed,
      "accessibilitySignal",
      "totalInteractive",
    ),
    missingAccessibleName: sumField(
      completed,
      "accessibilitySignal",
      "missingAccessibleName",
    ),
  });

  // DOM volatility isn't summable (it's already a bounded 0-100 signal per
  // page) — take the worst (lowest) observed across pages, so one volatile
  // page cannot be diluted away by several stable ones.
  const domVolatilityScore =
    completed.length === 0
      ? 100
      : Math.min(...completed.map((p) => p.result!.metrics.domVolatility));
  const maxRelativeElementCountDelta =
    completed.length === 0
      ? 0
      : Math.max(
          ...completed.map(
            (p) =>
              p.result!.metricDetails.domVolatility
                .maxRelativeElementCountDelta,
          ),
        );

  const metrics: DomHealthMetrics = {
    automaticSelection: automaticSelection.score,
    selectorStability: selectorStability.score,
    recoveryEfficacy: recoveryEfficacy.score,
    selectorComplexity: selectorComplexity.score,
    ambiguityRisk: ambiguityRisk.score,
    hitTestTargetability: hitTestTargetability.score,
    domVolatility: domVolatilityScore,
    accessibilitySignal: accessibilitySignal.score,
  };

  const applicationFrameAccessibility: FrameAccessibilitySummary =
    framesDiscovered === 0
      ? DEFAULT_FRAME_ACCESSIBILITY
      : {
          framesTotal: framesDiscovered,
          framesAccessible: framesInspected,
          framesFailed: framesFailedAcrossPages,
          framesInaccessible: framesInaccessibleAcrossPages,
          sampleFailureReasons: sampleFailureReasons(
            completed.flatMap(
              (p) => p.frameAccessibility?.sampleFailureReasons ?? [],
            ),
          ),
        };
  const totalAnalyzedForEvidence = sumField(
    completed,
    "automaticSelection",
    "totalAnalyzed",
  );
  const pageLevelEvidenceState: EvidenceState =
    audited === 0
      ? "FAILED"
      : determineEvidenceState(
          totalAnalyzedForEvidence,
          applicationFrameAccessibility,
        );
  const restorationFailures = (options.restorations ?? []).filter(
    (r) => !r.success,
  ).length;
  const evidenceState = determineApplicationEvidenceState({
    pageLevelEvidenceState,
    audited,
    discovered,
    notDiscovered,
    restorationFailures,
  });
  const scoreIsMeaningful = isScoreMeaningful(evidenceState);

  const rawScore = (Object.keys(WEIGHTS) as DomHealthMetricKey[]).reduce(
    (sum, key) => sum + metrics[key] * WEIGHTS[key],
    0,
  );
  // Same RC-3 gate as the single-page scorer: zero analyzed elements across
  // every audited page/state must never round-trip into a healthy-looking
  // application score.
  const score = scoreIsMeaningful
    ? Math.round(Math.min(100, Math.max(0, rawScore)))
    : null;
  const grade = score === null ? "NOT_ASSESSED" : gradeForScore(score);

  const metricDetails: DomHealthMetricDetails = {
    automaticSelection: automaticSelection.detail,
    selectorStability: selectorStability.detail,
    recoveryEfficacy: recoveryEfficacy.detail,
    selectorComplexity: selectorComplexity.detail,
    ambiguityRisk: ambiguityRisk.detail,
    hitTestTargetability: hitTestTargetability.detail,
    domVolatility: {
      maxRelativeElementCountDelta,
      snapshotsCompared: completed.reduce(
        (sum, p) => sum + p.result!.metadata.snapshotsCompared,
        0,
      ),
    },
    accessibilitySignal: accessibilitySignal.detail,
  };

  const totalAnalyzed = metricDetails.automaticSelection.totalAnalyzed;
  const manualSelectorDependencyCount =
    sumField(completed, "automaticSelection", "totalAnalyzed") -
    (automaticSelection.detail.directSuccess +
      automaticSelection.detail.recoveredByIgnore +
      automaticSelection.detail.recoveredByPartial +
      automaticSelection.detail.recoveredByContext);
  const manualSelectorDependency = pct(
    Math.max(0, manualSelectorDependencyCount),
    totalAnalyzed,
  );

  const analysisCoverage: AnalysisCoverage = {
    candidatesFound: completed.reduce(
      (sum, p) => sum + p.result!.coverage.analysis.candidatesFound,
      0,
    ),
    candidatesAnalyzed: completed.reduce(
      (sum, p) => sum + p.result!.coverage.analysis.candidatesAnalyzed,
      0,
    ),
    capped: completed.some((p) => p.result!.coverage.analysis.capped),
    capReason: completed.some((p) => p.result!.coverage.analysis.capped)
      ? "At least one audited page hit its per-page runaway-safety element ceiling — see that page's own report for detail."
      : null,
  };

  // "application" only ever applies with real multi-page coverage — never
  // for a single audited page, whatever scope the caller requested.
  const scope: "application" | "page" = audited >= 2 ? "application" : "page";

  const confidence: DomHealthConfidence = !scoreIsMeaningful
    ? "LOW"
    : audited >= 3 && coverage.coveragePercent >= 70 && totalAnalyzed >= 50
      ? "HIGH"
      : audited >= 2 && totalAnalyzed >= 10
        ? "MEDIUM"
        : "LOW";

  const risks = buildRisks(
    metrics,
    metricDetails,
    manualSelectorDependency,
    analysisCoverage,
  );
  if (failed > 0 || skippedUnsafe > 0) {
    risks.unshift({
      id: "incomplete-application-coverage",
      severity: coverage.coveragePercent < 60 ? "high" : "medium",
      title: "Application discovery/audit coverage is incomplete",
      evidence: `${discovered} page(s) discovered, ${audited} audited, ${failed} failed to load/audit, ${skippedUnsafe} skipped as unsafe or cross-origin (${coverage.coveragePercent}% coverage). The score below reflects only the ${audited} audited page(s).`,
    });
  }
  if (evidenceState === "INACCESSIBLE") {
    risks.unshift({
      id: "evidence-inaccessible",
      severity: "high",
      title:
        "No interactive elements found across any audited page, and coverage is incomplete",
      evidence: `${audited} page(s) were audited and found no interactive elements, and at least one frame across those pages could not be inspected — a genuinely empty application cannot be honestly claimed here.`,
    });
  } else if (evidenceState === "NO_EVIDENCE") {
    risks.unshift({
      id: "evidence-none",
      severity: "medium",
      title: "No interactive elements were found on any audited page",
      evidence: `${audited} page(s) were fully inspected and genuinely contained no interactive elements analyzed by the pipeline.`,
    });
  } else if (evidenceState === "PARTIAL_EVIDENCE") {
    risks.unshift({
      id: "evidence-partial",
      severity: "medium",
      title: "Not every frame across the audited pages could be inspected",
      evidence: `${framesInspected} of ${framesDiscovered} frame(s) across audited pages responded. The score below reflects only what was actually inspected.`,
    });
  } else if (evidenceState === "INCOMPLETE_EVIDENCE") {
    risks.unshift({
      id: "evidence-incomplete-application-coverage",
      severity: "high",
      title:
        "Real per-element evidence exists, but application coverage is too incomplete to score honestly",
      evidence:
        (restorationFailures > 0
          ? `${restorationFailures} backtracking restoration(s) failed, so whatever application state lay beyond that point was never reached or audited. `
          : "") +
        (notDiscovered > 0
          ? `${notDiscovered} detected navigation candidate(s) were never explored (out of ${discovered} known). `
          : "") +
        `No score is reported — a numeric score here would misrepresent how much of this application was actually observed.`,
    });
  }
  if (notDiscovered > 0) {
    risks.push({
      id: "navigation-candidates-not-explored",
      severity: "low",
      title: "Some navigation controls were detected but never explored",
      evidence: `${notDiscovered} menu/tab/tree-style control(s) with no real <a href> were detected but not clicked (click-based discovery is off by default — see coverage.discoveryMethod). Enable it explicitly to explore them.`,
    });
  }

  const summary =
    audited === 0
      ? "No pages could be audited — see risks for why discovery/navigation failed."
      : score === null
        ? `Evidence was incomplete or empty across the ${audited} audited page(s) of ${discovered} discovered — see risks for detail. No score is reported rather than a fabricated one.`
        : `The application score is ${score}/100, aggregated from ${audited} of ${discovered} discovered page(s) (${coverage.coveragePercent}% coverage). ${automaticSelection.detail.directSuccess + automaticSelection.detail.recoveredByIgnore + automaticSelection.detail.recoveredByPartial + automaticSelection.detail.recoveredByContext} of ${totalAnalyzed} analyzed elements across those pages were resolved to the intended element by a simulated automatic strategy; an estimated ${manualSelectorDependency}% would likely require manual selector configuration.`;

  return {
    auditId,
    timestamp: Date.now(),
    scope,
    score,
    grade,
    confidence,
    evidenceState,
    frameAccessibility: applicationFrameAccessibility,
    coverage,
    analysisCoverage,
    manualSelectorDependency,
    metrics,
    metricDetails,
    summary,
    strengths: buildStrengths(metrics, metricDetails),
    risks,
    recommendations: buildRecommendations(metrics, metricDetails),
    pages,
    methodology: [...APPLICATION_METHODOLOGY_PREFIX, ...METHODOLOGY],
    stateGraph: options.stateGraph,
    traversal: options.traversal,
    restorations: options.restorations ?? [],
    crossStateEvidence,
    scopeLabel: scope === "application" ? "APPLICATION" : "CURRENT_PAGE",
    selectorConfiguration: DEFAULT_SELECTOR_CONFIGURATION,
  };
}
