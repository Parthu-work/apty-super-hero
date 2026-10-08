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
  type DomHealthAuditOutcome,
  type DomHealthConfidence,
  type DomHealthGrade,
  type DomHealthMetricDetails,
  type DomHealthMetricKey,
  type DomHealthMetrics,
  type DomHealthRecommendation,
  type DomHealthRisk,
  type PageAuditRecord,
  runApplicationDomHealthAudit,
  runDomHealthAudit,
} from "@apty/browser-runtime";
import { useChatContext } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import { cn } from "@apty/ui/lib/utils";
import { ChevronDownIcon, Loader2Icon, ScanSearchIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RouteProbePanel } from "./route-probe-panel";
import type { StatusMeta } from "./status-meta";
import { toneBadgeClass, toneDotClass, toneTextClass } from "./tone-classes";
import { useCurrentTarget } from "./use-current-target";

const LOADING_STAGES = [
  "Scanning DOM...",
  "Generating selector candidates...",
  "Testing selector uniqueness...",
  "Testing selector stability...",
  "Running hit tests...",
  "Building report...",
];

const GRADE_META: Record<
  DomHealthGrade,
  { label: string; badgeClassName: string }
> = {
  EXCELLENT: {
    label: "EXCELLENT",
    badgeClassName: "border-transparent bg-success text-success-foreground",
  },
  GOOD: {
    label: "GOOD",
    badgeClassName: "border-transparent bg-success/20 text-success",
  },
  FAIR: {
    label: "FAIR",
    badgeClassName: "border-warning/40 bg-transparent text-warning",
  },
  NEEDS_ATTENTION: {
    label: "NEEDS ATTENTION",
    badgeClassName: "border-transparent bg-warning/20 text-warning",
  },
  HIGH_RISK: {
    label: "HIGH RISK",
    badgeClassName:
      "border-transparent bg-destructive text-destructive-foreground",
  },
  // Deliberately NOT green/red/any tone that reads as "healthy" or
  // "unhealthy" — there is no score behind this grade at all (see
  // EvidenceState). A neutral, clearly-different treatment so this can
  // never be mistaken for a passing or failing result.
  NOT_ASSESSED: {
    label: "NOT ASSESSED",
    badgeClassName: "border-muted-foreground/40 bg-muted text-muted-foreground",
  },
};

const EVIDENCE_STATE_LABEL: Record<string, string> = {
  HEALTHY_EVIDENCE: "Full evidence",
  PARTIAL_EVIDENCE: "Partial evidence — some frames could not be inspected",
  NO_EVIDENCE: "No interactive elements found",
  INACCESSIBLE: "No elements found, and coverage is incomplete",
  INCOMPLETE_EVIDENCE:
    "Application coverage incomplete — real states/navigation candidates were never explored, or a backtracking restoration failed",
  FAILED: "Could not be inspected at all",
  NOT_ASSESSED: "Not assessed",
};

const CONFIDENCE_LABEL: Record<DomHealthConfidence, string> = {
  HIGH: "High confidence",
  MEDIUM: "Medium confidence",
  LOW: "Low confidence",
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

const METRIC_LABELS: Record<DomHealthMetricKey, string> = {
  automaticSelection: "Automatic Selection",
  selectorStability: "Selector Stability",
  recoveryEfficacy: "Recovery Efficacy",
  selectorComplexity: "Selector Complexity",
  ambiguityRisk: "Ambiguity/Wrong-Target Risk",
  hitTestTargetability: "Hit-Test Targetability",
  domVolatility: "DOM Volatility",
  accessibilitySignal: "Accessibility Signal",
};

const OUTCOME_LABELS: Record<string, string> = {
  DIRECT_SUCCESS: "Direct",
  RECOVERED_BY_IGNORE: "Recovered (ignore)",
  RECOVERED_BY_PARTIAL: "Recovered (partial)",
  RECOVERED_BY_CONTEXT: "Recovered (context)",
  POSITIONAL_ONLY: "Manual likely (positional)",
  AMBIGUOUS: "Manual likely (ambiguous)",
  WRONG_TARGET: "Manual likely (wrong target)",
  NOT_RESOLVED: "Manual likely (unresolved)",
  INACCESSIBLE: "Inaccessible",
};

const DISCOVERY_MODE_DESCRIPTION: Record<ApplicationDiscoveryMode, string> = {
  page: "Audits ONLY the current page/state — no navigation, no clicking, nothing else visited.",
  "application-safe":
    "Discovers other same-origin pages via real <a href> links only, and DETECTS (never clicks) menu/tab/tree-style controls with no real href.",
  "application-deep":
    "Additionally CLICKS detected safe navigation controls to explore same-URL, menu-driven application states — a real click on the live application.",
};

const DISCOVERY_MODE_LABEL: Record<ApplicationDiscoveryMode, string> = {
  page: "Current page only",
  "application-safe": "Safe link discovery",
  "application-deep": "Deep state discovery",
};

const DISCOVERY_METHOD_LABEL: Record<string, string> = {
  "single-page-only": "Current page only (no discovery)",
  "anchor-links": "Safe link discovery",
  "anchor-links+navigation-controls": "Deep state discovery",
};

const PAGE_STATUS_LABELS: Record<PageAuditRecord["status"], string> = {
  completed: "Audited",
  failed: "Failed",
  "skipped-unsafe": "Skipped (unsafe)",
  "skipped-cross-origin": "Skipped (cross-origin)",
  "skipped-duplicate": "Skipped (duplicate)",
  "not-discovered": "Detected, not explored",
};

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
}

