/**
 * Apty DOM Health card (product spec sections 24-31) — a persistent,
 * always-visible surface above the chat input, independent of whether an
 * investigation is active (unlike `InvestigationSummaryBar`). Never runs
 * automatically: the audit only starts when the user clicks "Check DOM
 * Health" / "Recheck".
 *
 * Calls `runDomHealthAudit` directly from `@aipexstudio/browser-runtime` —
 * the same function the `run_dom_health_audit` agent tool calls — so the
 * button works without any agent/LLM turn, and always reports the same
 * deterministic score either way.
 */
import { useChatContext } from "@aipexstudio/aipex-react/components/chatbot";
import { Button } from "@aipexstudio/aipex-react/components/ui/button";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import {
  type DomHealthAuditOutcome,
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
  "Inspecting DOM...",
  "Analyzing selectors...",
  "Comparing DOM stability...",
  "Calculating Apty readiness...",
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

const METRIC_ORDER: DomHealthMetricKey[] = [
  "selectorQuality",
  "selectorStability",
  "attributeQuality",
  "domStability",
  "iframeAccessibility",
  "shadowDomAccessibility",
  "domComplexity",
  "overlayRisk",
];

const METRIC_LABELS: Record<DomHealthMetricKey, string> = {
  selectorQuality: "Selector Quality",
  selectorStability: "Selector Stability",
  attributeQuality: "Attribute Quality",
  domStability: "DOM Stability",
  iframeAccessibility: "iframe Accessibility",
  shadowDomAccessibility: "Shadow DOM",
  domComplexity: "DOM Complexity",
  overlayRisk: "Overlay Risk",
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
              Assess how suitable this page is for reliable Apty element
              selection — selector quality, stability, DOM structure, and
              overlay risk. Nothing runs until you click "Check DOM Health".
            </p>
          )}

          {isLoading && (
            <p className="py-2 text-xs text-muted-foreground">
              Taking two DOM snapshots a moment apart and comparing them — this
              only takes a second.
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
              <p className="text-xs text-muted-foreground">{outcome.summary}</p>

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
