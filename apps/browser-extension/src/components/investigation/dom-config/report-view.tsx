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
import type { CompletedCapture } from "./dom-config-store";
import { CopyButton } from "./report-parts";
import { ReportSummary } from "./report-summary";
import { RulesView, ruleTableText, TARGET_LABEL } from "./rules-view";
import { SettingsView, settingsTableText } from "./settings-view";

type Translate = I18nContextValue["t"];
type Tab = "rules" | "settings";

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
}: {
  outcome: CompletedCapture;
  report: DomConfigReport;
  choices: RuleChoices;
  onChoice: (ruleId: string, included: boolean) => void;
  onIncludeReview: (include: boolean) => void;
  onIncludeRecordSpecific: (include: boolean) => void;
  onRerun: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [tab, setTab] = useState<Tab>("rules");
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    rules: null,
    settings: null,
  });
  const tabs: { key: Tab; label: string }[] = [
    { key: "rules", label: t("domConfig.tabs.rules") },
    { key: "settings", label: t("domConfig.tabs.settings") },
  ];
  const onTabKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next: Tab = tab === "rules" ? "settings" : "rules";
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
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-[11px]"
          aria-label={t("domConfig.exportMarkdownAria")}
          onClick={() =>
            download(
              renderDomConfigMarkdown(exported()),
              exportFileName(report.applicationName, "md"),
              "text/markdown",
            )
          }
        >
          <DownloadIcon className="size-3" aria-hidden="true" />
          {t("domConfig.exportMarkdown")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-[11px]"
          aria-label={t("domConfig.exportJsonAria")}
          onClick={() =>
            download(
              JSON.stringify(exported(), null, 2),
              exportFileName(report.applicationName, "json"),
              "application/json",
            )
          }
        >
          <DownloadIcon className="size-3" aria-hidden="true" />
          {t("domConfig.exportJson")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-[11px]"
          aria-label={t("domConfig.rerunAria")}
          onClick={onRerun}
        >
          <RefreshCwIcon className="size-3" aria-hidden="true" />
          {t("domConfig.rerun")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-[11px]"
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
        className="flex gap-1 border-b"
      >
        {tabs.map(({ key, label }) => (
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
              "-mb-px rounded-t-md border-b-2 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === key
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-${tab}-panel`}
        aria-labelledby={`${id}-${tab}-tab`}
      >
        {tab === "rules" ? (
          <RulesView
            report={report}
            choices={choices}
            onChoice={onChoice}
            onIncludeReview={onIncludeReview}
            onIncludeRecordSpecific={onIncludeRecordSpecific}
          />
        ) : (
          <SettingsView report={report} />
        )}
      </div>

      <p className="text-[11px] text-foreground">
        {t("domConfig.notMeasured", {
          list: report.notMeasured
            .map((entry) => `${entry.item}: ${entry.text}`)
            .join("; "),
        })}
      </p>
      <details className="rounded-md border px-2 py-1.5 text-[11px]">
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
