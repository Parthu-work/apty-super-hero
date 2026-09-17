/**
 * Apty DOM Readiness scoring engine.
 *
 * Pure and deterministic: given the DOM Health snapshot(s) collected for one
 * audit run (see `dom-health.ts`), computes the same score every time. Never
 * calls a browser API and never asks an LLM to judge anything — per the
 * product spec, "the LLM MUST NOT calculate the numeric score."
 *
 * Unlike the previous version of this module, it does NOT re-derive
 * selector quality from raw attribute presence/shape. All of that
 * measurement — candidate generation, live `querySelectorAll` uniqueness
 * and target-identity verification, ignore/partial/contextual recovery,
 * cross-snapshot stability, hit testing — already happened in-page inside
 * `@aipexstudio/dom-snapshot`'s collector (the only place that can touch
 * the live DOM). This module's only job is to aggregate and weight numbers
 * that are already real, verified evidence, and to explain the result from
 * that same evidence (spec sections 26-29): no invented measurements, no
 * "unique but wrong" or "ambiguous" candidate ever counted as a success.
 */
import type {
  AnalysisCoverage,
  DomHealthIframeInfo,
  DomHealthShadowDomInfo,
  DomHealthSnapshot,
  DomHealthZIndexInfo,
  ElementSelectorReport,
} from "@aipexstudio/dom-snapshot";

export type DomHealthMetricKey =
  | "automaticSelection"
  | "selectorStability"
  | "recoveryEfficacy"
  | "selectorComplexity"
  | "ambiguityRisk"
  | "hitTestTargetability"
  | "domVolatility"
  | "accessibilitySignal";

export type DomHealthMetrics = Record<DomHealthMetricKey, number>;

export type DomHealthGrade =
  | "EXCELLENT"
  | "GOOD"
  | "FAIR"
  | "NEEDS_ATTENTION"
  | "HIGH_RISK";

export type DomHealthConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface DomHealthMetricDetails {
  automaticSelection: {
    totalAnalyzed: number;
    directSuccess: number;
    recoveredByIgnore: number;
    recoveredByPartial: number;
    recoveredByContext: number;
  };
  selectorStability: {
    trackedFromPrevious: number;
    stable: number;
    changed: number;
    detached: number;
    new: number;
  };
  recoveryEfficacy: {
    neededRecovery: number;
    recovered: number;
  };
  selectorComplexity: {
    totalAnalyzed: number;
    deepTraversalCount: number;
    positionalCount: number;
  };
  ambiguityRisk: {
    totalAnalyzed: number;
    ambiguous: number;
    wrongTarget: number;
  };
  hitTestTargetability: {
    tested: number;
    fullyTargetable: number;
    partiallyTargetable: number;
    occludedOrHidden: number;
  };
  domVolatility: {
    maxRelativeElementCountDelta: number;
    snapshotsCompared: number;
  };
  accessibilitySignal: {
    totalInteractive: number;
    missingAccessibleName: number;
  };
}

export interface DomHealthRisk {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  evidence: string;
}

export interface DomHealthRecommendation {
  id: string;
  title: string;
  detail: string;
  /** The Apty Studio concept this recommendation relates to, when the evidence genuinely supports naming one — never guessed, and never a claim that Studio was consulted (this analyzer is standalone). */
  relatedStudioConcept?: string;
}

export interface DomHealthAuditResult {
  auditId: string;
  timestamp: number;
  url: string;
  pageTitle: string;
  score: number;
  grade: DomHealthGrade;
  confidence: DomHealthConfidence;
  /** Always "page" today — this orchestrator audits one page per run. Never labeled "application" without real multi-page coverage (spec section 54). */
  scope: "page";
  coverage: {
    snapshotsCompared: number;
    elementsAnalyzed: number;
    interactiveElementsInPage: number;
    /** Whether the runaway-safety element ceiling was hit on the current snapshot (spec section 6) — never silently absorbed into the score. */
    analysis: AnalysisCoverage;
  };
  /** % of analyzed elements that could not be reliably resolved by any simulated automatic strategy (positional-only, ambiguous, wrong-target, or unresolved). */
  manualSelectorDependency: number;
  metrics: DomHealthMetrics;
  metricDetails: DomHealthMetricDetails;
  summary: string;
  strengths: string[];
  risks: DomHealthRisk[];
  recommendations: DomHealthRecommendation[];
  /** Bounded, most-interesting-first sample for the element-level drill-down table (spec section 42) — not every analyzed element. */
  elementSamples: ElementSelectorReport[];
  methodology: string[];
  iframes: DomHealthIframeInfo;
  shadowDom: DomHealthShadowDomInfo;
  zIndex: DomHealthZIndexInfo;
  metadata: {
    elementsAnalyzed: number;
    interactiveElementsAnalyzed: number;
    iframeCount: number;
    shadowRootCount: number;
    snapshotsCompared: number;
  };
}