function SharedEvidenceSections({ result }: { result: SharedEvidence }) {
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
          Evidence:{" "}
          {EVIDENCE_STATE_LABEL[result.evidenceState] ?? result.evidenceState}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{result.summary}</p>

      {/* Never let a recovered resolution look identical to a direct one, and
          never let hit-test/accessibility failures hide behind a high
          aggregate score (spec sections 9-11). */}
      {auto && auto.totalAnalyzed > 0 && (
        <div className="rounded-md border bg-muted/30 px-2.5 py-2">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Automatic Selection Breakdown
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
              <div className="text-[10px] text-muted-foreground">Direct</div>
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
              <div className="text-[10px] text-muted-foreground">Recovered</div>
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
              <div className="text-[10px] text-muted-foreground">Manual</div>
            </div>
          </div>
        </div>
      )}

      {hitTest && hitTest.tested > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-2 text-xs">
          <span className="text-muted-foreground">Hit-Test Failures</span>
          <span
            className={cn(
              "font-mono font-semibold",
              toneTextClass(
                hitTest.occludedOrHidden / hitTest.tested > 0.3
                  ? "danger"
                  : hitTest.occludedOrHidden > 0
                    ? "warning"
                    : "success",
              ),
            )}
          >
            {hitTest.occludedOrHidden}/{hitTest.tested}
          </span>
        </div>
      )}

      {a11y && a11y.totalInteractive > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-2 text-xs">
          <span className="text-muted-foreground">
            Missing Accessible Names
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
            Manual Selector Dependency
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

      <p className="text-[11px] text-muted-foreground">
        Selector Configuration:{" "}
        {result.selectorConfiguration?.source === "customer"
          ? "Customer Apty DES configuration"
          : "Default/reconstructed DES configuration"}
        {result.selectorConfiguration?.profile &&
          ` + audit profile ${result.selectorConfiguration.profile}`}
      </p>

      <div>
        <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Metrics
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
                  {METRIC_LABELS[key]}
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
            What's working well
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
            Risks
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
            Recommendations
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
          How was this score calculated?
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

export function DomHealthCard({
  developerTools = false,
}: {
  /** Settings → Troubleshooting → Developer tools: shows the route probe. */
  developerTools?: boolean;
}) {
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
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (stageTimerRef.current) clearInterval(stageTimerRef.current);
    },
    [],
  );

  const runCheck = useCallback(async () => {
    if (!target.tabId) return;
    setView("page");
    setIsLoading(true);
    setExpanded(true);
    setStageIndex(0);
    stageTimerRef.current = setInterval(() => {
      setStageIndex((i) => (i + 1) % LOADING_STAGES.length);
    }, 700);

    const result = await runDomHealthAudit(target.tabId);

    if (stageTimerRef.current) {
      clearInterval(stageTimerRef.current);
      stageTimerRef.current = null;
    }
    setOutcome(result);
    setIsLoading(false);
  }, [target.tabId]);

  const runApplicationCheck = useCallback(async () => {
    if (!target.tabId) return;
    setView("application");
    setIsAppLoading(true);
    setExpanded(true);
    setAppProgress(null);

    const result = await runApplicationDomHealthAudit(target.tabId, {
      discoveryMode,
      onProgress: (progress) => setAppProgress(progress),
    });

    setAppOutcome(result);
    setIsAppLoading(false);
    setAppProgress(null);
  }, [target.tabId, discoveryMode]);

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
          aria-label={`DOM Health: ${active?.available ? (active.score !== null ? `${active.score} out of 100, ${GRADE_META[active.grade].label}` : `not assessed — ${EVIDENCE_STATE_LABEL[active.evidenceState] ?? active.evidenceState}`) : active ? "unavailable" : "not checked yet"}. Click to ${expanded ? "collapse" : "expand"}.`}
        >
          <ScanSearchIcon
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            DOM Health
          </span>
          {active?.available && (
            <span
              className={cn(
                "shrink-0 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium",
                GRADE_META[active.grade].badgeClassName,
              )}
            >
              {active.score !== null
                ? `${active.score}/100 · ${GRADE_META[active.grade].label}`
                : GRADE_META[active.grade].label}
            </span>
          )}
          {active && !active.available && (
            <span
              className={cn(
                "shrink-0 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium",
                toneBadgeClass("danger"),
              )}
            >
              Unavailable
            </span>
          )}
          {!active && !activeIsLoading && (
            <span className="truncate text-xs text-muted-foreground">
              Not checked yet
            </span>
          )}
          {activeIsLoading && view === "page" && (
            <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
              <Loader2Icon
                className="size-3 shrink-0 animate-spin"
                aria-hidden="true"
              />
              <span className="truncate">{LOADING_STAGES[stageIndex]}</span>
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
                  ? `Auditing page ${appProgress.pageIndex + 1}...`
                  : appProgress?.phase === "discovering-links"
                    ? "Discovering pages..."
                    : "Starting application audit..."}
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
            disabled={isLoading || isAppLoading || !target.tabId}
            onClick={(e) => {
              e.stopPropagation();
              void runCheck();
            }}
            aria-label={
              isLoading
                ? "Checking DOM Health..."
                : outcome
                  ? "Recheck DOM Health"
                  : "Check DOM Health"
            }
          >
            {isLoading ? "Checking..." : outcome ? "Recheck" : "Check"}
          </Button>
          <select
            value={discoveryMode}
            onChange={(e) => {
              e.stopPropagation();
              setDiscoveryMode(e.target.value as ApplicationDiscoveryMode);
            }}
            onClick={(e) => e.stopPropagation()}
            disabled={isLoading || isAppLoading || !target.tabId}
            aria-label="Application discovery mode"
            title={DISCOVERY_MODE_DESCRIPTION[discoveryMode]}
            className="rounded-md border bg-background px-1.5 py-1 text-[11px] text-muted-foreground"
          >
            <option value="page">{DISCOVERY_MODE_LABEL.page}</option>
            <option value="application-safe">
              {DISCOVERY_MODE_LABEL["application-safe"]}
            </option>
            <option value="application-deep">
              {DISCOVERY_MODE_LABEL["application-deep"]}
            </option>
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={isLoading || isAppLoading || !target.tabId}
            onClick={(e) => {
              e.stopPropagation();
              void runApplicationCheck();
            }}
            aria-label={
              isAppLoading
                ? "Auditing application..."
                : appOutcome
                  ? "Re-audit application"
                  : "Audit application"
            }
          >
            {isAppLoading
              ? "Auditing..."
              : appOutcome
                ? "Re-audit"
                : "Audit app"}
          </Button>
        </div>
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
                Current Page
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
                Application
              </button>
            </div>
          )}

          {!active && !activeIsLoading && (
            <p className="py-2 text-xs text-muted-foreground">
              Assess how reliably Apty-style element selection could target this
              page or application: real selector generation, live
              uniqueness/stability verification, and hit testing — not a generic
              DOM statistic. Nothing runs until you click "Check DOM Health" or
              "Audit Application".
            </p>
          )}

          {activeIsLoading && view === "page" && (
            <p className="py-2 text-xs text-muted-foreground">
              Taking three DOM snapshots over a few seconds and verifying
              selectors live against the page — this takes a few seconds.
            </p>
          )}

          {activeIsLoading && view === "application" && (
            <p className="py-2 text-xs text-muted-foreground">
              Discovering same-origin pages from real links already on the page
              (never by clicking anything), then auditing each one in turn —
              this can take up to a few minutes and will navigate this tab
              through several pages.
            </p>
          )}

          {active && !active.available && (
            <div className="space-y-1 py-1">
              <p className="text-sm text-foreground">
                Unable to{" "}
                {view === "application"
                  ? "run the application audit"
                  : "audit this page"}
                .
              </p>
              <p className="text-xs text-muted-foreground">{active.error}</p>
            </div>
          )}

          {view === "page" && outcome?.available && (
            <div className="space-y-3 pt-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{CONFIDENCE_LABEL[outcome.confidence]}</span>
                <span>·</span>
                <span>Scope: Current Page</span>
                <span>·</span>
                <span>{outcome.coverage.snapshotsCompared} snapshots</span>
                <span>·</span>
                <span>
                  {outcome.coverage.elementsAnalyzed} elements analyzed
                </span>
                {outcome.coverage.analysis.capped && (
                  <>
                    <span>·</span>
                    <span className={toneTextClass("warning")}>
                      analysis capped
                    </span>
                  </>
                )}
              </div>
              <p className="text-xs font-medium text-foreground">
                Observed current-page DOM health:{" "}
                {outcome.score !== null
                  ? `${outcome.score}/100`
                  : "NOT ENOUGH EVIDENCE"}{" "}
                — never application-wide health from a single page. For the
                whole application, use "Audit Application".
              </p>

              <SharedEvidenceSections result={outcome} />

              {outcome.elementSamples.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                    Element-level details ({outcome.elementSamples.length})
                  </summary>
                  <div className="mt-1.5 max-h-64 overflow-y-auto rounded-md border">
                    <table className="w-full text-left text-[11px]">
                      <thead className="sticky top-0 bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="px-1.5 py-1 font-medium">Element</th>
                          <th className="px-1.5 py-1 font-medium">Selector</th>
                          <th className="px-1.5 py-1 font-medium">Result</th>
                          <th className="px-1.5 py-1 font-medium">Stability</th>
                          <th className="px-1.5 py-1 font-medium">Hit Test</th>
                        </tr>
                      </thead>
                      <tbody>
                        {outcome.elementSamples.map((el, i) => (
                          <tr
                            // biome-ignore lint/suspicious/noArrayIndexKey: reports have no stable id
                            key={i}
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
                              {OUTCOME_LABELS[el.outcome] ?? el.outcome}
                            </td>
                            <td className="px-1.5 py-1 text-muted-foreground">
                              {el.stability}
                            </td>
                            <td className="px-1.5 py-1 text-muted-foreground">
                              {el.hitTest?.classification ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              <details className="text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                  View technical details
                </summary>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                  <dt>Elements analyzed</dt>
                  <dd className="text-right font-mono">
                    {outcome.metadata.elementsAnalyzed}
                  </dd>
                  <dt>Interactive elements</dt>
                  <dd className="text-right font-mono">
                    {outcome.metadata.interactiveElementsAnalyzed}
                  </dd>
                  <dt>Iframes / frames</dt>
                  <dd className="text-right font-mono">
                    {outcome.iframes.byTag.iframe} /{" "}
                    {outcome.iframes.byTag.frame}
                  </dd>
                  <dt>Shadow roots</dt>
                  <dd className="text-right font-mono">
                    {outcome.metadata.shadowRootCount}
                  </dd>
                  <dt>Frames reached</dt>
                  <dd className="text-right font-mono">
                    {outcome.frameAccessibility.framesAccessible}/
                    {outcome.frameAccessibility.framesTotal}
                  </dd>
                </dl>
              </details>

              <p className="text-[11px] text-muted-foreground">
                Last checked: {new Date(outcome.timestamp).toLocaleTimeString()}
              </p>
            </div>
          )}

          {view === "application" && appOutcome?.available && (
            <div className="space-y-3 pt-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{CONFIDENCE_LABEL[appOutcome.confidence]}</span>
                <span>·</span>
                <span>
                  Scope:{" "}
                  {appOutcome.scopeLabel === "APPLICATION"
                    ? "Application"
                    : "Current Page"}
                </span>
                <span>·</span>
                <span>
                  {appOutcome.coverage.pagesAudited}/
                  {appOutcome.coverage.pagesDiscovered} states audited (
                  {appOutcome.coverage.coveragePercent}% observed coverage)
                </span>
                <span>·</span>
                <span>
                  {appOutcome.coverage.framesInspected}/
                  {appOutcome.coverage.framesDiscovered} frames reached
                </span>
                {appOutcome.coverage.pagesNotDiscovered > 0 && (
                  <>
                    <span>·</span>
                    <span className={toneTextClass("warning")}>
                      {appOutcome.coverage.pagesNotDiscovered} control(s)
                      detected but not explored
                    </span>
                  </>
                )}
              </div>
              <p className="text-xs font-medium text-foreground">
                {appOutcome.scopeLabel === "APPLICATION"
                  ? `Application DOM health: ${appOutcome.score !== null ? `${appOutcome.score}/100` : "NOT ENOUGH EVIDENCE"}`
                  : `Observed current-page DOM health: ${appOutcome.score !== null ? `${appOutcome.score}/100` : "NOT ENOUGH EVIDENCE"}`}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Coverage is observed, not total — this audit cannot know how
                many states the application actually has. Discovery:{" "}
                {DISCOVERY_METHOD_LABEL[appOutcome.coverage.discoveryMethod] ??
                  appOutcome.coverage.discoveryMethod}
                .
              </p>

              {appOutcome.crossStateEvidence &&
                appOutcome.crossStateEvidence.attempted > 0 && (
                  <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-[11px]">
                    <div className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">
                      Cross-State Selector Replay (
                      {appOutcome.crossStateEvidence.statesTested} other state
                      {appOutcome.crossStateEvidence.statesTested === 1
                        ? ""
                        : "s"}{" "}
                      tested)
                    </div>
                    <p className="text-muted-foreground">
                      Of {appOutcome.crossStateEvidence.attempted} element
                      path(s) captured at the seed state and replayed against
                      other discovered states:{" "}
                      {appOutcome.crossStateEvidence.directStable +
                        appOutcome.crossStateEvidence.recoveredStable +
                        appOutcome.crossStateEvidence.positionalStable}{" "}
                      still resolved correctly,{" "}
                      <span className={toneTextClass("danger")}>
                        {appOutcome.crossStateEvidence.wrongTarget} resolved to
                        the wrong element
                      </span>
                      , and {appOutcome.crossStateEvidence.notResolved} resolved
                      to nothing.
                      {(appOutcome.crossStateEvidence.hostChainBroken ?? 0) >
                        0 &&
                        ` ${appOutcome.crossStateEvidence.hostChainBroken} of those stopped at a shadow host before reaching the element.`}
                    </p>
                    {(appOutcome.crossStateEvidence.hostChainBreaks ?? [])
                      .length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                        {appOutcome.crossStateEvidence.hostChainBreaks.map(
                          (b) => (
                            <li key={`${b.frameId}-${b.hop}-${b.hostSelector}`}>
                              Frame {b.frameId}, host {b.hop + 1}:{" "}
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
                    Pages/States ({appOutcome.pages.length}) —{" "}
                    {appOutcome.coverage.pagesAudited} audited,{" "}
                    {appOutcome.coverage.pagesFailed} failed,{" "}
                    {appOutcome.coverage.pagesSkippedUnsafe +
                      appOutcome.coverage.pagesSkippedDuplicate}{" "}
                    skipped, {appOutcome.coverage.pagesNotDiscovered} not
                    explored
                  </summary>
                  <div className="mt-1.5 max-h-96 overflow-y-auto rounded-md border">
                    <table className="w-full text-left text-[11px]">
                      <thead className="sticky top-0 bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="px-1.5 py-1 font-medium">
                            Page/State
                          </th>
                          <th className="px-1.5 py-1 font-medium">Discovery</th>
                          <th className="px-1.5 py-1 font-medium">Status</th>
                          <th className="px-1.5 py-1 font-medium">Elements</th>
                          <th className="px-1.5 py-1 font-medium">
                            Direct/Recovered/Manual
                          </th>
                          <th className="px-1.5 py-1 font-medium">
                            Hit-Test Fail
                          </th>
                          <th className="px-1.5 py-1 font-medium">Score</th>
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
                            const label = page.title ?? page.url;
                            labelCounts.set(
                              label,
                              (labelCounts.get(label) ?? 0) + 1,
                            );
                          }
                          const labelSeen = new Map<string, number>();
                          return appOutcome.pages.map((page, i) => {
                            const label = page.title ?? page.url;
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
                                      ? ` (state ${occurrence})`
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
                                  {PAGE_STATUS_LABELS[page.status]}
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
                                    ? `${hitTest.occludedOrHidden}/${hitTest.tested}`
                                    : "—"}
                                </td>
                                <td className="px-1.5 py-1 text-muted-foreground">
                                  {page.result
                                    ? page.result.score !== null
                                      ? `${page.result.score}/100`
                                      : GRADE_META[page.result.grade].label
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
                Last checked:{" "}
                {new Date(appOutcome.timestamp).toLocaleTimeString()}
              </p>
            </div>
          )}
        </div>
      )}
      {developerTools && target.tabId && (
        <RouteProbePanel tabId={target.tabId} />
      )}
    </div>
  );
}
