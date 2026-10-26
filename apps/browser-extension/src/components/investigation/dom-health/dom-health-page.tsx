import type {
  ApplicationAuditOutcome,
  DomHealthAuditOutcome,
  RouteProbeReport,
} from "@apty/browser-runtime";
import { useChatContext } from "@apty/ui/components/chatbot";
import { StatusBadge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import { ListRow } from "@apty/ui/components/ui/list-row";
import { Notice } from "@apty/ui/components/ui/notice";
import { ProgressBar } from "@apty/ui/components/ui/progress-bar";
import { ScoreRing } from "@apty/ui/components/ui/score-ring";
import { useTranslation } from "@apty/ui/i18n/context";
import type { I18nContextValue } from "@apty/ui/i18n/types";
import { useEffect, useId, useState } from "react";
import {
  navigationStore,
  useNavigation,
} from "../../../state/navigation-store";
import { relativeTime } from "../../shell/relative-time";
import { ToolPageShell } from "../../shell/tool-page-shell";
import { useTabLockHolder } from "../dom-config/tab-lock";
import {
  type DomHealthState,
  type DomHealthStore,
  domHealthStore,
  useDomHealthState,
} from "../dom-health-store";
import { RouteProbePanel } from "../route-probe-panel";
import { useCurrentTarget } from "../use-current-target";
import { ValidationBundleExport } from "../validation-bundle-export";
import { DomHealthBreakdown } from "./dom-health-breakdown";
import {
  CONFIDENCE_LABEL,
  DISCOVERY_MODE_LABEL,
  GRADE,
  LOADING_STAGES,
} from "./dom-health-labels";
import { WhatToCheck } from "./what-to-check";

type Translate = I18nContextValue["t"];
type Available<T> = Extract<T, { available: true }>;

export interface DomHealthPageProps {
  /** Settings → Troubleshooting → Developer tools: shows the route probe. */
  developerTools?: boolean;
  /** Settings → Troubleshooting: overlays to leave out, on top of the built-in list. */
  ignoredRoots?: readonly string[];
  /** Developer tools: threshold overrides for real-tenant validation. */
  thresholdOverrides?: Record<string, number>;
  store?: DomHealthStore;
}

function settingsSummary(state: DomHealthState, t: Translate): string {
  return state.scope === "application"
    ? t("domHealth.page.settingsValue", {
        scope: t("domHealth.page.wholeApp"),
        discovery: t(DISCOVERY_MODE_LABEL[state.discoveryMode]),
      })
    : t("domHealth.page.thisPage");
}

/**
 * "15 of 38 states reached · 1,054 elements" (or the page's analysis
 * coverage), and when the score may still change, a note that says so.
 * Without a score there is nothing to caveat.
 */
function coverage(
  outcome:
    | Available<DomHealthAuditOutcome>
    | Available<ApplicationAuditOutcome>,
  t: Translate,
): { value: number; line: string; note: string | null } {
  const { score } = outcome;
  const confidenceNote = (): string | null =>
    score !== null && outcome.confidence !== "HIGH"
      ? t("domHealth.page.confidenceNote", {
          confidence: t(CONFIDENCE_LABEL[outcome.confidence]),
          score,
        })
      : null;
  if ("pages" in outcome) {
    const { pagesAudited, pagesDiscovered, coveragePercent } = outcome.coverage;
    const elements = outcome.pages.reduce(
      (sum, page) => sum + (page.result?.metadata.elementsAnalyzed ?? 0),
      0,
    );
    const notReached = pagesDiscovered - pagesAudited;
    return {
      value: coveragePercent,
      line: t("domHealth.page.statesReached", {
        reached: pagesAudited,
        discovered: pagesDiscovered,
        elements: elements.toLocaleString(),
      }),
      note:
        score !== null && notReached > 0
          ? t(
              notReached === 1
                ? "domHealth.page.notReachedNoteOne"
                : "domHealth.page.notReachedNote",
              { count: notReached, score },
            )
          : confidenceNote(),
    };
  }
  const { candidatesAnalyzed, candidatesFound, capped } =
    outcome.coverage.analysis;
  return {
    value:
      candidatesFound > 0 ? (candidatesAnalyzed / candidatesFound) * 100 : 100,
    line: t("domHealth.page.elementsAnalyzed", {
      analyzed: candidatesAnalyzed.toLocaleString(),
      found: candidatesFound.toLocaleString(),
    }),
    note:
      score !== null && capped
        ? t("domHealth.page.cappedNote", { score })
        : confidenceNote(),
  };
}

function useStage(running: boolean): number {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!running) return;
    setStage(0);
    const timer = setInterval(
      () => setStage((i) => (i + 1) % LOADING_STAGES.length),
      700,
    );
    return () => clearInterval(timer);
  }, [running]);
  return stage;
}

