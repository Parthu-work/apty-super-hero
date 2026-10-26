import {
  type DomConfigReport,
  type DomConfigRule,
  renderDomConfigMarkdown,
} from "@apty/browser-runtime/apty/dom-config/index";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import type { I18nContextValue } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import { DownloadIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import {
  download,
  exportedReport,
  exportFileName,
  isRuleIncluded,
  type RuleChoices,
} from "./copy-format";
import { CoverageView, coverageTableText } from "./coverage-view";
import type {
  CompletedCapture,
  CoverageKey,
  CoverageMark,
} from "./dom-config-store";
import { IframesView, iframesTableText } from "./iframes-view";
import { CopyButton } from "./report-parts";
import { ReportSummary } from "./report-summary";
import { RulesView, ruleTableText, TARGET_LABEL } from "./rules-view";
import { SettingsView, settingsTableText } from "./settings-view";
import { WarningsView } from "./warnings-view";

type Translate = I18nContextValue["t"];

const TABS = [
  { key: "rules", label: "domConfig.tabs.rules" },
  { key: "settings", label: "domConfig.tabs.settings" },
  { key: "iframes", label: "domConfig.tabs.iframes" },
  { key: "coverage", label: "domConfig.tabs.coverage" },
  { key: "warnings", label: "domConfig.tabs.warnings" },
] as const;

type Tab = (typeof TABS)[number]["key"];

/** The tab an arrow, Home or End key moves to; null for other keys. */
function tabAfter(key: string, tab: Tab): Tab | null {
  const index = TABS.findIndex((t) => t.key === tab);
  const last = TABS.length - 1;
  const next =
    key === "ArrowRight"
      ? (index + 1) % TABS.length
      : key === "ArrowLeft"
        ? (index + last) % TABS.length
        : key === "Home"
          ? 0
          : key === "End"
            ? last
            : null;
  return next === null ? null : TABS[next]!.key;
}

/** Every section of the report as tab-separated tables, included rules only. */
function allTables(
  t: Translate,
  report: DomConfigReport,
  choices: RuleChoices,
): string {
  const included = report.rules.filter((rule) => isRuleIncluded(rule, choices));
  const sections: [string, DomConfigRule[]][] = [
    ...(Object.keys(TARGET_LABEL) as DomConfigRule["target"][]).map(
      (target): [string, DomConfigRule[]] => [
        t(TARGET_LABEL[target]),
        included.filter((r) => r.group === "main" && r.target === target),
      ],
    ),
    [
      t("domConfig.rules.review", {
        count: included.filter((r) => r.group === "review").length,
      }),
      included.filter((r) => r.group === "review"),
    ],
    [
      t("domConfig.rules.recordSwitch"),
      included.filter((r) => r.group === "record-specific"),
    ],
  ];
  return [
    ...sections
      .filter(([, rules]) => rules.length > 0)
      .map(([title, rules]) => `${title}\n${ruleTableText(t, rules)}`),
    `${t("domConfig.settings.title")}\n${settingsTableText(t, report)}`,
    ...(report.iframes.length
      ? [`${t("domConfig.tabs.iframes")}\n${iframesTableText(t, report)}`]
      : []),
    `${t("domConfig.tabs.coverage")}\n${coverageTableText(t, report)}`,
  ].join("\n\n");
}

export function ReportView({
  outcome,
  report,
  choices,
  onChoice,
  onIncludeReview,
  onIncludeRecordSpecific,
  onRerun,
  onClear,
  onMark,
  onCaptureAnother,
  canCapture,
  onExported,
}: {
  /** The last crawl's result; null when the capture holds no crawl. */
  outcome: CompletedCapture | null;
  report: DomConfigReport;
  choices: RuleChoices;
  onChoice: (ruleId: string, included: boolean) => void;
  onIncludeReview: (include: boolean) => void;
  onIncludeRecordSpecific: (include: boolean) => void;
  onRerun: () => void;
  onClear: () => void;
  onMark: (key: CoverageKey, mark: CoverageMark | null) => void;
  onCaptureAnother: (pageLabel: string) => void;
  canCapture: boolean;
  /** After Copy all or an export, so the results read as exported. */
  onExported: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [tab, setTab] = useState<Tab>("rules");
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const onTabKey = (event: KeyboardEvent) => {
    const next = tabAfter(event.key, tab);
    if (!next) return;
    event.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  const exported = () => exportedReport(report, choices);

  return (
    <div className="space-y-3 pt-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <CopyButton
          text={allTables(t, report, choices)}
          what={t("domConfig.copyAll")}
          label={t("domConfig.copyAll")}
          ariaLabel={t("domConfig.copyAllAria")}
          onCopied={onExported}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          aria-label={t("domConfig.exportMarkdownAria")}
          onClick={() => {
            download(
              renderDomConfigMarkdown(exported()),
              exportFileName(report.applicationName, "md"),
              "text/markdown",
            );
            onExported();
          }}
        >
          <DownloadIcon className="size-3" aria-hidden="true" />
          {t("domConfig.exportMarkdown")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          aria-label={t("domConfig.exportJsonAria")}
          onClick={() => {
            download(
              JSON.stringify(exported(), null, 2),
              exportFileName(report.applicationName, "json"),
              "application/json",
            );
            onExported();
          }}
        >
          <DownloadIcon className="size-3" aria-hidden="true" />
          {t("domConfig.exportJson")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          aria-label={t("domConfig.rerunAria")}
          onClick={onRerun}
        >
          <RefreshCwIcon className="size-3" aria-hidden="true" />
          {t("domConfig.rerun")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          aria-label={t("domConfig.clearAria")}
          onClick={onClear}
        >
          <Trash2Icon className="size-3" aria-hidden="true" />
          {t("domConfig.clear")}
        </Button>
      </div>

      <ReportSummary outcome={outcome} report={report} />

      <div
        role="tablist"
        aria-label={t("domConfig.tabs.label")}
        className="flex flex-wrap gap-x-1 border-b"
      >
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            ref={(el) => {
              tabRefs.current[key] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-${key}-tab`}
            aria-selected={tab === key}
            aria-controls={`${id}-${key}-panel`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
            onKeyDown={onTabKey}
            className={cn(
              "-mb-px whitespace-nowrap rounded-t-md border-b-2 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === key
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-${tab}-panel`}
        aria-labelledby={`${id}-${tab}-tab`}
      >
        {tab === "rules" && (
          <RulesView
            report={report}
            choices={choices}
            onChoice={onChoice}
            onIncludeReview={onIncludeReview}
            onIncludeRecordSpecific={onIncludeRecordSpecific}
          />
        )}
        {tab === "settings" && <SettingsView report={report} />}
        {tab === "iframes" && <IframesView report={report} />}
        {tab === "coverage" && <CoverageView report={report} onMark={onMark} />}
        {tab === "warnings" && (
          <WarningsView
            report={report}
            onCaptureAnother={onCaptureAnother}
            canCapture={canCapture}
          />
        )}
      </div>

      <p className="text-xs text-foreground">
        {t("domConfig.notMeasured", {
          list: report.notMeasured
            .map((entry) => `${entry.item}: ${entry.text}`)
            .join(" "),
        })}
      </p>
      <details className="rounded-md border px-2 py-1.5 text-xs">
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