// ---------------------------------------------------------------------------
// Weights and grading
// ---------------------------------------------------------------------------

/** Sums to 1 — kept explicit per component so the score is reproducible and reviewable, not a black box (spec section 26). */
export const WEIGHTS: DomHealthMetrics = {
  automaticSelection: 0.35,
  selectorStability: 0.2,
  recoveryEfficacy: 0.1,
  selectorComplexity: 0.1,
  ambiguityRisk: 0.1,
  hitTestTargetability: 0.08,
  domVolatility: 0.05,
  accessibilitySignal: 0.02,
};

const GRADE_THRESHOLDS: Array<{ min: number; grade: DomHealthGrade }> = [
  { min: 90, grade: "EXCELLENT" },
  { min: 80, grade: "GOOD" },
  { min: 70, grade: "FAIR" },
  { min: 50, grade: "NEEDS_ATTENTION" },
  { min: 0, grade: "HIGH_RISK" },
];

export function gradeForScore(score: number): DomHealthGrade {
  for (const { min, grade } of GRADE_THRESHOLDS) {
    if (score >= min) return grade;
  }
  return "HIGH_RISK";
}

export function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 100;
  return Math.round((numerator / denominator) * 100);
}

// ---------------------------------------------------------------------------
// Individual metrics — every one reads only pre-verified evidence already
// present on the snapshot; none re-derives anything from raw attributes.
// ---------------------------------------------------------------------------

/**
 * Each `score*` kernel below takes only the plain aggregate counts it
 * needs (never a whole snapshot) so the exact same math can be reused for
 * a single page (`compute*`, fed from one snapshot) and for a real,
 * element-weighted application-level rollup (`application-scoring.ts`,
 * fed from raw counts SUMMED across every successfully-audited page) —
 * never a blind average of per-page percentages (spec section 26).
 */
export function scoreAutomaticSelection(agg: {
  totalAnalyzed: number;
  directSuccess: number;
  recoveredByIgnore: number;
  recoveredByPartial: number;
  recoveredByContext: number;
}) {
  const resolved =
    agg.directSuccess +
    agg.recoveredByIgnore +
    agg.recoveredByPartial +
    agg.recoveredByContext;
  return {
    score: pct(resolved, agg.totalAnalyzed),
    detail: {
      totalAnalyzed: agg.totalAnalyzed,
      directSuccess: agg.directSuccess,
      recoveredByIgnore: agg.recoveredByIgnore,
      recoveredByPartial: agg.recoveredByPartial,
      recoveredByContext: agg.recoveredByContext,
    },
  };
}

function computeAutomaticSelection(current: DomHealthSnapshot) {
  return scoreAutomaticSelection(current.selectorAnalysis);
}

export function scoreSelectorStability(agg: {
  trackedFromPrevious: number;
  stable: number;
  changed: number;
  detached: number;
  new: number;
}) {
  // No prior snapshot to compare against yet — genuinely unknown, not a
  // free pass. Scored neutrally (60) rather than 100, and confidence
  // reflects the missing evidence (see computeConfidence).
  if (agg.trackedFromPrevious === 0) {
    return { score: 60, detail: { ...agg } };
  }
  return {
    score: pct(agg.stable, agg.trackedFromPrevious),
    detail: { ...agg },
  };
}

function computeSelectorStability(current: DomHealthSnapshot) {
  const {
    trackedFromPrevious,
    stable,
    changed,
    detached,
    new: newCount,
  } = current.stability;
  return scoreSelectorStability({
    trackedFromPrevious,
    stable,
    changed,
    detached,
    new: newCount,
  });
}

