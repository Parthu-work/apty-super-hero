/**
 * DOM Config: one click captures the application's pages several times
 * and ends in the engine's report, shown the way Apty's DOM Settings screen
 * is laid out. Everything shown comes from `runDomConfigCapture` and
 * `buildReportFromCapture`; this card computes no rule or setting itself.
 */
import { useChatContext } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import {
  ChevronDownIcon,
  CircleXIcon,
  LoaderCircleIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { toneTextClass } from "../tone-classes";
import { useCurrentTarget } from "../use-current-target";
import {
  type DomConfigState,
  type DomConfigStore,
  domConfigStore,
  useDomConfigState,
} from "./dom-config-store";
import { actionSentence, PageRows, Stepper } from "./progress-view";
import { AnnouncerProvider } from "./report-parts";
import { isPartial } from "./report-summary";
import { ReportView } from "./report-view";
import { StartPanel } from "./start-panel";
import { useTabLockHolder } from "./tab-lock";
import { usePageSupport } from "./use-page-support";

function useStatus(state: DomConfigState) {
  const { t } = useTranslation();
  switch (state.phase) {
    case "idle":
      return t("domConfig.status.idle");
    case "running":
      return state.current?.phase === "capturing"
        ? t("domConfig.status.runningPage", {
            index: state.current.stateIndex,
            max: state.current.maxStates,
          })
        : t("domConfig.status.running");
    case "stopping":
      return t("domConfig.status.stopping");
    case "report":
      return state.outcome && isPartial(state.outcome)
        ? t("domConfig.status.partialReport")
        : t("domConfig.status.report");
    case "failed":
      return t("domConfig.status.failed");
  }
}

export function DomConfigCard({
  ignoredRoots = [],
  store = domConfigStore,
}: {
  /** Settings → Troubleshooting: overlays to leave out, on top of the built-in list. */
  ignoredRoots?: readonly string[];
  store?: DomConfigStore;
}) {
  const { t } = useTranslation();
  const { sessionId } = useChatContext();
  const target = useCurrentTarget(sessionId);
  const state = useDomConfigState(store);
  const support = usePageSupport(target.tabId);
  const holder = useTabLockHolder(target.tabId);
  const status = useStatus(state);
  const rootRef = useRef<HTMLDivElement>(null);
  const running = state.phase === "running" || state.phase === "stopping";

  useEffect(() => {
    if (state.revealRequest > 0) {
      rootRef.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [state.revealRequest]);

  const disabledReason =
    target.tabId === null
      ? t("domConfig.noTab")
      : support === "restricted"
        ? t("domConfig.restricted")
        : holder === "dom-health"
          ? t("domConfig.lockedByDomHealth")
          : null;

  const start = () => {
    if (target.tabId !== null) void store.start(target.tabId, ignoredRoots);
  };

  return (
    <div
      ref={rootRef}
      className="mb-2 overflow-hidden rounded-lg border bg-card shadow-sm"
    >
      <AnnouncerProvider>
        <div className="flex w-full flex-col gap-1.5 px-3 py-2">
          <button
            type="button"
            onClick={() => store.setExpanded(!state.expanded)}
            className="flex w-full min-w-0 items-center gap-2 text-left"
            aria-expanded={state.expanded}
            aria-label={t("domConfig.toggleLabel", {
              status,
              action: t(
                state.expanded ? "domConfig.collapse" : "domConfig.expand",
              ),
            })}
          >
            <SlidersHorizontalIcon
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("domConfig.title")}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
              {running && (
                <LoaderCircleIcon
                  className="size-3 shrink-0 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              )}
              {state.phase === "failed" && (
                <CircleXIcon
                  className={cn("size-3 shrink-0", toneTextClass("danger"))}
                  aria-hidden="true"
                />
              )}
              <span className="truncate">{status}</span>
            </span>
            <ChevronDownIcon
              className={cn(
                "ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                state.expanded && "rotate-180",
              )}
              aria-hidden="true"
            />
          </button>
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button
                size="sm"
                variant="outline"
                disabled={state.phase === "stopping"}
                onClick={() => store.stop()}
                aria-label={t(
                  state.phase === "stopping"
                    ? "domConfig.stopping"
                    : "domConfig.stopAria",
                )}
              >
                {t(
                  state.phase === "stopping"
                    ? "domConfig.stopping"
                    : "domConfig.stop",
                )}
              </Button>
            ) : (
              state.phase !== "report" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => store.setExpanded(true)}
                  aria-label={t("domConfig.generateAria")}
                >
                  {t("domConfig.generate")}
                </Button>
              )
            )}
          </div>
        </div>

        {state.expanded && (
          <div className="relative max-h-[60vh] overflow-y-auto border-t px-3 pb-3 pt-2 text-xs">
            {state.phase === "failed" && (
              <div className="mb-2 space-y-1 rounded-md border border-destructive/30 p-2">
                <p className="text-sm text-foreground">
                  {t("domConfig.failed")}
                </p>
                <p className="text-xs text-foreground">{state.error}</p>
              </div>
            )}

            {(state.phase === "idle" || state.phase === "failed") && (
              <StartPanel
                options={state.options}
                onChange={(options) => store.setOptions(options)}
                onStart={start}
                disabledReason={disabledReason}
              />
            )}

            {running && (
              <div className="space-y-2 pt-1">
                <Stepper step={state.step} />
                <p className="text-foreground" aria-live="polite">
                  {actionSentence(t, state.current, state.phase === "stopping")}
                </p>
                <PageRows rows={state.rows} />
              </div>
            )}

            {state.phase === "report" && state.outcome && state.report && (
              <div className="space-y-3">
                <ReportView
                  outcome={state.outcome}
                  report={state.report}
                  choices={state}
                  onChoice={(ruleId, included) =>
                    store.setRuleChoice(ruleId, included)
                  }
                  onIncludeReview={(include) => store.setIncludeReview(include)}
                  onIncludeRecordSpecific={(include) =>
                    store.setIncludeRecordSpecific(include)
                  }
                  onRerun={() => store.rerun(ignoredRoots)}
                  onClear={() => store.clear()}
                />
                <PageRows rows={state.rows} />
              </div>
            )}
          </div>
        )}
      </AnnouncerProvider>
    </div>
  );
}
