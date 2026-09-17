/**
 * Apty DOM Health card — a persistent, always-visible surface above the
 * chat input, independent of whether an investigation is active. Never
 * runs automatically: the audit only starts when the user clicks "Check
 * DOM Health" / "Recheck".
 *
 * Renders the evidence-driven report produced by `runDomHealthAudit`:
 * every number shown here came from live selector generation/verification,
 * cross-snapshot stability tracking, and hit testing performed in-page —
 * this component only displays it, it never computes or adjusts a score.
 *
 * Calls `runDomHealthAudit` directly from `@aipexstudio/browser-runtime` —
 * the same function the `run_dom_health_audit` agent tool calls — so the
 * button works without any agent/LLM turn, and always reports the same
 * deterministic result either way.
 */
import { useChatContext } from "@aipexstudio/aipex-react/components/chatbot";
import { Button } from "@aipexstudio/aipex-react/components/ui/button";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import {
  type DomHealthAuditOutcome,
  type DomHealthConfidence,
  type DomHealthGrade,
  type DomHealthMetricKey,
  type DomHealthRisk,
  runDomHealthAudit,
} from "@aipexstudio/browser-runtime";
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

export function DomHealthCard() {
  const { sessionId } = useChatContext();
  const target = useCurrentTarget(sessionId);
  const [isLoading, setIsLoading] = useState(false);
  const [outcome, setOutcome] = useState<DomHealthAuditOutcome | null>(null);
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

  const hasResult = outcome !== null;

  return (
    <div className="mb-2 overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex w-full items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
          aria-label={`DOM Health: ${outcome?.available ? `${outcome.score} out of 100, ${GRADE_META[outcome.grade].label}` : outcome ? "unavailable" : "not checked yet"}. Click to ${expanded ? "collapse" : "expand"}.`}
        >
          <ScanSearchIcon
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            DOM Health
          </span>
          {outcome?.available && (
            <span
              className={cn(
                "shrink-0 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium",
                GRADE_META[outcome.grade].badgeClassName,
              )}
            >
              {outcome.score}/100 · {GRADE_META[outcome.grade].label}
            </span>
          )}
          {outcome && !outcome.available && (
            <span
              className={cn(
                "shrink-0 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium",
                toneBadgeClass("danger"),
              )}
            >
              Unavailable
            </span>
          )}
          {!outcome && !isLoading && (
            <span className="truncate text-xs text-muted-foreground">
              Not checked yet
            </span>
          )}
          {isLoading && (
            <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
              <Loader2Icon
                className="size-3 shrink-0 animate-spin"
                aria-hidden="true"
              />
              <span className="truncate">{LOADING_STAGES[stageIndex]}</span>
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
          variant={hasResult ? "outline" : "default"}
          disabled={isLoading || !target.tabId}
          onClick={(e) => {
            e.stopPropagation();
            void runCheck();
          }}
          className="shrink-0"
        >
          {isLoading
            ? "Checking..."
            : hasResult
              ? "Recheck"
              : "Check DOM Health"}
        </Button>
      </div>

      {expanded && (
        <div className="animate-in fade-in slide-in-from-top-1 border-t px-3 pb-3 pt-2 duration-200">
          {!outcome && !isLoading && (
            <p className="py-2 text-xs text-muted-foreground">
              Assess how reliably Apty-style element selection could target this
              page: real selector generation, live uniqueness/stability
              verification, and hit testing — not a generic DOM statistic.
              Nothing runs until you click "Check DOM Health".
            </p>
          )}

          {isLoading && (
            <p className="py-2 text-xs text-muted-foreground">
              Taking three DOM snapshots over a few seconds and verifying
              selectors live against the page — this takes a few seconds.
            </p>
          )}

          {outcome && !outcome.available && (
            <div className="space-y-1 py-1">
              <p className="text-sm text-foreground">
                Unable to audit this page.
              </p>
              <p className="text-xs text-muted-foreground">{outcome.error}</p>
            </div>
          )}

          {outcome?.available && (
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
              </div>

              <p className="text-xs text-muted-foreground">{outcome.summary}</p>

              <div className="rounded-md border bg-muted/30 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Manual Selector Dependency
                  </span>
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold",
                      toneTextClass(
                        outcome.manualSelectorDependency > 30
                          ? "danger"
                          : outcome.manualSelectorDependency > 15
                            ? "warning"
                            : "success",
                      ),
                    )}
                  >
                    {outcome.manualSelectorDependency}%
                  </span>
                </div>
              </div>

              <div>
                <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Metrics
                </h4>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {METRIC_ORDER.map((key) => {
                    const score = outcome.metrics[key];
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

              {outcome.strengths.length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    What's working well
                  </h4>
                  <ul className="space-y-1 text-xs text-foreground">
                    {outcome.strengths.map((s) => (
                      <li key={s} className="flex items-start gap-1.5">
                        <span className="text-success">✓</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {outcome.risks.length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Risks
                  </h4>
                  <ul className="space-y-1.5">
                    {outcome.risks.map((risk) => (
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
                            <p className="font-medium text-foreground">
                              {risk.title}
                            </p>
                            <p className="text-muted-foreground">
                              {risk.evidence}
                            </p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {outcome.recommendations.length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Recommendations
                  </h4>
                  <ul className="space-y-1.5">
                    {outcome.recommendations.map((rec) => (
                      <li key={rec.id} className="text-xs">
                        <p className="font-medium text-foreground">
                          {rec.title}
                        </p>
                        <p className="text-muted-foreground">{rec.detail}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

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
                  <dt>Iframes</dt>
                  <dd className="text-right font-mono">
                    {outcome.metadata.iframeCount}
                  </dd>
                  <dt>Shadow roots</dt>
                  <dd className="text-right font-mono">
                    {outcome.metadata.shadowRootCount}
                  </dd>
                </dl>
              </details>

              <details className="text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                  How was this score calculated?
                </summary>
                <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-muted-foreground">
                  {outcome.methodology.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </details>

              <p className="text-[11px] text-muted-foreground">
                Last checked: {new Date(outcome.timestamp).toLocaleTimeString()}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
