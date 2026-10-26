/**
 * DOM Config as a page: set up and start a capture, follow it, read the
 * proposed settings and the details behind them, export them, or add
 * pages by hand. Everything shown comes from `runDomConfigCapture` and
 * `buildReportFromCapture`; this page computes no rule or setting itself.
 */
import type { DomConfigReport } from "@apty/browser-runtime/apty/dom-config/index";
import { useChatContext } from "@apty/ui/components/chatbot";
import { StatusBadge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import { Notice } from "@apty/ui/components/ui/notice";
import { useTranslation } from "@apty/ui/i18n/context";
import { type ReactNode, useId } from "react";
import {
  navigationStore,
  useNavigation,
} from "../../../state/navigation-store";
import { chatHandoff } from "../../../state/chat-handoff";
import { ToolPageShell } from "../../shell/tool-page-shell";
import { useCurrentTarget } from "../use-current-target";
import { domConfigHandoff } from "./ask-about-results";
import { CompleteView } from "./complete-view";
import { CoverageView } from "./coverage-view";
import {
  type DomConfigStore,
  domConfigStore,
  holdsAddedPages,
  useDomConfigState,
} from "./dom-config-store";
import { ExportMenu } from "./export-menu";
import { IframesView } from "./iframes-view";
import { ImportPanel } from "./import-panel";
import { ManualCapture } from "./manual-capture";
import { PageList } from "./page-detail";
import { AnnouncerProvider } from "./report-parts";
import { RulesView } from "./rules-view";
import { RunningView } from "./running-view";
import { SettingsView } from "./settings-view";
import { ByHandRows, SetupBody, StartFooter } from "./setup-view";
import { useTabLockHolder } from "./tab-lock";
import { usePageSupport } from "./use-page-support";
import { WarningsView } from "./warnings-view";

/** What the engine could not measure, and the open questions behind the settings. */
function SettingNotes({ report }: { report: DomConfigReport }) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 space-y-2 text-xs">
      <p className="text-foreground">
        {t("domConfig.notMeasured", {
          list: report.notMeasured
            .map((entry) => `${entry.item}: ${entry.text}`)
            .join(" "),
        })}
      </p>
      <details className="rounded-md border px-2 py-1.5">
        <summary className="cursor-pointer font-medium text-foreground">
          {t("domConfig.openQuestions", { count: report.openQuestions.length })}
        </summary>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-foreground">
          {report.openQuestions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}

export function DomConfigPage({
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
  const { subView } = useNavigation();
  const blockedId = useId();
  const running = state.phase === "running" || state.phase === "stopping";
  const report = state.phase === "report" ? state.report : null;

  const startBlocked =
    target.tabId === null
      ? t("domConfig.noTab")
      : support === "restricted"
        ? t("domConfig.restricted")
        : holder === "dom-health"
          ? t("domConfig.lockedByDomHealth")
          : null;
  const captureBlocked =
    target.tabId === null ? t("domConfig.manual.noTab") : startBlocked;
  const replaceCount = holdsAddedPages(state.capture)
    ? (state.capture?.pages.length ?? 0)
    : 0;

  const start = (replace: boolean) => {
    if (target.tabId === null) return;
    if (subView === "setup") navigationStore.back();
    void store.start(target.tabId, ignoredRoots, { replace });
  };

  const shell = (
    title: string,
    children: ReactNode,
    extra: { trailing?: ReactNode; footer?: ReactNode; hint?: string } = {},
  ) => (
    <AnnouncerProvider>
      <ToolPageShell title={title} {...extra}>
        {children}
      </ToolPageShell>
    </AnnouncerProvider>
  );

  const blockedNotice = startBlocked && (
    <Notice id={blockedId} tone="info" className="mb-4">
      {startBlocked}
    </Notice>
  );

  const setup = (byHand: boolean, before?: ReactNode) => (
    <>
      {before}
      {blockedNotice}
      <SetupBody
        options={state.options}
        onChange={(options) => store.setOptions(options)}
        byHand={
          byHand ? <ByHandRows caption="domConfig.addTitleEmpty" /> : undefined
        }
      />
    </>
  );

  const startFooter = (
    label: "domConfig.page.start" | "domConfig.page.runAgain",
  ) => (
    <StartFooter
      options={state.options}
      startLabel={label}
      disabledReason={startBlocked}
      disabledId={blockedId}
      replaceCount={replaceCount}
      onStart={start}
    />
  );

  if (subView === "capture" && !running) {
    return shell(
      t("domConfig.manual.title"),
      <ManualCapture
        state={state}
        disabledReason={captureBlocked}
        onRequestHandled={store.clearCaptureRequest}
        onCapture={(input) => {
          if (target.tabId !== null) {
            void store.captureCurrent(target.tabId, input, ignoredRoots);
          }
        }}
      />,
    );
  }

  if (subView === "import" && !running) {
    return shell(
      t("domConfig.page.importRuns"),
      <ImportPanel
        state={state}
        disabled={state.capturing}
        onImport={(input) =>
          store.importPage(input, ignoredRoots, target.hostname ?? undefined)
        }
      />,
    );
  }

  if (subView === "setup" && !running) {
    return shell(t("shell.domConfig"), setup(false), {
      footer: startFooter("domConfig.page.start"),
      hint: t("domConfig.memoryOnly"),
    });
  }

  if (report && state.capture) {
    switch (subView) {
      case "rules":
        return shell(
          t("domConfig.tabs.rules"),
          <RulesView
            report={report}
            choices={state}
            onChoice={(ruleId, included) =>
              store.setRuleChoice(ruleId, included)
            }
            onIncludeReview={(include) => store.setIncludeReview(include)}
            onIncludeRecordSpecific={(include) =>
              store.setIncludeRecordSpecific(include)
            }
          />,
        );
      case "proposed":
        return shell(
          t("domConfig.page.proposedSettings"),
          <>
            <SettingsView report={report} />
            <SettingNotes report={report} />
          </>,
        );
      case "pages":
        return shell(
          t("domConfig.pagesTitle"),
          <PageList
            rows={state.rows}
            report={report}
            capture={state.capture}
          />,
        );
      case "iframes":
        return shell(
          t("domConfig.tabs.iframes"),
          <IframesView report={report} />,
        );
      case "coverage":
        return shell(
          t("domConfig.tabs.coverage"),
          <CoverageView
            report={report}
            onMark={(key, mark) =>
              store.setCoverageMark(key, mark, ignoredRoots)
            }
          />,
        );
      case "warnings":
        return shell(
          t("domConfig.tabs.warnings"),
          <WarningsView
            report={report}
            canCapture={!captureBlocked && !state.capturing}
            onCaptureAnother={(pageLabel) => {
              store.requestCapture(pageLabel);
              navigationStore.openSubView("capture");
            }}
          />,
        );
    }
  }

  if (running) {
    const stopping = state.phase === "stopping";
    return shell(t("shell.domConfig"), <RunningView state={state} />, {
      trailing: (
        <StatusBadge tone="info" indicator="spinner">
          {t(stopping ? "jobs.stopping" : "jobs.running")}
        </StatusBadge>
      ),
      footer: (
        <Button
          variant="danger"
          size="lg"
          className="w-full"
          disabled={stopping}
          onClick={() => store.stop()}
        >
          {t(stopping ? "jobs.stopping" : "domConfig.page.stopCapture")}
        </Button>
      ),
      hint: t("domConfig.page.leaveHint"),
    });
  }

  if (report) {
    return shell(
      t("shell.domConfig"),
      <CompleteView
        state={state}
        report={report}
        onRerun={() => store.rerun(ignoredRoots)}
        onClear={() => store.clear()}
      />,
      {
        trailing: (
          <StatusBadge tone="success">
            {t("domConfig.page.complete")}
          </StatusBadge>
        ),
        footer: (
          <div className="space-y-2">
            <ExportMenu
              report={report}
              choices={state}
              onExported={() => store.markExported()}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  chatHandoff.request(domConfigHandoff(report, state, t))
                }
              >
                {t("domConfig.page.ask")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => navigationStore.openSubView("setup")}
              >
                {t("domConfig.page.runAgain")}
              </Button>
            </div>
          </div>
        ),
      },
    );
  }

  if (state.phase === "failed") {
    return shell(
      t("shell.domConfig"),
      setup(
        true,
        <Notice tone="error" className="mb-4" title={t("domConfig.failed")}>
          {state.error}
        </Notice>,
      ),
      {
        trailing: (
          <StatusBadge tone="danger">{t("jobs.couldntFinish")}</StatusBadge>
        ),
        footer: startFooter("domConfig.page.runAgain"),
        hint: t("domConfig.memoryOnly"),
      },
    );
  }

  return shell(t("shell.domConfig"), setup(true), {
    footer: startFooter("domConfig.page.start"),
    hint: t("domConfig.memoryOnly"),
  });
}
