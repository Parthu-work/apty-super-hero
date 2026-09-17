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
import type { AnalysisCoverage } from "@aipexstudio/dom-snapshot";
import {
  buildRecommendations,
  buildRisks,
  buildStrengths,
  type DomHealthAuditResult,
  type DomHealthConfidence,
  type DomHealthGrade,
  type DomHealthMetricDetails,
  type DomHealthMetricKey,
  type DomHealthMetrics,
  type DomHealthRecommendation,
  type DomHealthRisk,
  gradeForScore,
  METHODOLOGY,
  pct,
  scoreAccessibilitySignal,
  scoreAmbiguityRisk,
  scoreAutomaticSelection,
  scoreHitTestTargetability,
  scoreRecoveryEfficacy,
  scoreSelectorComplexity,
  scoreSelectorStability,
  WEIGHTS,
} from "./dom-health-scoring.js";

export type PageAuditStatus =
  | "completed"
  | "failed"
  | "skipped-unsafe"
  | "skipped-cross-origin"
  | "skipped-duplicate";

export type PageDiscoverySource = "seed" | "same-origin-link";

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
}

export interface ApplicationCoverage {
  pagesDiscovered: number;
  pagesAudited: number;
  pagesFailed: number;
  pagesSkippedUnsafe: number;
  pagesSkippedDuplicate: number;
  coveragePercent: number;
}

export interface ApplicationAuditResult {
  auditId: string;
  timestamp: number;
  /** "application" only when >=2 pages were actually audited — never a lie about coverage. */
  scope: "application" | "page";
  score: number;
  grade: DomHealthGrade;
  confidence: DomHealthConfidence;
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
): ApplicationAuditResult {
  const completed = pages.filter((p) => p.status === "completed" && p.result);
  const failed = pages.filter((p) => p.status === "failed").length;
  const skippedUnsafe = pages.filter(
    (p) => p.status === "skipped-unsafe" || p.status === "skipped-cross-origin",
  ).length;
  const skippedDuplicate = pages.filter(
    (p) => p.status === "skipped-duplicate",
  ).length;
  const discovered = pages.length;
  const audited = completed.length;

  const coverage: ApplicationCoverage = {
    pagesDiscovered: discovered,
    pagesAudited: audited,
    pagesFailed: failed,
    pagesSkippedUnsafe: skippedUnsafe,
    pagesSkippedDuplicate: skippedDuplicate,
    coveragePercent: discovered === 0 ? 0 : pct(audited, discovered),
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

  const selectorStability = scoreSelectorStability({
    trackedFromPrevious: sumField(
      completed,
      "selectorStability",
      "trackedFromPrevious",
    ),
    stable: sumField(completed, "selectorStability", "stable"),
    changed: sumField(completed, "selectorStability", "changed"),
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

  const rawScore = (Object.keys(WEIGHTS) as DomHealthMetricKey[]).reduce(
    (sum, key) => sum + metrics[key] * WEIGHTS[key],
    0,
  );
  const score = Math.round(Math.min(100, Math.max(0, rawScore)));
  const grade = gradeForScore(score);

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

  const confidence: DomHealthConfidence =
    audited >= 3 && coverage.coveragePercent >= 70 && totalAnalyzed >= 50
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

  const summary =
    audited === 0
      ? "No pages could be audited — see risks for why discovery/navigation failed."
      : `The application score is ${score}/100, aggregated from ${audited} of ${discovered} discovered page(s) (${coverage.coveragePercent}% coverage). ${automaticSelection.detail.directSuccess + automaticSelection.detail.recoveredByIgnore + automaticSelection.detail.recoveredByPartial + automaticSelection.detail.recoveredByContext} of ${totalAnalyzed} analyzed elements across those pages were resolved to the intended element by a simulated automatic strategy; an estimated ${manualSelectorDependency}% would likely require manual selector configuration.`;

  return {
    auditId,
    timestamp: Date.now(),
    scope,
    score,
    grade,
    confidence,
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
  };
}