export function scoreRecoveryEfficacy(agg: {
  totalAnalyzed: number;
  directSuccess: number;
  recoveredByIgnore: number;
  recoveredByPartial: number;
  recoveredByContext: number;
}) {
  const neededRecovery = agg.totalAnalyzed - agg.directSuccess;
  const recovered =
    agg.recoveredByIgnore + agg.recoveredByPartial + agg.recoveredByContext;
  return {
    score: pct(recovered, neededRecovery),
    detail: {
      neededRecovery: Math.max(0, neededRecovery),
      recovered,
    },
  };
}

function computeRecoveryEfficacy(current: DomHealthSnapshot) {
  return scoreRecoveryEfficacy(current.selectorAnalysis);
}

export function scoreSelectorComplexity(agg: {
  totalAnalyzed: number;
  deepTraversalCount: number;
  positionalCount: number;
}) {
  if (agg.totalAnalyzed === 0) {
    return { score: 100, detail: { ...agg } };
  }
  const penalty = Math.min(
    100,
    Math.round(
      ((agg.deepTraversalCount * 1.5 + agg.positionalCount) /
        agg.totalAnalyzed) *
        100,
    ),
  );
  return { score: 100 - penalty, detail: { ...agg } };
}

function computeSelectorComplexity(current: DomHealthSnapshot) {
  return scoreSelectorComplexity({
    totalAnalyzed: current.selectorAnalysis.totalAnalyzed,
    deepTraversalCount: current.ancestorTraversal.deepTraversalCount,
    positionalCount: current.positionalDependency.positionalCount,
  });
}

export function scoreAmbiguityRisk(agg: {
  totalAnalyzed: number;
  ambiguous: number;
  wrongTarget: number;
}) {
  if (agg.totalAnalyzed === 0) {
    return { score: 100, detail: { ...agg } };
  }
  // Wrong-target candidates are weighted more heavily than mere ambiguity —
  // spec section 31 treats "unique but wrong" as more severe than "not unique".
  const penalty = Math.min(
    100,
    Math.round(
      ((agg.ambiguous + agg.wrongTarget * 1.5) / agg.totalAnalyzed) * 100,
    ),
  );
  return { score: 100 - penalty, detail: { ...agg } };
}

function computeAmbiguityRisk(current: DomHealthSnapshot) {
  const { totalAnalyzed, ambiguous, wrongTarget } = current.selectorAnalysis;
  return scoreAmbiguityRisk({ totalAnalyzed, ambiguous, wrongTarget });
}

export function scoreHitTestTargetability(agg: {
  tested: number;
  fullyTargetable: number;
  partiallyTargetable: number;
}) {
  const occludedOrHidden =
    agg.tested - agg.fullyTargetable - agg.partiallyTargetable;
  return {
    score: pct(agg.fullyTargetable + agg.partiallyTargetable, agg.tested),
    detail: { ...agg, occludedOrHidden: Math.max(0, occludedOrHidden) },
  };
}

function computeHitTestTargetability(current: DomHealthSnapshot) {
  const { tested, fullyTargetable, partiallyTargetable } = current.hitTesting;
  return scoreHitTestTargetability({
    tested,
    fullyTargetable,
    partiallyTargetable,
  });
}

function computeDomVolatility(snapshots: DomHealthSnapshot[]) {
  let maxRelativeDelta = 0;
  for (let i = 1; i < snapshots.length; i++) {
    const prevTotal = snapshots[i - 1]!.counts.totalElements;
    const currTotal = snapshots[i]!.counts.totalElements;
    if (prevTotal === 0) continue;
    const relativeDelta = Math.abs(currTotal - prevTotal) / prevTotal;
    if (relativeDelta > maxRelativeDelta) maxRelativeDelta = relativeDelta;
  }
  const penalty = Math.min(100, Math.round(maxRelativeDelta * 100 * 1.5));
  return {
    score: 100 - penalty,
    detail: {
      maxRelativeElementCountDelta: Number(maxRelativeDelta.toFixed(3)),
      snapshotsCompared: snapshots.length,
    },
  };
}

export function scoreAccessibilitySignal(agg: {
  totalInteractive: number;
  missingAccessibleName: number;
}) {
  return {
    score: pct(
      agg.totalInteractive - agg.missingAccessibleName,
      agg.totalInteractive,
    ),
    detail: { ...agg },
  };
}

