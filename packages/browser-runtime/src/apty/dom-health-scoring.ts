/**
 * Apty DOM Readiness scoring engine.
 *
 * Pure and deterministic: given two DOM Health snapshots of the same page
 * (taken moments apart — see `dom-health.ts`), computes the same score every
 * time. Never calls a browser API and never asks an LLM to judge anything —
 * per the product spec, "the LLM MUST NOT calculate the numeric score."
 *
 * Reuses `looksDynamic()` from `../automation/selector-analysis.js` (the
 * same heuristic `analyze_element_selectors` uses for a single element) so
 * "does this id/class look machine-generated" has one definition across the
 * codebase, not two that could quietly drift apart.
 */
import type {
  DomHealthElement,
  DomHealthElementAttributes,
  DomHealthIframeInfo,
  DomHealthShadowDomInfo,
  DomHealthSnapshot,
  DomHealthZIndexInfo,
} from "@aipexstudio/dom-snapshot";
import { looksDynamic } from "../automation/selector-analysis.js";

export type DomHealthMetricKey =
  | "selectorQuality"
  | "selectorStability"
  | "attributeQuality"
  | "domStability"
  | "iframeAccessibility"
  | "shadowDomAccessibility"
  | "domComplexity"
  | "overlayRisk";

export type DomHealthMetrics = Record<DomHealthMetricKey, number>;

export type DomHealthGrade =
  | "EXCELLENT"
  | "GOOD"
  | "FAIR"
  | "NEEDS_ATTENTION"
  | "HIGH_RISK";

/** A per-element classification of how reliable its best available selector signal is. */
type AttributeSignalTier = "strong" | "medium" | "risky" | "very-risky";

export interface SelectorQualityDetail {
  totalAnalyzed: number;
  strongCount: number;
  mediumCount: number;
  riskyCount: number;
  veryRiskyCount: number;
}

export interface SelectorStabilityDetail {
  comparedCount: number;
  stableCount: number;
  unstableCount: number;
  /** Pairs that couldn't be compared — tag changed, or neither snapshot had any identifying attribute to compare. */
  unmatchedCount: number;
}

export interface DomStabilityDetail {
  elementCountDelta: number;
  attributeChanges: number;
  pairedElements: number;
}

export interface AttributeQualityDetail {
  totalAnalyzed: number;
  withSignalCount: number;
}

export interface DomHealthMetricDetails {
  selectorQuality: SelectorQualityDetail;
  selectorStability: SelectorStabilityDetail;
  attributeQuality: AttributeQualityDetail;
  domStability: DomStabilityDetail;
  iframeAccessibility: DomHealthIframeInfo;
  shadowDomAccessibility: { roots: number; elementShare: number };
  domComplexity: {
    totalElements: number;
    iframeCount: number;
    shadowRootCount: number;
  };
  overlayRisk: DomHealthZIndexInfo;
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
  /** The Apty Studio concept this recommendation relates to, when the evidence genuinely supports naming one — never guessed. */
  relatedStudioConcept?: string;
}

