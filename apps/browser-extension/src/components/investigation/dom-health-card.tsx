/**
 * Apty DOM Health card — a persistent, always-visible surface above the
 * chat input, independent of whether an investigation is active. Never
 * runs automatically: an audit only starts when the user clicks "Check
 * DOM Health" (current page) or "Audit Application" (multi-page).
 *
 * Renders the evidence-driven report produced by `runDomHealthAudit` /
 * `runApplicationDomHealthAudit`: every number shown here came from live
 * selector generation/verification, cross-snapshot stability tracking, and
 * hit testing performed in-page — this component only displays it, it
 * never computes or adjusts a score.
 *
 * Both call directly into `@apty/browser-runtime` — the same
 * functions the `run_dom_health_audit` / `run_application_dom_health_audit`
 * agent tools call — so the buttons work without any agent/LLM turn, and
 * always report the same deterministic result either way.
 */

import {
  type ApplicationAuditOutcome,
  type ApplicationAuditProgress,
  type ApplicationDiscoveryMode,
  type DesEvidence,
  type DomHealthAuditOutcome,
  type DomHealthAuditResult,
  type DomHealthConfidence,
  type DomHealthGrade,
  type DomHealthMetricDetails,
  type DomHealthMetricKey,
  type DomHealthMetrics,
  type DomHealthRecommendation,
  type DomHealthRisk,
  type PageAuditRecord,
  type RouteProbeReport,
  runApplicationDomHealthAudit,
  runDomHealthAudit,
} from "@apty/browser-runtime";
import { useChatContext } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import type { I18nContextValue, TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import { ChevronDownIcon, Loader2Icon, ScanSearchIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  acquireTabLock,
  releaseTabLock,
  useTabLockHolder,
} from "./dom-config/tab-lock";
import { RouteProbePanel } from "./route-probe-panel";
import type { StatusMeta } from "./status-meta";
import { toneBadgeClass, toneDotClass, toneTextClass } from "./tone-classes";
import { useCurrentTarget } from "./use-current-target";
import { ValidationBundleExport } from "./validation-bundle-export";

type Translate = I18nContextValue["t"];

const LOADING_STAGES: TranslationKey[] = [
  "domHealth.loadingStages.scanning",
  "domHealth.loadingStages.generating",
  "domHealth.loadingStages.uniqueness",
  "domHealth.loadingStages.stability",
  "domHealth.loadingStages.hitTests",
  "domHealth.loadingStages.building",
];

const GRADE_META: Record<
  DomHealthGrade,
  { label: TranslationKey; badgeClassName: string }
> = {
  EXCELLENT: {
    label: "domHealth.grade.excellent",
    badgeClassName: "border-transparent bg-success text-success-foreground",
  },
  GOOD: {
    label: "domHealth.grade.good",
    badgeClassName: "border-transparent bg-success-muted text-success",
  },
  FAIR: {
    label: "domHealth.grade.fair",
    badgeClassName: "border-warning-border bg-transparent text-warning",
  },
  NEEDS_ATTENTION: {
    label: "domHealth.grade.needsAttention",
    badgeClassName: "border-transparent bg-warning-muted text-warning",
  },
  HIGH_RISK: {
    label: "domHealth.grade.highRisk",
    badgeClassName:
      "border-transparent bg-destructive text-destructive-foreground",
  },
  // Deliberately NOT green/red/any tone that reads as "healthy" or
  // "unhealthy" — there is no score behind this grade at all (see
  // EvidenceState). A neutral, clearly-different treatment so this can
  // never be mistaken for a passing or failing result.
  NOT_ASSESSED: {
    label: "domHealth.grade.notAssessed",
    badgeClassName: "border-muted-foreground/40 bg-muted text-muted-foreground",
  },
};

const EVIDENCE_STATE_LABEL: Record<string, TranslationKey> = {
  HEALTHY_EVIDENCE: "domHealth.evidenceState.healthy",
  PARTIAL_EVIDENCE: "domHealth.evidenceState.partial",
  NO_EVIDENCE: "domHealth.evidenceState.none",
  INACCESSIBLE: "domHealth.evidenceState.inaccessible",
  INCOMPLETE_EVIDENCE: "domHealth.evidenceState.incomplete",
  FAILED: "domHealth.evidenceState.failed",
  NOT_ASSESSED: "domHealth.evidenceState.notAssessed",
};

/** A lookup-map label, or the raw value when the map has no entry for it. */
function labelOrRaw(
  t: Translate,
  map: Record<string, TranslationKey>,
  value: string,
): string {
  const key = map[value];
  return key ? t(key) : value;
}

const CONFIDENCE_LABEL: Record<DomHealthConfidence, TranslationKey> = {
  HIGH: "domHealth.confidence.high",
  MEDIUM: "domHealth.confidence.medium",
  LOW: "domHealth.confidence.low",
};

const METRIC_ORDER: DomHealthMetricKey[] = [
  "automaticSelection",
  "selectorStability",
  "recoveryEfficacy",
  "selectorComplexity",
  "ambiguityRisk",
  "hitTestTargetability",
  "domVolatility",
  "accessibilitySignal",
];

const METRIC_LABELS: Record<DomHealthMetricKey, TranslationKey> = {
  automaticSelection: "domHealth.metric.automaticSelection",
  selectorStability: "domHealth.metric.selectorStability",
  recoveryEfficacy: "domHealth.metric.recoveryEfficacy",
  selectorComplexity: "domHealth.metric.selectorComplexity",
  ambiguityRisk: "domHealth.metric.ambiguityRisk",
  hitTestTargetability: "domHealth.metric.hitTestTargetability",
  domVolatility: "domHealth.metric.domVolatility",
  accessibilitySignal: "domHealth.metric.accessibilitySignal",
};

const OUTCOME_LABELS: Record<string, TranslationKey> = {
  DIRECT_SUCCESS: "domHealth.outcome.direct",
  RECOVERED_BY_IGNORE: "domHealth.outcome.recoveredIgnore",
  RECOVERED_BY_PARTIAL: "domHealth.outcome.recoveredPartial",
  RECOVERED_BY_CONTEXT: "domHealth.outcome.recoveredContext",
  POSITIONAL_ONLY: "domHealth.outcome.positionalOnly",
  AMBIGUOUS: "domHealth.outcome.ambiguous",
  WRONG_TARGET: "domHealth.outcome.wrongTarget",
  NOT_RESOLVED: "domHealth.outcome.notResolved",
  INACCESSIBLE: "domHealth.outcome.inaccessible",
};

const DISCOVERY_MODE_DESCRIPTION: Record<
  ApplicationDiscoveryMode,
  TranslationKey
> = {
  page: "domHealth.discoveryModeDescription.page",
  "application-safe": "domHealth.discoveryModeDescription.applicationSafe",
  "application-deep": "domHealth.discoveryModeDescription.applicationDeep",
};

const DISCOVERY_MODE_LABEL: Record<ApplicationDiscoveryMode, TranslationKey> = {
  page: "domHealth.discoveryMode.page",
  "application-safe": "domHealth.discoveryMode.applicationSafe",
  "application-deep": "domHealth.discoveryMode.applicationDeep",
};

const DISCOVERY_METHOD_LABEL: Record<string, TranslationKey> = {
  "single-page-only": "domHealth.discoveryMethod.singlePageOnly",
  "anchor-links": "domHealth.discoveryMode.applicationSafe",
  "anchor-links+navigation-controls": "domHealth.discoveryMode.applicationDeep",
};

const PAGE_STATUS_LABELS: Record<PageAuditRecord["status"], TranslationKey> = {
  completed: "domHealth.pageStatus.completed",
  failed: "domHealth.pageStatus.failed",
  "skipped-unsafe": "domHealth.pageStatus.skippedUnsafe",
  "skipped-cross-origin": "domHealth.pageStatus.skippedCrossOrigin",
  "skipped-duplicate": "domHealth.pageStatus.skippedDuplicate",
  "not-discovered": "domHealth.pageStatus.notDiscovered",
  "explored-no-new-state": "domHealth.pageStatus.exploredNoNewState",
};

/** A page row's label: its title, else its URL without the query string, which can carry screen context. */
function pageRowLabel(page: PageAuditRecord): string {
  if (page.title) return page.title;
  try {
    const url = new URL(page.url);
    url.search = "";
    return url.toString();
  } catch {
    return page.url.split("?")[0] ?? page.url;
  }
}

function metricTone(score: number): StatusMeta["tone"] {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

function riskTone(severity: DomHealthRisk["severity"]): StatusMeta["tone"] {
  if (severity === "high") return "danger";
  if (severity === "medium") return "warning";
  return "neutral";
}

/** Tested elements that were visible when sampled; hidden ones are not hit-test failures. */
function visibleTested(hitTest: { tested: number; hidden: number }): number {
  return Math.max(0, hitTest.tested - hitTest.hidden);
}

/** "2/2 frames with content reached, 2 empty placeholder(s) skipped": placeholders are part of the total but never readable. */
function framesReached(
  t: Translate,
  reached: number,
  total: number,
  placeholders: number,
): string {
  const withContent = Math.max(0, total - placeholders);
  return placeholders > 0
    ? t("domHealth.framesWithContentReached", {
        reached,
        withContent,
        placeholders,
      })
    : t("domHealth.framesReachedCount", { reached, total });
}

function outcomeTone(outcome: string): StatusMeta["tone"] {
  if (outcome === "DIRECT_SUCCESS") return "success";
  if (outcome.startsWith("RECOVERED_BY")) return "warning";
  return "danger";
}

function pageStatusTone(status: PageAuditRecord["status"]): StatusMeta["tone"] {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  return "neutral";
}

/** Shape shared by both a single-page result and the application-level rollup — every field here is evidence-driven, never text this component invents. */
interface SharedEvidence {
  confidence: DomHealthConfidence;
  evidenceState: string;
  manualSelectorDependency: number;
  metrics: DomHealthMetrics;
  metricDetails: DomHealthMetricDetails;
  selectorConfiguration: {
    source: "default" | "customer";
    profile?: string;
    detail: string;
  };
  summary: string;
  strengths: string[];
  risks: DomHealthRisk[];
  recommendations: DomHealthRecommendation[];
  methodology: string[];
  desEvidence?: DesEvidence;
}

function DesStepsSection({ evidence }: { evidence: DesEvidence }) {
  const { t } = useTranslation();
  if (evidence.steps.length === 0) return null;
  return (
    <section
      aria-label={t("domHealth.desTitle")}
      className="rounded-md border bg-muted/30 px-2.5 py-2 text-[11px]"
    >
      <div className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">
        {t("domHealth.desTitle")}
      </div>
      <ul className="space-y-1">
        {evidence.steps.map((row) => (
          <li key={row.outcome}>
            <span className="font-mono font-semibold">{row.elements}</span>{" "}
            <span
              className={cn(
                "font-medium",
                toneTextClass(outcomeTone(row.outcome)),
              )}
            >
              {row.step}
            </span>
            <span className="text-muted-foreground"> — {row.meaning}</span>
          </li>
        ))}
      </ul>
      {evidence.dynamicValuesLeftOut.length > 0 && (
        <p className="mt-1.5 text-muted-foreground">
          {t("domHealth.dynamicLeftOut", {
            list: evidence.dynamicValuesLeftOut
              .map((row) =>
                t("domHealth.dynamicLeftOutItem", {
                  attribute: row.attribute,
                  count: row.elements,
                }),
              )
              .join(", "),
          })}
        </p>
      )}
    </section>
  );
}

function SharedEvidenceSections({ result }: { result: SharedEvidence }) {
  const { t } = useTranslation();
  const evidenceIsIncomplete = result.evidenceState !== "HEALTHY_EVIDENCE";
  const auto = result.metricDetails?.automaticSelection;
  const hitTest = result.metricDetails?.hitTestTargetability;
  const a11y = result.metricDetails?.accessibilitySignal;
  return (
    <>
      {evidenceIsIncomplete && (
        <p
          className={cn(
            "rounded-md border px-2.5 py-1.5 text-xs font-medium",
            toneTextClass(
              result.evidenceState === "PARTIAL_EVIDENCE"
                ? "warning"
                : "danger",
            ),
          )}
        >
          {t("domHealth.evidence", {
            state: labelOrRaw(t, EVIDENCE_STATE_LABEL, result.evidenceState),
          })}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{result.summary}</p>

      {/* Never let a recovered resolution look identical to a direct one, and
          never let hit-test/accessibility failures hide behind a high
          aggregate score (spec sections 9-11). */}
      {auto && auto.totalAnalyzed > 0 && (
        <div className="rounded-md border bg-muted/30 px-2.5 py-2">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("domHealth.autoBreakdown")}
          </div>
          <div className="grid grid-cols-3 gap-x-2 text-center">
            <div>
              <div
                className={cn(
                  "font-mono text-sm font-semibold",
                  toneTextClass("success"),
                )}
              >
                {auto.directSuccessRate}%
              </div>
              <div className="text-[10px] text-muted-foreground">
                {t("domHealth.breakdownDirect")}
              </div>
            </div>
            <div>
              <div
                className={cn(
                  "font-mono text-sm font-semibold",
                  toneTextClass("warning"),
                )}
              >
                {auto.recoveredSuccessRate}%
              </div>
              <div className="text-[10px] text-muted-foreground">
                {t("domHealth.breakdownRecovered")}
              </div>
            </div>
            <div>
              <div
                className={cn(
                  "font-mono text-sm font-semibold",
                  toneTextClass(
                    auto.manualDependencyRate > 15 ? "danger" : "success",
                  ),
                )}
              >
                {auto.manualDependencyRate}%
              </div>
              <div className="text-[10px] text-muted-foreground">
                {t("domHealth.breakdownManual")}
              </div>
            </div>
          </div>
        </div>
      )}

      {hitTest && hitTest.tested > 0 && (
        <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">
              {t("domHealth.hitTestFailures")}
            </span>
            <span
              className={cn(
                "font-mono font-semibold",
                toneTextClass(
                  hitTest.notTargetable / visibleTested(hitTest) > 0.3
                    ? "danger"
                    : hitTest.notTargetable > 0
                      ? "warning"
                      : "success",
                ),
              )}
            >
              {hitTest.notTargetable}/{visibleTested(hitTest)}
            </span>
          </div>
          {hitTest.hidden > 0 && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t("domHealth.hiddenNotCounted", { count: hitTest.hidden })}
            </p>
          )}
        </div>
      )}
      {hitTest &&
        hitTest.tested > 0 &&
        (result.desEvidence?.hitTestReasons.length ?? 0) > 0 && (
          <ul
            aria-label={t("domHealth.whyHitTestsFailed")}
            className="-mt-1 space-y-0.5 px-2.5 text-[11px] text-muted-foreground"
          >
            {result.desEvidence?.hitTestReasons.map((row) => (
              <li key={row.reason}>
                <span className="font-mono font-semibold text-foreground">
                  {row.elements}
                </span>{" "}
                {row.reason}: {row.meaning}
              </li>
            ))}
          </ul>
        )}

      {a11y && a11y.totalInteractive > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-2 text-xs">
          <span className="text-muted-foreground">
            {t("domHealth.missingAccessibleNames")}
          </span>
          <span
            className={cn(
              "font-mono font-semibold",
              toneTextClass(
                a11y.missingAccessibleName / a11y.totalInteractive > 0.3
                  ? "danger"
                  : a11y.missingAccessibleName > 0
                    ? "warning"
                    : "success",
              ),
            )}
          >
            {a11y.missingAccessibleName}/{a11y.totalInteractive}
          </span>
        </div>
      )}

      <div className="rounded-md border bg-muted/30 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("domHealth.manualSelectorDependency")}
          </span>
          <span
            className={cn(
              "font-mono text-sm font-semibold",
              toneTextClass(
                result.manualSelectorDependency > 30
                  ? "danger"
                  : result.manualSelectorDependency > 15
                    ? "warning"
                    : "success",
              ),
            )}
          >
            {result.manualSelectorDependency}%
          </span>
        </div>
      </div>

      {result.desEvidence && <DesStepsSection evidence={result.desEvidence} />}

      <p className="text-[11px] text-muted-foreground">
        {t("domHealth.selectorConfiguration", {
          source: t(
            result.selectorConfiguration?.source === "customer"
              ? "domHealth.selectorConfigurationCustomer"
              : "domHealth.selectorConfigurationDefault",
          ),
        })}
        {result.selectorConfiguration?.profile &&
          ` ${t("domHealth.auditProfile", { profile: result.selectorConfiguration.profile })}`}
      </p>

      <div>
        <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("domHealth.metrics")}
        </h4>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {METRIC_ORDER.map((key) => {
            const score = result.metrics[key];
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="truncate text-muted-foreground">
                  {t(METRIC_LABELS[key])}
                </span>
                <span
                  className={cn(
                    "shrink-0 font-mono font-medium",
                    toneTextClass(metricTone(score)),
                  )}
                >
                  {score}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {result.strengths.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("domHealth.strengths")}
          </h4>
          <ul className="space-y-1 text-xs text-foreground">
            {result.strengths.map((s) => (
              <li key={s} className="flex items-start gap-1.5">
                <span className="text-success">✓</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.risks.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("domHealth.risks")}
          </h4>
          <ul className="space-y-1.5">
            {result.risks.map((risk) => (
              <li key={risk.id} className="text-xs">
                <div className="flex items-start gap-1.5">
                  <span
                    className={cn(
                      "mt-1 size-1.5 shrink-0 rounded-full",
                      toneDotClass(riskTone(risk.severity)),
                    )}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{risk.title}</p>
                    <p className="text-muted-foreground">{risk.evidence}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.recommendations.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("domHealth.recommendations")}
          </h4>
          <ul className="space-y-1.5">
            {result.recommendations.map((rec) => (
              <li key={rec.id} className="text-xs">
                <p className="font-medium text-foreground">{rec.title}</p>
                <p className="text-muted-foreground">{rec.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
          {t("domHealth.methodology")}
        </summary>
        <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-muted-foreground">
          {result.methodology.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>
    </>
  );
}

/** Why confidence was capped, which frames were scored, and what overlay content was left out. */
function FramesAndExclusions({
  result,
}: {
  result: Pick<
    DomHealthAuditResult,
    "confidenceCaps" | "frames" | "excludedRoots"
  >;
}) {
  const { t } = useTranslation();
  const caps = result.confidenceCaps ?? [];
  const frames = result.frames ?? [];
  const excluded = result.excludedRoots ?? [];
  return (
    <>
      {caps.length > 0 && (
        <ul className={cn("space-y-0.5 text-[11px]", toneTextClass("warning"))}>
          {caps.map((reason) => (
            <li key={reason}>{t("domHealth.confidenceCapped", { reason })}</li>
          ))}
        </ul>
      )}
      {(frames.length > 1 || excluded.length > 0) && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
            {t("domHealth.framesAndExcluded", {
              frames: frames.length,
              excluded: excluded.length,
            })}
          </summary>
          <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
            {frames.map((frame) => (
              <li key={frame.frameId}>
                <span className="font-mono">{frame.key}</span> — {frame.role},{" "}
                {frame.status}
                {typeof frame.score === "number" && ` · ${frame.score}/100`}
                {frame.role !== "application" &&
                  ` · ${t("domHealth.notScored")}`}
              </li>
            ))}
            {excluded.map((entry) => (
              <li key={entry.matcher}>
                {t("domHealth.excludedPrefix", { owner: entry.owner })}
                <span className="font-mono">{entry.matcher}</span>
                {t("domHealth.excludedSuffix", {
                  roots: entry.roots,
                  count: entry.elementCount,
                })}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export function DomHealthCard({
  developerTools = false,
  ignoredRoots = [],
  thresholdOverrides,
}: {
  /** Settings → Troubleshooting → Developer tools: shows the route probe. */
  developerTools?: boolean;
  /** Settings → Troubleshooting: overlays to leave out, on top of the built-in list. */
  ignoredRoots?: readonly string[];
  /** Developer tools: threshold overrides for real-tenant validation. */
  thresholdOverrides?: Record<string, number>;
}) {
  const { t } = useTranslation();
  const { sessionId } = useChatContext();
  const target = useCurrentTarget(sessionId);
  const [isLoading, setIsLoading] = useState(false);
  const [outcome, setOutcome] = useState<DomHealthAuditOutcome | null>(null);
  const [isAppLoading, setIsAppLoading] = useState(false);
  const [appOutcome, setAppOutcome] = useState<ApplicationAuditOutcome | null>(
    null,
  );
  const [appProgress, setAppProgress] =
    useState<ApplicationAuditProgress | null>(null);
  const [view, setView] = useState<"page" | "application">("page");
  const [discoveryMode, setDiscoveryMode] =
    useState<ApplicationDiscoveryMode>("application-safe");
  const [expanded, setExpanded] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [probeReport, setProbeReport] = useState<RouteProbeReport | null>(null);
  const lockedByDomConfig = useTabLockHolder(target.tabId) === "dom-config";
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (stageTimerRef.current) clearInterval(stageTimerRef.current);
    },
    [],
  );

  const runCheck = useCallback(async () => {
    if (!target.tabId) return;
    const tabId = target.tabId;
    if (!acquireTabLock(tabId, "dom-health")) return;
    setView("page");
    setIsLoading(true);
    setExpanded(true);
    setStageIndex(0);
    stageTimerRef.current = setInterval(() => {
      setStageIndex((i) => (i + 1) % LOADING_STAGES.length);
    }, 700);

    const result = await runDomHealthAudit(tabId, {
      ignoredRoots,
      thresholdOverrides,
    }).finally(() => releaseTabLock(tabId, "dom-health"));

    if (stageTimerRef.current) {
      clearInterval(stageTimerRef.current);
      stageTimerRef.current = null;
    }
    setOutcome(result);
    setIsLoading(false);
  }, [target.tabId, ignoredRoots, thresholdOverrides]);

  const runApplicationCheck = useCallback(async () => {
    if (!target.tabId) return;
    const tabId = target.tabId;
    if (!acquireTabLock(tabId, "dom-health")) return;
    setView("application");
    setIsAppLoading(true);
    setExpanded(true);
    setAppProgress(null);

    const result = await runApplicationDomHealthAudit(tabId, {
      discoveryMode,
      ignoredRoots,
      thresholdOverrides,
      onProgress: (progress) => setAppProgress(progress),
    }).finally(() => releaseTabLock(tabId, "dom-health"));

    setAppOutcome(result);
    setIsAppLoading(false);
    setAppProgress(null);
  }, [target.tabId, discoveryMode, ignoredRoots, thresholdOverrides]);

  const hasResult = outcome !== null || appOutcome !== null;
  const active = view === "application" ? appOutcome : outcome;
  const activeIsLoading = view === "application" ? isAppLoading : isLoading;

  return (
    <div className="mb-2 overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex w-full flex-col gap-1.5 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full min-w-0 items-center gap-2 text-left"
          aria-expanded={expanded}
          aria-label={t("domHealth.toggleLabel", {
            status: active?.available
              ? active.score !== null
                ? t("domHealth.statusScore", {
                    score: active.score,
                    grade: t(GRADE_META[active.grade].label),
                  })
                : t("domHealth.statusNotAssessed", {
                    state: labelOrRaw(
                      t,
                      EVIDENCE_STATE_LABEL,
                      active.evidenceState,
                    ),
                  })
              : active
                ? t("domHealth.statusUnavailable")
                : t("domHealth.statusNotChecked"),
            action: t(expanded ? "domHealth.collapse" : "domHealth.expand"),
          })}
        >
          <ScanSearchIcon
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("domHealth.title")}
          </span>
          {active?.available && (
            <span
              className={cn(
                "shrink-0 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium",
                GRADE_META[active.grade].badgeClassName,
              )}
            >
              {active.score !== null
                ? `${active.score}/100 · ${t(GRADE_META[active.grade].label)}`
                : t(GRADE_META[active.grade].label)}
            </span>
          )}
          {active && !active.available && (
            <span
              className={cn(
                "shrink-0 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium",
                toneBadgeClass("danger"),
              )}
            >
              {t("domHealth.unavailable")}
            </span>
          )}
          {!active && !activeIsLoading && (
            <span className="truncate text-xs text-muted-foreground">
              {t("domHealth.notCheckedYet")}
            </span>
          )}
          {activeIsLoading && view === "page" && (
            <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
              <Loader2Icon
                className="size-3 shrink-0 animate-spin"
                aria-hidden="true"
              />
              <span className="truncate">
                {t(
                  LOADING_STAGES[stageIndex] ??
                    "domHealth.loadingStages.scanning",
                )}
              </span>
            </span>
          )}
          {activeIsLoading && view === "application" && (
            <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
              <Loader2Icon
                className="size-3 shrink-0 animate-spin"
                aria-hidden="true"
              />
              <span className="truncate">
                {appProgress?.phase === "auditing"
                  ? t("domHealth.auditingPage", {
                      index: appProgress.pageIndex + 1,
                    })
                  : appProgress?.phase === "discovering-links"
                    ? t("domHealth.discoveringPages")
                    : t("domHealth.startingAppAudit")}
              </span>
            </span>
          )}
          <ChevronDownIcon
            className={cn(
              "ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200",
              expanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
        {/* Actions row — wraps at narrow widths instead of squeezing the
            title above into unreadable clipped text (see WP13). */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={outcome ? "outline" : "default"}
            disabled={
              isLoading || isAppLoading || !target.tabId || lockedByDomConfig
            }
            onClick={(e) => {
              e.stopPropagation();
              void runCheck();
            }}
            aria-label={t(
              isLoading
                ? "domHealth.checkingAria"
                : outcome
                  ? "domHealth.recheckAria"
                  : "domHealth.checkAria",
            )}
          >
            {t(
              isLoading
                ? "domHealth.checking"
                : outcome
                  ? "domHealth.recheck"
                  : "domHealth.check",
            )}
          </Button>
          <select
            value={discoveryMode}
            onChange={(e) => {
              e.stopPropagation();
              setDiscoveryMode(e.target.value as ApplicationDiscoveryMode);
            }}
            onClick={(e) => e.stopPropagation()}
            disabled={
              isLoading || isAppLoading || !target.tabId || lockedByDomConfig
            }
            aria-label={t("domHealth.discoveryModeAria")}
            title={t(DISCOVERY_MODE_DESCRIPTION[discoveryMode])}
            className="rounded-md border bg-background px-1.5 py-1 text-[11px] text-muted-foreground"
          >
            <option value="page">{t(DISCOVERY_MODE_LABEL.page)}</option>
            <option value="application-safe">
              {t(DISCOVERY_MODE_LABEL["application-safe"])}
            </option>
            <option value="application-deep">
              {t(DISCOVERY_MODE_LABEL["application-deep"])}
            </option>
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={
              isLoading || isAppLoading || !target.tabId || lockedByDomConfig
            }
            onClick={(e) => {
              e.stopPropagation();
              void runApplicationCheck();
            }}
            aria-label={t(
              isAppLoading
                ? "domHealth.auditingAppAria"
                : appOutcome
                  ? "domHealth.reauditAppAria"
                  : "domHealth.auditAppAria",
            )}
          >
            {t(
              isAppLoading
                ? "domHealth.auditing"
                : appOutcome
                  ? "domHealth.reaudit"
                  : "domHealth.auditApp",
            )}
          </Button>
        </div>
        {lockedByDomConfig && (
          <p className="text-xs text-muted-foreground">
            {t("domConfig.lockedByDomConfig")}
          </p>
        )}
      </div>

      {expanded && (
        <div className="animate-in fade-in slide-in-from-top-1 max-h-[60vh] overflow-y-auto border-t px-3 pb-3 pt-2 duration-200">
          {hasResult && (
            <div className="mb-2 flex gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => setView("page")}
                className={cn(
                  "rounded px-2 py-0.5",
                  view === "page"
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                disabled={!outcome}
              >
                {t("domHealth.currentPage")}
              </button>
              <button
                type="button"
                onClick={() => setView("application")}
                className={cn(
                  "rounded px-2 py-0.5",
                  view === "application"
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                disabled={!appOutcome}
              >
                {t("domHealth.application")}
              </button>
            </div>
          )}

          {!active && !activeIsLoading && (
            <p className="py-2 text-xs text-muted-foreground">
              {t("domHealth.intro")}
            </p>
          )}

          {activeIsLoading && view === "page" && (
            <p className="py-2 text-xs text-muted-foreground">
              {t("domHealth.loadingPage")}
            </p>
          )}

          {activeIsLoading && view === "application" && (
            <p className="py-2 text-xs text-muted-foreground">
              {t("domHealth.loadingApp")}
            </p>
          )}

          {active && !active.available && (
            <div className="space-y-1 py-1">
              <p className="text-sm text-foreground">
                {t(
                  view === "application"
                    ? "domHealth.unableToAuditApp"
                    : "domHealth.unableToAuditPage",
                )}
              </p>
              <p className="text-xs text-muted-foreground">{active.error}</p>
            </div>
          )}

          {view === "page" && outcome?.available && (
            <div className="space-y-3 pt-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{t(CONFIDENCE_LABEL[outcome.confidence])}</span>
                <span>·</span>
                <span>
                  {t("domHealth.scope", {
                    scope: t("domHealth.currentPage"),
                  })}
                </span>
                <span>·</span>
                <span>
                  {t("domHealth.snapshots", {
                    count: outcome.coverage.snapshotsCompared,
                  })}
                </span>
                <span>·</span>
                <span>
                  {t("domHealth.elementsAnalyzedCount", {
                    count: outcome.coverage.elementsAnalyzed,
                  })}
                </span>
                {outcome.coverage.analysis.capped && (
                  <>
                    <span>·</span>
                    <span className={toneTextClass("warning")}>
                      {t("domHealth.analysisCapped")}
                    </span>
                  </>
                )}
              </div>
              <p className="text-xs font-medium text-foreground">
                {t("domHealth.observedPageNote", {
                  score:
                    outcome.score !== null
                      ? `${outcome.score}/100`
                      : t("domHealth.notEnoughEvidence"),
                })}
              </p>

              <SharedEvidenceSections result={outcome} />

              {outcome.elementSamples.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                    {t("domHealth.elementDetails", {
                      count: outcome.elementSamples.length,
                    })}
                  </summary>
                  <div className="mt-1.5 max-h-64 overflow-y-auto rounded-md border">
                    <table className="w-full text-left text-[11px]">
                      <thead className="sticky top-0 bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="px-1.5 py-1 font-medium">
                            {t("domHealth.colElement")}
                          </th>
                          <th className="px-1.5 py-1 font-medium">
                            {t("domHealth.colSelector")}
                          </th>
                          <th className="px-1.5 py-1 font-medium">
                            {t("domHealth.colResult")}
                          </th>
                          <th className="px-1.5 py-1 font-medium">
                            {t("domHealth.colStability")}
                          </th>
                          <th className="px-1.5 py-1 font-medium">
                            {t("domHealth.colHitTest")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {outcome.elementSamples.flatMap((el, i) => [
                          <tr
                            // biome-ignore lint/suspicious/noArrayIndexKey: reports have no stable id
                            key={`${i}-row`}
                            className="border-t"
                          >
                            <td className="px-1.5 py-1 font-mono text-muted-foreground">
                              {el.tagName}
                            </td>
                            <td className="max-w-[140px] truncate px-1.5 py-1 font-mono text-muted-foreground">
                              {el.bestSelector ?? "—"}
                            </td>
                            <td
                              className={cn(
                                "px-1.5 py-1 font-medium",
                                toneTextClass(outcomeTone(el.outcome)),
                              )}
                            >
                              {labelOrRaw(t, OUTCOME_LABELS, el.outcome)}
                            </td>
                            <td className="px-1.5 py-1 text-muted-foreground">
                              {el.stability}
                            </td>
                            <td className="px-1.5 py-1 text-muted-foreground">
                              {el.hitTest?.classification ?? "—"}
                            </td>
                          </tr>,
                          el.explanation && (
                            <tr
                              // biome-ignore lint/suspicious/noArrayIndexKey: reports have no stable id
                              key={`${i}-why`}
                            >
                              <td
                                colSpan={5}
                                className="px-1.5 pb-1.5 text-muted-foreground"
                              >
                                <p className="text-foreground">
                                  {el.explanation.howFound}
                                </p>
                                {el.explanation.notes.map((note) => (
                                  <p key={note}>{note}</p>
                                ))}
                                {el.explanation.fix && (
                                  <p>
                                    <span className="font-medium text-foreground">
                                      {t("domHealth.fix")}{" "}
                                    </span>
                                    {el.explanation.fix}
                                  </p>
                                )}
                              </td>
                            </tr>
                          ),
                        ])}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              <FramesAndExclusions result={outcome} />

              <details className="text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                  {t("domHealth.technicalDetails")}
                </summary>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                  <dt>{t("domHealth.elementsAnalyzed")}</dt>
                  <dd className="text-right font-mono">
                    {outcome.metadata.elementsAnalyzed}
                  </dd>
                  <dt>{t("domHealth.interactiveElements")}</dt>
                  <dd className="text-right font-mono">
                    {outcome.metadata.interactiveElementsAnalyzed}
                  </dd>
                  <dt>{t("domHealth.iframesFrames")}</dt>
                  <dd className="text-right font-mono">
                    {outcome.iframes.byTag.iframe} /{" "}
                    {outcome.iframes.byTag.frame}
                  </dd>
                  <dt>{t("domHealth.shadowRoots")}</dt>
                  <dd className="text-right font-mono">
                    {outcome.metadata.shadowRootCount}
                  </dd>
                  <dt>{t("domHealth.framesReached")}</dt>
                  <dd className="text-right font-mono">
                    {framesReached(
                      t,
                      outcome.frameAccessibility.framesAccessible,
                      outcome.frameAccessibility.framesTotal,
                      outcome.frameAccessibility.framesPlaceholder ?? 0,
                    )}
                  </dd>
                </dl>
              </details>

              <p className="text-[11px] text-muted-foreground">
                {t("domHealth.lastChecked", {
                  time: new Date(outcome.timestamp).toLocaleTimeString(),
                })}
              </p>
            </div>
          )}

          {view === "application" && appOutcome?.available && (
            <div className="space-y-3 pt-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{t(CONFIDENCE_LABEL[appOutcome.confidence])}</span>
                <span>·</span>
                <span>
                  {t("domHealth.scope", {
                    scope: t(
                      appOutcome.scopeLabel === "APPLICATION"
                        ? "domHealth.application"
                        : "domHealth.currentPage",
                    ),
                  })}
                </span>
                <span>·</span>
                <span>
                  {t("domHealth.statesAudited", {
                    audited: appOutcome.coverage.pagesAudited,
                    discovered: appOutcome.coverage.pagesDiscovered,
                    percent: appOutcome.coverage.coveragePercent,
                  })}
                </span>
                <span>·</span>
                <span>
                  {framesReached(
                    t,
                    appOutcome.coverage.framesInspected,
                    appOutcome.coverage.framesDiscovered,
                    appOutcome.coverage.framesPlaceholder ?? 0,
                  )}
                </span>
                {appOutcome.coverage.pagesNotDiscovered > 0 && (
                  <>
                    <span>·</span>
                    <span className={toneTextClass("warning")}>
                      {t("domHealth.controlsNotExplored", {
                        count: appOutcome.coverage.pagesNotDiscovered,
                      })}
                    </span>
                  </>
                )}
              </div>
              <p className="text-xs font-medium text-foreground">
                {t(
                  appOutcome.scopeLabel === "APPLICATION"
                    ? "domHealth.appHealth"
                    : "domHealth.observedPageHealth",
                  {
                    score:
                      appOutcome.score !== null
                        ? `${appOutcome.score}/100`
                        : t("domHealth.notEnoughEvidence"),
                  },
                )}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("domHealth.coverageNote", {
                  method: labelOrRaw(
                    t,
                    DISCOVERY_METHOD_LABEL,
                    appOutcome.coverage.discoveryMethod,
                  ),
                })}
              </p>
              {appOutcome.traversal && (
                <p className="text-[11px] text-muted-foreground">
                  {t("domHealth.traversal")}{" "}
                  <span className="font-medium text-foreground">
                    {t(
                      appOutcome.traversal.mode === "click-first"
                        ? "domHealth.traversalClickFirst"
                        : "domHealth.traversalUrlFirst",
                    )}
                  </span>{" "}
                  — {appOutcome.traversal.reason}
                </p>
              )}

              {appOutcome.crossStateEvidence &&
                appOutcome.crossStateEvidence.attempted > 0 && (
                  <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-[11px]">
                    <div className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">
                      {t(
                        appOutcome.crossStateEvidence.statesTested === 1
                          ? "domHealth.crossStateTitleOne"
                          : "domHealth.crossStateTitleMany",
                        { count: appOutcome.crossStateEvidence.statesTested },
                      )}
                    </div>
                    <p className="text-muted-foreground">
                      {t("domHealth.crossStateIntro", {
                        attempted: appOutcome.crossStateEvidence.attempted,
                        resolved:
                          appOutcome.crossStateEvidence.directStable +
                          appOutcome.crossStateEvidence.recoveredStable +
                          appOutcome.crossStateEvidence.positionalStable,
                      })}{" "}
                      <span className={toneTextClass("danger")}>
                        {t("domHealth.crossStateWrong", {
                          count: appOutcome.crossStateEvidence.wrongTarget,
                        })}
                      </span>
                      {t("domHealth.crossStateNothing", {
                        count: appOutcome.crossStateEvidence.notResolved,
                      })}
                      {(appOutcome.crossStateEvidence.hostChainBroken ?? 0) >
                        0 &&
                        ` ${t("domHealth.crossStateHostChain", { count: appOutcome.crossStateEvidence.hostChainBroken ?? 0 })}`}
                    </p>
                    {(appOutcome.crossStateEvidence.hostChainBreaks ?? [])
                      .length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                        {appOutcome.crossStateEvidence.hostChainBreaks.map(
                          (b) => (
                            <li key={`${b.frameId}-${b.hop}-${b.hostSelector}`}>
                              {t("domHealth.hostChainBreak", {
                                frame: b.frameId,
                                host: b.hop + 1,
                              })}{" "}
                              <code>{b.hostSelector}</code>
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                  </div>
                )}

              <SharedEvidenceSections result={appOutcome} />

              {appOutcome.pages.length > 0 && (
                <details className="text-xs" open>
                  <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                    {t("domHealth.pagesSummary", {
                      count: appOutcome.pages.length,
                      audited: appOutcome.coverage.pagesAudited,
                      failed: appOutcome.coverage.pagesFailed,
                      skipped:
                        appOutcome.coverage.pagesSkippedUnsafe +
                        appOutcome.coverage.pagesSkippedDuplicate,
                      notExplored: appOutcome.coverage.pagesNotDiscovered,
                    })}
                    {appOutcome.coverage.pagesExploredNoNewState > 0 &&
                      t("domHealth.pagesClickedNoNewState", {
                        count: appOutcome.coverage.pagesExploredNoNewState,
                      })}
                  </summary>
                  <div className="mt-1.5 max-h-96 overflow-y-auto rounded-md border">
                    <table className="w-full text-left text-[11px]">
                      <thead className="sticky top-0 bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="px-1.5 py-1 font-medium">
                            {t("domHealth.colPageState")}
                          </th>
                          <th className="px-1.5 py-1 font-medium">
                            {t("domHealth.colDiscovery")}
                          </th>
                          <th className="px-1.5 py-1 font-medium">
                            {t("domHealth.colStatus")}
                          </th>
                          <th className="px-1.5 py-1 font-medium">
                            {t("domHealth.colElements")}
                          </th>
                          <th className="px-1.5 py-1 font-medium">
                            {t("domHealth.colRates")}
                          </th>
                          <th className="px-1.5 py-1 font-medium">
                            {t("domHealth.colHitTestFail")}
                          </th>
                          <th className="px-1.5 py-1 font-medium">
                            {t("domHealth.colScore")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          // Same-URL states must stay distinguishable — a
                          // shared title/url never collapses two real
                          // states into one indistinguishable row (spec
                          // section 23).
                          const labelCounts = new Map<string, number>();
                          for (const page of appOutcome.pages) {
                            const label = pageRowLabel(page);
                            labelCounts.set(
                              label,
                              (labelCounts.get(label) ?? 0) + 1,
                            );
                          }
                          const labelSeen = new Map<string, number>();
                          return appOutcome.pages.map((page, i) => {
                            const label = pageRowLabel(page);
                            const isDuplicateLabel =
                              (labelCounts.get(label) ?? 0) > 1;
                            const occurrence = (labelSeen.get(label) ?? 0) + 1;
                            labelSeen.set(label, occurrence);
                            const auto =
                              page.result?.metricDetails?.automaticSelection;
                            const hitTest =
                              page.result?.metricDetails?.hitTestTargetability;
                            return (
                              <tr
                                // biome-ignore lint/suspicious/noArrayIndexKey: page URLs can repeat across statuses/states
                                key={i}
                                className="border-t align-top"
                              >
                                <td className="max-w-[160px] px-1.5 py-1 font-mono text-muted-foreground">
                                  <span className="block truncate">
                                    {label}
                                    {isDuplicateLabel
                                      ? ` ${t("domHealth.stateOccurrence", { count: occurrence })}`
                                      : ""}
                                  </span>
                                </td>
                                <td className="px-1.5 py-1 text-muted-foreground">
                                  {page.discoverySource}
                                </td>
                                <td
                                  className={cn(
                                    "px-1.5 py-1 font-medium",
                                    toneTextClass(pageStatusTone(page.status)),
                                  )}
                                >
                                  {t(PAGE_STATUS_LABELS[page.status])}
                                  {page.status !== "completed" &&
                                    page.failureReason && (
                                      <span className="block font-normal text-muted-foreground">
                                        {page.failureReason}
                                      </span>
                                    )}
                                </td>
                                <td className="px-1.5 py-1 text-muted-foreground">
                                  {auto ? auto.totalAnalyzed : "—"}
                                </td>
                                <td className="px-1.5 py-1 text-muted-foreground">
                                  {auto
                                    ? `${auto.directSuccessRate}%/${auto.recoveredSuccessRate}%/${auto.manualDependencyRate}%`
                                    : "—"}
                                </td>
                                <td className="px-1.5 py-1 text-muted-foreground">
                                  {hitTest
                                    ? `${hitTest.notTargetable}/${visibleTested(hitTest)}`
                                    : "—"}
                                </td>
                                <td className="px-1.5 py-1 text-muted-foreground">
                                  {page.result
                                    ? page.result.score !== null
                                      ? `${page.result.score}/100`
                                      : t(GRADE_META[page.result.grade].label)
                                    : "—"}
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              <p className="text-[11px] text-muted-foreground">
                {t("domHealth.lastChecked", {
                  time: new Date(appOutcome.timestamp).toLocaleTimeString(),
                })}
              </p>
            </div>
          )}
        </div>
      )}
      {(hasResult || probeReport) && (
        <div className="border-t px-3 py-1.5">
          <ValidationBundleExport
            page={outcome}
            application={appOutcome}
            probe={probeReport}
            thresholdOverrides={thresholdOverrides}
          />
        </div>
      )}
      {developerTools && target.tabId && (
        <RouteProbePanel tabId={target.tabId} onReport={setProbeReport} />
      )}
    </div>
  );
}