function computeAccessibilitySignal(current: DomHealthSnapshot) {
  return scoreAccessibilitySignal(current.accessibility);
}

// ---------------------------------------------------------------------------
// Confidence (spec section 32) — separate from the score itself.
// ---------------------------------------------------------------------------

function computeConfidence(
  current: DomHealthSnapshot,
  snapshotsCompared: number,
): DomHealthConfidence {
  const { totalAnalyzed } = current.selectorAnalysis;
  const universe = current.elementUniverse;
  const inaccessibleShare =
    universe.totalElements === 0
      ? 0
      : universe.inaccessibleElements / universe.totalElements;

  if (totalAnalyzed === 0) return "LOW";
  if (
    totalAnalyzed >= 30 &&
    snapshotsCompared >= 3 &&
    current.stability.trackedFromPrevious > 0 &&
    inaccessibleShare < 0.1
  ) {
    return "HIGH";
  }
  if (totalAnalyzed >= 10 && snapshotsCompared >= 2) return "MEDIUM";
  return "LOW";
}

// ---------------------------------------------------------------------------
// Manual selector dependency (spec section 30)
// ---------------------------------------------------------------------------

export function computeManualSelectorDependency(
  current: DomHealthSnapshot,
): number {
  const { totalAnalyzed, positionalOnly, ambiguous, wrongTarget, notResolved } =
    current.selectorAnalysis;
  return pct(
    positionalOnly + ambiguous + wrongTarget + notResolved,
    totalAnalyzed,
  );
}

// ---------------------------------------------------------------------------
// Strengths, risks, recommendations — every claim maps to a real number.
// ---------------------------------------------------------------------------

export function buildStrengths(
  metrics: DomHealthMetrics,
  details: DomHealthMetricDetails,
): string[] {
  const strengths: string[] = [];
  const { automaticSelection, hitTestTargetability } = details;

  if (
    metrics.automaticSelection >= 80 &&
    automaticSelection.totalAnalyzed > 0
  ) {
    strengths.push(
      `${metrics.automaticSelection}% of analyzed elements (${automaticSelection.directSuccess + automaticSelection.recoveredByIgnore + automaticSelection.recoveredByPartial + automaticSelection.recoveredByContext}/${automaticSelection.totalAnalyzed}) can be resolved to a unique, correct element automatically.`,
    );
  }
  if (
    metrics.selectorStability >= 80 &&
    details.selectorStability.trackedFromPrevious > 0
  ) {
    strengths.push(
      `${metrics.selectorStability}% of tracked selectors (${details.selectorStability.stable}/${details.selectorStability.trackedFromPrevious}) remained stable across snapshots.`,
    );
  }
  if (metrics.hitTestTargetability >= 85 && hitTestTargetability.tested > 0) {
    strengths.push(
      `${metrics.hitTestTargetability}% of visible interactive elements (${hitTestTargetability.fullyTargetable + hitTestTargetability.partiallyTargetable}/${hitTestTargetability.tested}) passed hit testing.`,
    );
  }
  if (metrics.ambiguityRisk >= 90 && details.ambiguityRisk.totalAnalyzed > 0) {
    strengths.push("Selector ambiguity and wrong-target risk are both low.");
  }
  return strengths;
}