export interface DomHealthAuditResult {
  auditId: string;
  timestamp: number;
  url: string;
  pageTitle: string;
  score: number;
  grade: DomHealthGrade;
  metrics: DomHealthMetrics;
  metricDetails: DomHealthMetricDetails;
  summary: string;
  risks: DomHealthRisk[];
  recommendations: DomHealthRecommendation[];
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

const WEIGHTS: DomHealthMetrics = {
  selectorQuality: 0.3,
  selectorStability: 0.25,
  domStability: 0.15,
  attributeQuality: 0.1,
  iframeAccessibility: 0.05,
  shadowDomAccessibility: 0.05,
  domComplexity: 0.05,
  overlayRisk: 0.05,
};

const GRADE_THRESHOLDS: Array<{ min: number; grade: DomHealthGrade }> = [
  { min: 90, grade: "EXCELLENT" },
  { min: 80, grade: "GOOD" },
  { min: 70, grade: "FAIR" },
  { min: 50, grade: "NEEDS_ATTENTION" },
  { min: 0, grade: "HIGH_RISK" },
];

function gradeForScore(score: number): DomHealthGrade {
  for (const { min, grade } of GRADE_THRESHOLDS) {
    if (score >= min) return grade;
  }
  return "HIGH_RISK";
}

// ---------------------------------------------------------------------------
// Attribute signal classification (shared by selectorQuality/Stability/attributeQuality)
// ---------------------------------------------------------------------------

const TEST_ID_KEYS = new Set([
  "testid",
  "test-id",
  "automation-id",
  "automationid",
]);

function classifySignal(
  attrs: DomHealthElementAttributes,
): AttributeSignalTier {
  const dataEntries = Object.entries(attrs.dataAttributes ?? {});

  const hasStableTestId = dataEntries.some(
    ([key, value]) =>
      (TEST_ID_KEYS.has(key) || key.startsWith("apty")) &&
      Boolean(value) &&
      !looksDynamic(value),
  );
  if (hasStableTestId) return "strong";
  if (attrs.id && !looksDynamic(attrs.id)) return "strong";
  if (dataEntries.some(([, value]) => Boolean(value) && !looksDynamic(value))) {
    return "strong";
  }
  if (attrs.ariaLabel || attrs.ariaLabelledby) return "strong";

  const classes = (attrs.className ?? "").split(/\s+/).filter(Boolean);
  const stableClasses = classes.filter((c) => !looksDynamic(c));
  if (stableClasses.length > 0) return "medium";
  if (attrs.name || attrs.role) return "medium";

  const hasAnySignal =
    Boolean(attrs.id) || classes.length > 0 || dataEntries.length > 0;
  // No attribute at all means the only remaining option is a structural/
  // position-dependent selector — the worst case, distinct from "has a
  // signal but it looks generated" (risky).
  return hasAnySignal ? "risky" : "very-risky";
}

const SIGNAL_SCORE: Record<AttributeSignalTier, number> = {
  strong: 100,
  medium: 70,
  risky: 35,
  "very-risky": 0,
};

/** The single attribute most likely to have been used to select this element, for cross-snapshot comparison. Same priority order as `classifySignal`. */
function bestIdentifyingAttribute(
  attrs: DomHealthElementAttributes,
): { name: string; value: string } | null {
  const dataEntries = Object.entries(attrs.dataAttributes ?? {});
  const testId = dataEntries.find(
    ([key, value]) =>
      (TEST_ID_KEYS.has(key) || key.startsWith("apty")) && value,
  );
  if (testId) return { name: `data-${testId[0]}`, value: testId[1] };
  if (attrs.id) return { name: "id", value: attrs.id };
  const otherData = dataEntries.find(([, value]) => Boolean(value));
  if (otherData) return { name: `data-${otherData[0]}`, value: otherData[1] };
  if (attrs.ariaLabel) return { name: "aria-label", value: attrs.ariaLabel };
  if (attrs.name) return { name: "name", value: attrs.name };
  if (attrs.className) return { name: "class", value: attrs.className };
  return null;
}

/** Presence-only signature (attribute names, not values) — used for domStability's "did the markup shape change" check, distinct from selectorStability's "did the value change" check, to avoid double-counting the same signal. */
function attributeShapeSignature(attrs: DomHealthElementAttributes): string {
  return [
    attrs.id ? "id" : "",
    attrs.name ? "name" : "",
    attrs.role ? "role" : "",
    attrs.ariaLabel || attrs.ariaLabelledby ? "aria" : "",
    Object.keys(attrs.dataAttributes ?? {})
      .sort()
      .join(","),
  ].join("|");
}

// ---------------------------------------------------------------------------
// Individual metrics
// ---------------------------------------------------------------------------

function computeSelectorQuality(elements: DomHealthElement[]): {
  score: number;
  detail: SelectorQualityDetail;
} {
  if (elements.length === 0) {
    return {
      score: 100,
      detail: {
        totalAnalyzed: 0,
        strongCount: 0,
        mediumCount: 0,
        riskyCount: 0,
        veryRiskyCount: 0,
      },
    };
  }
  let strong = 0;
  let medium = 0;
  let risky = 0;
  let veryRisky = 0;
  let sum = 0;
  for (const el of elements) {
    const tier = classifySignal(el.attributes);
    sum += SIGNAL_SCORE[tier];
    if (tier === "strong") strong++;
    else if (tier === "medium") medium++;
    else if (tier === "risky") risky++;
    else veryRisky++;
  }
  return {
    score: Math.round(sum / elements.length),
    detail: {
      totalAnalyzed: elements.length,
      strongCount: strong,
      mediumCount: medium,
      riskyCount: risky,
      veryRiskyCount: veryRisky,
    },
  };
}

function computeAttributeQuality(elements: DomHealthElement[]): {
  score: number;
  detail: AttributeQualityDetail;
} {
  if (elements.length === 0) {
    return { score: 100, detail: { totalAnalyzed: 0, withSignalCount: 0 } };
  }
  let withSignal = 0;
  for (const el of elements) {
    const a = el.attributes;
    const hasAny =
      Boolean(a.id) ||
      Boolean(a.name) ||
      Boolean(a.role) ||
      Boolean(a.ariaLabel) ||
      Boolean(a.ariaLabelledby) ||
      Boolean(a.className?.trim()) ||
      Object.keys(a.dataAttributes ?? {}).length > 0;
    if (hasAny) withSignal++;
  }
  return {
    score: Math.round((withSignal / elements.length) * 100),
    detail: { totalAnalyzed: elements.length, withSignalCount: withSignal },
  };
}

/** Pairs elements by array index (both snapshots traverse the DOM in the same order moments apart) and checks whether each pair's best identifying attribute kept the same value. */
function computeSelectorStability(
  before: DomHealthElement[],
  after: DomHealthElement[],
): { score: number; detail: SelectorStabilityDetail } {
  const len = Math.min(before.length, after.length);
  let compared = 0;
  let stable = 0;
  let unstable = 0;
  let unmatched = 0;

  for (let i = 0; i < len; i++) {
    const a = before[i];
    const b = after[i];
    if (!a || !b || a.tagName !== b.tagName) {
      unmatched++;
      continue;
    }
    const sigA = bestIdentifyingAttribute(a.attributes);
    const sigB = bestIdentifyingAttribute(b.attributes);
    if (!sigA || !sigB) {
      unmatched++;
      continue;
    }
    compared++;
    if (sigA.name === sigB.name && sigA.value === sigB.value) {
      stable++;
    } else {
      unstable++;
    }
  }

  const score = compared === 0 ? 100 : Math.round((stable / compared) * 100);
  return {
    score,
    detail: {
      comparedCount: compared,
      stableCount: stable,
      unstableCount: unstable,
      unmatchedCount: unmatched,
    },
  };
}

function computeDomStability(
  before: DomHealthSnapshot,
  after: DomHealthSnapshot,
): { score: number; detail: DomStabilityDetail } {
  const totalBefore = before.counts.totalElements;
  const totalAfter = after.counts.totalElements;
  const elementCountDelta = Math.abs(totalAfter - totalBefore);
  const relativeElementDelta =
    totalBefore === 0 ? 0 : elementCountDelta / totalBefore;

  const len = Math.min(
    before.interactiveElements.length,
    after.interactiveElements.length,
  );
  let paired = 0;
  let attributeChanges = 0;
  for (let i = 0; i < len; i++) {
    const a = before.interactiveElements[i];
    const b = after.interactiveElements[i];
    if (!a || !b || a.tagName !== b.tagName) continue;
    paired++;
    if (
      attributeShapeSignature(a.attributes) !==
      attributeShapeSignature(b.attributes)
    ) {
      attributeChanges++;
    }
  }
  const attributeChurn = paired === 0 ? 0 : attributeChanges / paired;

  // Blend structural delta and attribute churn; scaled so ordinary,
  // harmless dynamism (a handful of elements changing) doesn't crater the
  // score the way selector-breaking churn should.
  const penalty = Math.min(
    100,
    relativeElementDelta * 100 * 0.6 + attributeChurn * 100 * 0.4,
  );
  const score = Math.max(0, Math.round(100 - penalty));
  return {
    score,
    detail: { elementCountDelta, attributeChanges, pairedElements: paired },
  };
}

function computeIframeAccessibility(iframes: DomHealthIframeInfo): {
  score: number;
  detail: DomHealthIframeInfo;
} {
  if (iframes.total === 0) {
    return { score: 100, detail: iframes };
  }
  // Cross-origin iframes are a browser security boundary, not a DOM defect
  // (see health-collector.ts) — count them as half credit rather than a
  // full penalty, per the product spec's explicit instruction not to treat
  // this boundary as unhealthy.
  const effective = iframes.accessible + iframes.crossOrigin * 0.5;
  return {
    score: Math.round((effective / iframes.total) * 100),
    detail: iframes,
  };
}

function computeShadowDomAccessibility(
  shadowDom: DomHealthShadowDomInfo,
  totalElements: number,
): { score: number; detail: { roots: number; elementShare: number } } {
  if (shadowDom.roots === 0) {
    return { score: 100, detail: { roots: 0, elementShare: 0 } };
  }
  const share = totalElements === 0 ? 0 : shadowDom.elements / totalElements;
  // Complexity signal, not a defect — capped so heavy (but legitimate)
  // Shadow DOM usage never craters the score on its own.
  const penalty = Math.min(30, Math.round(share * 60));
  return {
    score: 100 - penalty,
    detail: { roots: shadowDom.roots, elementShare: Number(share.toFixed(3)) },
  };
}

function computeDomComplexity(
  counts: DomHealthSnapshot["counts"],
  iframes: DomHealthIframeInfo,
  shadowDom: DomHealthShadowDomInfo,
): {
  score: number;
  detail: {
    totalElements: number;
    iframeCount: number;
    shadowRootCount: number;
  };
} {
  const total = counts.totalElements;
  // Soft, log-scaled beyond a generous threshold so a large-but-normal
  // enterprise DOM (thousands of nodes) isn't penalized for size alone —
  // only genuinely extreme sizes pull this down, and only by a little
  // (domComplexity is a 5%-weight metric).
  let sizeScore = 100;
  if (total > 1500) {
    const excess = total - 1500;
    sizeScore = Math.max(50, 100 - Math.round(Math.log10(excess + 10) * 12));
  }
  const structurePenalty = Math.min(
    20,
    iframes.total * 2 + shadowDom.roots * 2,
  );
  const score = Math.max(30, Math.round(sizeScore - structurePenalty));
  return {
    score,
    detail: {
      totalElements: total,
      iframeCount: iframes.total,
      shadowRootCount: shadowDom.roots,
    },
  };
}

function computeOverlayRisk(zIndex: DomHealthZIndexInfo): {
  score: number;
  detail: DomHealthZIndexInfo;
} {
  if (zIndex.maxZIndex === 0 && zIndex.highZIndexElementCount === 0) {
    return { score: 100, detail: zIndex };
  }
  // A single element with a very high z-index (a tooltip/launcher/widget)
  // is common and not a defect — only many elements competing at a high
  // z-index suggests a real overlay conflict, and even then the penalty is
  // capped rather than treated as a guaranteed failure.
  let score = 100;
  if (zIndex.highZIndexElementCount > 1) {
    score -= Math.min(40, zIndex.highZIndexElementCount * 8);
  }
  if (zIndex.maxZIndex >= 999999) {
    score -= 15;
  }
  return { score: Math.max(50, Math.round(score)), detail: zIndex };
}

// ---------------------------------------------------------------------------
// Risks and recommendations
// ---------------------------------------------------------------------------

function buildRisks(
  metrics: DomHealthMetrics,
  details: DomHealthMetricDetails,
): DomHealthRisk[] {
  const risks: DomHealthRisk[] = [];

  if (metrics.selectorQuality < 60) {
    const unreliable =
      details.selectorQuality.riskyCount +
      details.selectorQuality.veryRiskyCount;
    risks.push({
      id: "generated-selectors",
      severity: metrics.selectorQuality < 40 ? "high" : "medium",
      title: "Many interactive elements rely on generated identifiers",
      evidence: `${unreliable} of ${details.selectorQuality.totalAnalyzed} interactive elements have no stable selector signal (a dynamic-looking id/class, or no identifying attribute at all).`,
    });
  }

  if (
    metrics.selectorStability < 70 &&
    details.selectorStability.comparedCount > 0
  ) {
    risks.push({
      id: "selector-volatility",
      severity: metrics.selectorStability < 50 ? "high" : "medium",
      title: "Selector volatility detected between snapshots",
      evidence: `${details.selectorStability.unstableCount} of ${details.selectorStability.comparedCount} compared elements' identifying attribute changed value between the two snapshots taken moments apart.`,
    });
  }

  if (metrics.domStability < 60) {
    risks.push({
      id: "dom-mutation",
      severity: metrics.domStability < 40 ? "high" : "medium",
      title: "High DOM mutation rate",
      evidence: `Element count changed by ${details.domStability.elementCountDelta}, and ${details.domStability.attributeChanges} of ${details.domStability.pairedElements} paired elements changed their attribute set between snapshots.`,
    });
  }

  if (details.iframeAccessibility.crossOrigin > 0) {
    risks.push({
      id: "cross-origin-iframes",
      severity: "low",
      title: `${details.iframeAccessibility.crossOrigin} cross-origin iframe(s) detected`,
      evidence:
        "These iframes cannot be inspected due to the browser's same-origin security boundary — a visibility limitation, not a DOM defect.",
    });
  }

  if (metrics.overlayRisk < 80) {
    risks.push({
      id: "overlay-risk",
      severity: metrics.overlayRisk < 65 ? "medium" : "low",
      title: "Potential overlay/z-index conflict",
      evidence: `${details.overlayRisk.highZIndexElementCount} positioned element(s) at z-index ≥ 1000 (highest observed: ${details.overlayRisk.maxZIndex}).`,
    });
  }

  return risks;
}

function buildRecommendations(
  metrics: DomHealthMetrics,
  details: DomHealthMetricDetails,
): DomHealthRecommendation[] {
  const recommendations: DomHealthRecommendation[] = [];

  if (
    metrics.selectorQuality < 70 &&
    details.selectorQuality.riskyCount +
      details.selectorQuality.veryRiskyCount >
      0
  ) {
    recommendations.push({
      id: "attribute-priority",
      title: "Review Attribute Priority for generated identifiers",
      detail:
        "Several interactive elements only expose dynamic-looking ids/classes. Adjusting Attribute Priority (and Ignore Selector for known-generated attributes) in Apty Studio can steer selector generation away from these unstable values.",
      relatedStudioConcept: "Attribute Priority",
    });
  }

  if (metrics.selectorQuality < 85 && details.selectorQuality.mediumCount > 0) {
    recommendations.push({
      id: "partial-selector",
      title: "Consider Partial Selector for partially stable attributes",
      detail:
        "Some elements have a stable class or attribute but nothing fully unique. Apty Studio's Partial Selector option can combine a stable fragment with structural context instead of relying on a single unstable value.",
      relatedStudioConcept: "Partial Selector",
    });
  }

  if (metrics.domStability < 70) {
    recommendations.push({
      id: "dom-change-debounce",
      title: "Review DOM Change Debounce on this page",
      detail:
        "This page's DOM changed noticeably between two snapshots taken moments apart. Increasing DOM Change Debounce in Apty Studio can reduce false re-evaluation triggers on a page like this.",
      relatedStudioConcept: "DOM Change Debounce",
    });
  }

  return recommendations;
}

const SUMMARY_BY_GRADE: Record<DomHealthGrade, string> = {
  EXCELLENT: "This page's DOM is highly reliable for Apty element selection.",
  GOOD: "This page's DOM is generally reliable for Apty element selection, with minor risks.",
  FAIR: "This page's DOM has some selector-reliability risks worth reviewing.",
  NEEDS_ATTENTION:
    "This page's DOM has meaningful selector-reliability risks likely to cause intermittent Apty issues.",
  HIGH_RISK:
    "This page's DOM is unreliable for Apty element selection — expect frequent selector breakage.",
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Score two DOM Health snapshots of the same page, taken moments apart.
 * `after` is treated as the "current" state for quality/complexity metrics
 * that only need one snapshot; `before`/`after` together drive the
 * stability metrics. Deterministic: the same two snapshots always produce
 * the same result.
 */
export function buildDomHealthAuditResult(
  before: DomHealthSnapshot,
  after: DomHealthSnapshot,
  auditId: string,
): DomHealthAuditResult {
  const selectorQuality = computeSelectorQuality(after.interactiveElements);
  const attributeQuality = computeAttributeQuality(after.interactiveElements);
  const selectorStability = computeSelectorStability(
    before.interactiveElements,
    after.interactiveElements,
  );
  const domStability = computeDomStability(before, after);
  const iframeAccessibility = computeIframeAccessibility(after.iframes);
  const shadowDomAccessibility = computeShadowDomAccessibility(
    after.shadowDom,
    after.counts.totalElements,
  );
  const domComplexity = computeDomComplexity(
    after.counts,
    after.iframes,
    after.shadowDom,
  );
  const overlayRisk = computeOverlayRisk(after.zIndex);

  const metrics: DomHealthMetrics = {
    selectorQuality: selectorQuality.score,
    selectorStability: selectorStability.score,
    attributeQuality: attributeQuality.score,
    domStability: domStability.score,
    iframeAccessibility: iframeAccessibility.score,
    shadowDomAccessibility: shadowDomAccessibility.score,
    domComplexity: domComplexity.score,
    overlayRisk: overlayRisk.score,
  };

  const rawScore = (Object.keys(WEIGHTS) as DomHealthMetricKey[]).reduce(
    (sum, key) => sum + metrics[key] * WEIGHTS[key],
    0,
  );
  const score = Math.round(Math.min(100, Math.max(0, rawScore)));
  const grade = gradeForScore(score);

  const metricDetails: DomHealthMetricDetails = {
    selectorQuality: selectorQuality.detail,
    selectorStability: selectorStability.detail,
    attributeQuality: attributeQuality.detail,
    domStability: domStability.detail,
    iframeAccessibility: iframeAccessibility.detail,
    shadowDomAccessibility: shadowDomAccessibility.detail,
    domComplexity: domComplexity.detail,
    overlayRisk: overlayRisk.detail,
  };

  return {
    auditId,
    timestamp: after.collectedAt,
    url: after.url,
    pageTitle: after.title,
    score,
    grade,
    metrics,
    metricDetails,
    summary: SUMMARY_BY_GRADE[grade],
    risks: buildRisks(metrics, metricDetails),
    recommendations: buildRecommendations(metrics, metricDetails),
    metadata: {
      elementsAnalyzed: after.counts.totalElements,
      interactiveElementsAnalyzed: after.counts.interactiveElements,
      iframeCount: after.iframes.total,
      shadowRootCount: after.shadowDom.roots,
      snapshotsCompared: 2,
    },
  };
}
