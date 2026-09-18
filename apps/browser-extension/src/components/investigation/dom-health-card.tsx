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
  type DomHealthAuditOutcome,
  type DomHealthConfidence,
  type DomHealthGrade,
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
  summary: string;
  strengths: string[];
  risks: DomHealthRisk[];
  recommendations: DomHealthRecommendation[];
  methodology: string[];
}

function SharedEvidenceSections({ result }: { result: SharedEvidence }) {
  const evidenceIsIncomplete = result.evidenceState !== "HEALTHY_EVIDENCE";
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

export function DomHealthCard() {
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
      onProgress: (progress) => setAppProgress(progress),
    });

    setAppOutcome(result);
    setIsAppLoading(false);
    setAppProgress(null);
  }, [target.tabId]);

  const hasResult = outcome !== null || appOutcome !== null;
  const active = view === "application" ? appOutcome : outcome;
  const activeIsLoading = view === "application" ? isAppLoading : isLoading;

  return (
    <div className="mb-2 overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex w-full items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
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
        <Button
          size="sm"
          variant={outcome ? "outline" : "default"}
          disabled={isLoading || isAppLoading || !target.tabId}
          onClick={(e) => {
            e.stopPropagation();
            void runCheck();
          }}
          className="shrink-0"
        >
          {isLoading ? "Checking..." : outcome ? "Recheck" : "Check DOM Health"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isLoading || isAppLoading || !target.tabId}
          onClick={(e) => {
            e.stopPropagation();
            void runApplicationCheck();
          }}
          className="shrink-0"
        >
          {isAppLoading
            ? "Auditing..."
            : appOutcome
              ? "Re-audit App"
              : "Audit Application"}
        </Button>
      </div>

      {expanded && (
        <div className="animate-in fade-in slide-in-from-top-1 border-t px-3 pb-3 pt-2 duration-200">
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
                  {appOutcome.scope === "application"
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
              <p className="text-[11px] text-muted-foreground">
                Coverage is observed, not total — this audit cannot know how
                many states the application actually has (discovery method:{" "}
                {appOutcome.coverage.discoveryMethod}).
              </p>

              <SharedEvidenceSections result={appOutcome} />

              {appOutcome.pages.length > 0 && (
                <details className="text-xs" open>
                  <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                    Pages ({appOutcome.pages.length})
                  </summary>
                  <div className="mt-1.5 max-h-64 overflow-y-auto rounded-md border">
                    <table className="w-full text-left text-[11px]">
                      <thead className="sticky top-0 bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="px-1.5 py-1 font-medium">Page</th>
                          <th className="px-1.5 py-1 font-medium">Status</th>
                          <th className="px-1.5 py-1 font-medium">Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {appOutcome.pages.map((page, i) => (
                          <tr
                            // biome-ignore lint/suspicious/noArrayIndexKey: page URLs can repeat across statuses
                            key={i}
                            className="border-t"
                          >
                            <td className="max-w-[180px] truncate px-1.5 py-1 font-mono text-muted-foreground">
                              {page.title ?? page.url}
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
                              {page.result
                                ? page.result.score !== null
                                  ? `${page.result.score}/100`
                                  : GRADE_META[page.result.grade].label
                                : "—"}
                            </td>
                          </tr>
                        ))}
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
    </div>
  );
}