export function buildRisks(
  metrics: DomHealthMetrics,
  details: DomHealthMetricDetails,
  manualSelectorDependency: number,
  analysisCoverage: AnalysisCoverage,
): DomHealthRisk[] {
  const risks: DomHealthRisk[] = [];

  if (analysisCoverage.capped) {
    risks.push({
      id: "analysis-coverage-capped",
      severity: "medium",
      title: "Not every interactive element on this page was analyzed",
      evidence:
        analysisCoverage.capReason ??
        `${analysisCoverage.candidatesAnalyzed} of ${analysisCoverage.candidatesFound} interactive elements were analyzed.`,
    });
  }

  if (metrics.automaticSelection < 70) {
    const unresolved =
      details.automaticSelection.totalAnalyzed -
      (details.automaticSelection.directSuccess +
        details.automaticSelection.recoveredByIgnore +
        details.automaticSelection.recoveredByPartial +
        details.automaticSelection.recoveredByContext);
    risks.push({
      id: "low-automatic-selection",
      severity: metrics.automaticSelection < 50 ? "high" : "medium",
      title: "Many elements cannot be automatically resolved",
      evidence: `${unresolved} of ${details.automaticSelection.totalAnalyzed} analyzed elements could not be resolved to a unique, correct element by any simulated automatic strategy.`,
    });
  }

  if (
    metrics.selectorStability < 70 &&
    details.selectorStability.trackedFromPrevious > 0
  ) {
    risks.push({
      id: "selector-volatility",
      severity: metrics.selectorStability < 50 ? "high" : "medium",
      title: "Selector volatility detected across snapshots",
      evidence: `${details.selectorStability.changed} of ${details.selectorStability.trackedFromPrevious} previously-resolved selectors broke or stopped pointing at the same element when re-verified; ${details.selectorStability.detached} elements were no longer present.`,
    });
  }

  if (metrics.ambiguityRisk < 85 && details.ambiguityRisk.totalAnalyzed > 0) {
    risks.push({
      id: "ambiguous-or-wrong-target",
      severity: details.ambiguityRisk.wrongTarget > 0 ? "high" : "medium",
      title: "Ambiguous or wrong-target selector candidates found",
      evidence: `${details.ambiguityRisk.ambiguous} element(s) only produced candidates matching multiple elements, and ${details.ambiguityRisk.wrongTarget} produced a candidate that uniquely resolved to the wrong element.`,
    });
  }

  if (metrics.selectorComplexity < 70) {
    risks.push({
      id: "selector-complexity",
      severity: metrics.selectorComplexity < 50 ? "medium" : "low",
      title: "Significant reliance on deep ancestor traversal or position",
      evidence: `${details.selectorComplexity.deepTraversalCount} element(s) required climbing 2+ ancestor levels, and ${details.selectorComplexity.positionalCount} could only be resolved with a positional (nth-of-type) selector.`,
    });
  }

  if (
    metrics.hitTestTargetability < 85 &&
    details.hitTestTargetability.tested > 0
  ) {
    risks.push({
      id: "hit-test-failures",
      severity: metrics.hitTestTargetability < 60 ? "high" : "medium",
      title: "Some interactive elements fail hit testing",
      evidence: `${details.hitTestTargetability.occludedOrHidden} of ${details.hitTestTargetability.tested} tested elements were occluded, hidden, zero-size, or outside the viewport at the sampled points.`,
    });
  }

  if (metrics.domVolatility < 70) {
    risks.push({
      id: "dom-volatility",
      severity: metrics.domVolatility < 40 ? "high" : "medium",
      title: "High structural DOM volatility",
      evidence: `Total element count changed by up to ${Math.round(details.domVolatility.maxRelativeElementCountDelta * 100)}% between consecutive snapshots.`,
    });
  }

  if (manualSelectorDependency > 15) {
    risks.push({
      id: "manual-selector-dependency",
      severity: manualSelectorDependency > 30 ? "high" : "medium",
      title: "Meaningful manual selector dependency",
      evidence: `${manualSelectorDependency}% of analyzed elements were not reliably resolved by any simulated automatic strategy and would likely need manual CSS/XPath configuration.`,
    });
  }

  return risks;
}