/**
 * DOM health as a page, on the store: set up and start a check, follow it
 * (and stop an application audit), read the result, open its full
 * breakdown and settings, or export the validation bundle.
 */
export function DomHealthPage({
  developerTools = false,
  ignoredRoots = [],
  thresholdOverrides,
  store = domHealthStore,
}: DomHealthPageProps) {
  const { t } = useTranslation();
  const { sessionId } = useChatContext();
  const target = useCurrentTarget(sessionId);
  const state = useDomHealthState(store);
  const { subView } = useNavigation();
  const [probe, setProbe] = useState<RouteProbeReport | null>(null);
  const stage = useStage(state.running === "page");
  const locked = useTabLockHolder(target.tabId) === "dom-config";
  const lockedId = useId();
  const outcome =
    state.scope === "application" ? state.appOutcome : state.pageOutcome;
  const sources = {
    page: state.pageOutcome,
    application: state.appOutcome,
    probe,
    thresholdOverrides,
  };

  const start = () => {
    if (!target.tabId) return;
    const options = { tabId: target.tabId, ignoredRoots, thresholdOverrides };
    if (state.scope === "application") store.auditApplication(options);
    else store.checkPage(options);
  };

  if (subView === "breakdown") {
    return (
      <ToolPageShell title={t("domHealth.page.breakdown")}>
        <DomHealthBreakdown
          scope={state.scope}
          page={state.pageOutcome}
          application={state.appOutcome}
          developerTools={developerTools}
          tabId={target.tabId}
          onProbe={setProbe}
        />
      </ToolPageShell>
    );
  }

  if (subView === "settings") {
    return (
      <ToolPageShell title={t("domHealth.page.settings")}>
        <WhatToCheck store={store} disabled={state.running !== null} />
        <section className="mt-6 space-y-1">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t("domHealth.page.thresholds")}
          </h3>
          {thresholdOverrides && Object.keys(thresholdOverrides).length > 0 ? (
            <ul className="space-y-0.5 font-mono text-xs text-foreground">
              {Object.entries(thresholdOverrides).map(([name, value]) => (
                <li key={name}>
                  {name} = {value}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("domHealth.page.thresholdsNone")}
            </p>
          )}
        </section>
      </ToolPageShell>
    );
  }

  const exportAction = <ValidationBundleExport {...sources} />;
  const lockedNotice = locked && (
    <Notice id={lockedId} tone="info" className="mb-4">
      {t("domConfig.lockedByDomConfig")}
    </Notice>
  );

  if (state.running) {
    const application = state.running === "application";
    const progress = state.progress;
    return (
      <ToolPageShell
        title={t("shell.domHealth")}
        footer={
          application ? (
            <Button
              variant="danger"
              size="lg"
              className="w-full"
              disabled={state.stopping}
              onClick={() => store.stop()}
            >
              {t(state.stopping ? "jobs.stopping" : "domHealth.page.stop")}
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <ScoreRing state="running" label={t("jobs.running")} />
          <h3 className="text-title font-semibold text-foreground">
            {t(
              application
                ? "domHealth.page.auditing"
                : "domHealth.page.checking",
            )}
          </h3>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {application
              ? progress?.phase === "auditing"
                ? t("domHealth.auditingPage", { index: progress.pageIndex + 1 })
                : progress?.phase === "discovering-links"
                  ? t("domHealth.discoveringPages")
                  : t("domHealth.startingAppAudit")
              : t(LOADING_STAGES[stage] ?? "domHealth.loadingStages.scanning")}
          </p>
        </div>
        <Notice tone="info" className="mb-6">
          {t("domHealth.page.keepTabOpen")}
        </Notice>
        <WhatToCheck store={store} disabled />
      </ToolPageShell>
    );
  }

  if (outcome?.available) {
    const grade = GRADE[outcome.grade];
    const cover = coverage(outcome, t);
    return (
      <ToolPageShell
        title={t("shell.domHealth")}
        trailing={exportAction}
        footer={
          <Button
            variant="secondary"
            className="w-full"
            disabled={!target.tabId || locked}
            aria-describedby={locked ? lockedId : undefined}
            onClick={start}
          >
            {t("domHealth.page.checkAgain")}
          </Button>
        }
      >
        {lockedNotice}
        <div className="flex items-center gap-4">
          <ScoreRing
            state={outcome.score === null ? "empty" : "value"}
            value={outcome.score ?? 0}
            tone={grade.tone}
            label={
              outcome.score === null
                ? t("domHealth.page.noScore")
                : t("domHealth.page.scoreLabel", { score: outcome.score })
            }
            caption={
              outcome.score === null ? undefined : t("domHealth.page.outOf100")
            }
          />
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge tone={grade.tone}>{t(grade.label)}</StatusBadge>
              <StatusBadge tone="neutral">
                {t(CONFIDENCE_LABEL[outcome.confidence])}
              </StatusBadge>
            </div>
            <p className="text-small text-muted-foreground">
              {t("domHealth.page.when", {
                scope: t(
                  state.scope === "application"
                    ? "domHealth.page.wholeApp"
                    : "domHealth.page.thisPage",
                ),
                time: relativeTime(outcome.timestamp, t),
              })}
            </p>
          </div>
        </div>

        {"stopped" in outcome && outcome.stopped && (
          <Notice tone="warning" className="mt-4">
            {t("domHealth.page.stoppedNote", {
              count: outcome.coverage.pagesAudited,
            })}
          </Notice>
        )}

        <section
          aria-labelledby="dom-health-coverage"
          className="mt-4 space-y-2 rounded-lg border border-border bg-card p-4"
        >
          <h3
            id="dom-health-coverage"
            className="text-sm font-medium text-foreground"
          >
            {t("domHealth.page.coverage")}
          </h3>
          <ProgressBar
            value={cover.value}
            tone={grade.tone === "neutral" ? "info" : grade.tone}
            aria-label={t("domHealth.page.coverage")}
          />
          <p className="text-sm font-medium text-foreground">{cover.line}</p>
          {cover.note && (
            <p className="text-small text-muted-foreground">{cover.note}</p>
          )}
        </section>

        <div className="mt-2 space-y-0.5">
          <ListRow
            label={t("domHealth.page.breakdown")}
            chevron
            onClick={() => navigationStore.openSubView("breakdown")}
          />
          <ListRow
            label={t("domHealth.page.settings")}
            description={settingsSummary(state, t)}
            chevron
            onClick={() => navigationStore.openSubView("settings")}
          />
        </div>
      </ToolPageShell>
    );
  }

  return (
    <ToolPageShell
      title={t("shell.domHealth")}
      trailing={probe ? exportAction : undefined}
      footer={
        <Button
          size="lg"
          className="w-full"
          disabled={!target.tabId || locked}
          aria-describedby={locked ? lockedId : undefined}
          onClick={start}
        >
          {t(
            state.scope === "application"
              ? "domHealth.page.auditApplication"
              : "domHealth.page.checkThisPage",
          )}
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <ScoreRing state="empty" label={t("domHealth.notCheckedYet")} />
        <h3 className="text-title font-semibold text-foreground">
          {t("domHealth.notCheckedYet")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("domHealth.page.notCheckedBody")}
        </p>
      </div>
      {outcome && !outcome.available && (
        <Notice
          tone="error"
          className="mb-4"
          title={t(
            state.scope === "application"
              ? "domHealth.unableToAuditApp"
              : "domHealth.unableToAuditPage",
          )}
        >
          {outcome.error}
        </Notice>
      )}
      {lockedNotice}
      <WhatToCheck store={store} disabled={false} />
      {developerTools && target.tabId && (
        <div className="mt-6">
          <RouteProbePanel tabId={target.tabId} onReport={setProbe} />
        </div>
      )}
    </ToolPageShell>
  );
}