export function buildRecommendations(
  metrics: DomHealthMetrics,
  details: DomHealthMetricDetails,
): DomHealthRecommendation[] {
  const recommendations: DomHealthRecommendation[] = [];

  if (metrics.automaticSelection < 80) {
    recommendations.push({
      id: "attribute-priority",
      title:
        "Introduce stable, application-specific attributes on frequently targeted controls",
      detail: `${details.automaticSelection.totalAnalyzed - details.automaticSelection.directSuccess} of ${details.automaticSelection.totalAnalyzed} analyzed elements needed a recovery strategy or failed to resolve. Adding a stable data attribute (e.g. a test id) to the elements users actually interact with removes the need for ignore/partial/contextual recovery.`,
      relatedStudioConcept: "Attribute Priority",
    });
  }

  if (details.selectorStability.changed > 0) {
    recommendations.push({
      id: "reduce-generated-id-reliance",
      title: "Reduce reliance on generated ids/classes",
      detail: `${details.selectorStability.changed} previously-working selector(s) broke across snapshots. Prefer stable semantic or application-specific attributes over framework-generated ids/classes for elements users are guided to.`,
      relatedStudioConcept: "Ignore Selector",
    });
  }

  if (details.selectorComplexity.positionalCount > 0) {
    recommendations.push({
      id: "reduce-positional-dependency",
      title: "Reduce positional selector dependency",
      detail: `${details.selectorComplexity.positionalCount} element(s) could only be targeted by DOM position (nth-of-type). Review these repeated controls for an attribute that could distinguish them directly.`,
      relatedStudioConcept: "Partial Selector",
    });
  }

  if (details.hitTestTargetability.occludedOrHidden > 0) {
    recommendations.push({
      id: "investigate-hit-test-failures",
      title: "Investigate elements failing hit testing",
      detail: `${details.hitTestTargetability.occludedOrHidden} interactive element(s) were occluded, hidden, or outside the viewport during testing. Even a uniquely-resolvable element is not usable if nothing can click it.`,
    });
  }

  if (details.accessibilitySignal.missingAccessibleName > 0) {
    recommendations.push({
      id: "improve-accessible-names",
      title: "Add accessible names to interactive controls",
      detail: `${details.accessibilitySignal.missingAccessibleName} of ${details.accessibilitySignal.totalInteractive} interactive elements lack an accessible name. Beyond accessibility, a stable label/aria-label is also a reliable targeting signal.`,
    });
  }

  return recommendations;
}

// ---------------------------------------------------------------------------
// Evidence-driven summary (spec section 28) — every sentence maps to a real number.
// ---------------------------------------------------------------------------

export function buildSummary(
  score: number,
  metrics: DomHealthMetrics,
  details: DomHealthMetricDetails,
  manualSelectorDependency: number,
): string {
  const total = details.automaticSelection.totalAnalyzed;
  if (total === 0) {
    return "No interactive elements were found to analyze on this page.";
  }
  const resolved =
    details.automaticSelection.directSuccess +
    details.automaticSelection.recoveredByIgnore +
    details.automaticSelection.recoveredByPartial +
    details.automaticSelection.recoveredByContext;

  const clauses: string[] = [
    `${resolved} of ${total} analyzed elements were resolved to the intended element by a simulated automatic strategy`,
  ];
  if (details.selectorStability.trackedFromPrevious > 0) {
    clauses.push(
      `${metrics.selectorStability}% of tracked selectors stayed stable across snapshots`,
    );
  }
  if (details.ambiguityRisk.ambiguous + details.ambiguityRisk.wrongTarget > 0) {
    clauses.push(
      `${details.ambiguityRisk.ambiguous} produced ambiguous candidates and ${details.ambiguityRisk.wrongTarget} produced a wrong-target candidate`,
    );
  }
  if (manualSelectorDependency > 0) {
    clauses.push(
      `an estimated ${manualSelectorDependency}% would likely require manual selector configuration`,
    );
  }

  return `The score is ${score}/100 because ${clauses.join("; ")}.`;
}

export const METHODOLOGY: string[] = [
  "Collect a DOM snapshot in-page, classifying every element into an interactive/structural/decorative/hidden/inaccessible/iframe/shadow-DOM population.",
  "For each analyzed interactive element, generate ranked candidate selectors (id, stable data attributes, aria-label, name, class, semantic attributes).",
  "Test every candidate live with querySelectorAll: verify it resolves to exactly one element, and that the element is the intended target.",
  "If no single stable attribute is unique, simulate an ignore-selector strategy by combining multiple stable attributes together.",
  "If the identifying attribute looks dynamically generated, extract a stable substring and simulate a partial-selector strategy.",
  "If the element still cannot be resolved, climb ancestors looking for a stable identifying context, then fall back to a positional (nth-of-type) path as a last resort.",
  "Re-verify each previously-chosen selector against the live DOM on every subsequent snapshot to measure real, identity-based stability — never paired by array position.",
  "Run a 9-point hit test (25/50/75% of width and height) against each element to measure real visual targetability, separate from selector correctness.",
  "Aggregate iframe/Shadow DOM accessibility and DOM structural volatility across snapshots.",
  "Weight the verified aggregates (never raw attribute counts) into a single reproducible score, and derive a confidence level from sample size, snapshot count, and DOM accessibility coverage.",
];

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Build the DOM Health audit result from every snapshot taken during one
 * audit run (2-3 snapshots — see `dom-health.ts`), in chronological order.
 * The last snapshot's per-element evidence already reflects the full
 * cross-snapshot history (stability, dynamic-attribute observation) via the
 * collector's internal element registry; earlier snapshots are only used
 * here for the coarse structural DOM-volatility signal.
 */
export function buildDomHealthAuditResult(
  snapshots: DomHealthSnapshot[],
  auditId: string,
): DomHealthAuditResult {
  if (snapshots.length === 0) {
    throw new Error("buildDomHealthAuditResult requires at least one snapshot");
  }
  const current = snapshots[snapshots.length - 1]!;

  const automaticSelection = computeAutomaticSelection(current);
  const selectorStability = computeSelectorStability(current);
  const recoveryEfficacy = computeRecoveryEfficacy(current);
  const selectorComplexity = computeSelectorComplexity(current);
  const ambiguityRisk = computeAmbiguityRisk(current);
  const hitTestTargetability = computeHitTestTargetability(current);
  const domVolatility = computeDomVolatility(snapshots);
  const accessibilitySignal = computeAccessibilitySignal(current);

  const metrics: DomHealthMetrics = {
    automaticSelection: automaticSelection.score,
    selectorStability: selectorStability.score,
    recoveryEfficacy: recoveryEfficacy.score,
    selectorComplexity: selectorComplexity.score,
    ambiguityRisk: ambiguityRisk.score,
    hitTestTargetability: hitTestTargetability.score,
    domVolatility: domVolatility.score,
    accessibilitySignal: accessibilitySignal.score,
  };

  const rawScore = (Object.keys(WEIGHTS) as DomHealthMetricKey[]).reduce(
    (sum, key) => sum + metrics[key] * WEIGHTS[key],
    0,
  );
  const score = Math.round(Math.min(100, Math.max(0, rawScore)));
  const grade = gradeForScore(score);
  const confidence = computeConfidence(current, snapshots.length);
  const manualSelectorDependency = computeManualSelectorDependency(current);

  const metricDetails: DomHealthMetricDetails = {
    automaticSelection: automaticSelection.detail,
    selectorStability: selectorStability.detail,
    recoveryEfficacy: recoveryEfficacy.detail,
    selectorComplexity: selectorComplexity.detail,
    ambiguityRisk: ambiguityRisk.detail,
    hitTestTargetability: hitTestTargetability.detail,
    domVolatility: domVolatility.detail,
    accessibilitySignal: accessibilitySignal.detail,
  };

  // Most-interesting-first sample for the drill-down table: anything that
  // didn't succeed directly comes first, direct successes fill the rest.
  const nonDirect = current.elementReports.filter(
    (r) => r.outcome !== "DIRECT_SUCCESS",
  );
  const direct = current.elementReports.filter(
    (r) => r.outcome === "DIRECT_SUCCESS",
  );
  const elementSamples = [...nonDirect, ...direct].slice(0, 25);

  return {
    auditId,
    timestamp: current.collectedAt,
    url: current.url,
    pageTitle: current.title,
    score,
    grade,
    confidence,
    scope: "page",
    coverage: {
      snapshotsCompared: snapshots.length,
      elementsAnalyzed: current.selectorAnalysis.totalAnalyzed,
      interactiveElementsInPage: current.counts.interactiveElements,
      analysis: current.analysisCoverage,
    },
    manualSelectorDependency,
    metrics,
    metricDetails,
    summary: buildSummary(
      score,
      metrics,
      metricDetails,
      manualSelectorDependency,
    ),
    strengths: buildStrengths(metrics, metricDetails),
    risks: buildRisks(
      metrics,
      metricDetails,
      manualSelectorDependency,
      current.analysisCoverage,
    ),
    recommendations: buildRecommendations(metrics, metricDetails),
    elementSamples,
    methodology: METHODOLOGY,
    iframes: current.iframes,
    shadowDom: current.shadowDom,
    zIndex: current.zIndex,
    metadata: {
      elementsAnalyzed: current.counts.totalElements,
      interactiveElementsAnalyzed: current.counts.interactiveElements,
      iframeCount: current.iframes.total,
      shadowRootCount: current.shadowDom.roots,
      snapshotsCompared: snapshots.length,
    },
  };
}
