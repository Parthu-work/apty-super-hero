import {
  type DomConfigReport,
  type DomConfigRule,
  renderDomConfigMarkdown,
  toAptyDomConfig,
} from "@apty/browser-runtime/apty/dom-config/index";
import { Button } from "@apty/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@apty/ui/components/ui/dropdown-menu";
import { useTranslation } from "@apty/ui/i18n/context";
import type { I18nContextValue } from "@apty/ui/i18n/types";
import { copyText } from "@apty/ui/lib/clipboard";
import {
  ChevronDownIcon,
  CopyIcon,
  FileCodeIcon,
  FileJsonIcon,
  FileTextIcon,
} from "lucide-react";
import {
  download,
  exportedReport,
  exportFileName,
  isRuleIncluded,
  type RuleChoices,
} from "./copy-format";
import { coverageTableText } from "./coverage-view";
import { iframesTableText } from "./iframes-view";
import { partialTableText } from "./partial-selectors-view";
import { useAnnounce } from "./report-parts";
import { ruleTableText, TARGET_LABEL } from "./rules-view";
import { settingsTableText } from "./settings-view";

type Translate = I18nContextValue["t"];

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
    ...(report.partialSelectors.length
      ? [
          `${t("domConfig.partial.title")}\n${partialTableText(t, report.partialSelectors)}`,
        ]
      : []),
    `${t("domConfig.settings.title")}\n${settingsTableText(t, report)}`,
    ...(report.iframes.length
      ? [`${t("domConfig.tabs.iframes")}\n${iframesTableText(t, report)}`]
      : []),
    `${t("domConfig.tabs.coverage")}\n${coverageTableText(t, report)}`,
  ].join("\n\n");
}

/**
 * "Export results": Markdown, JSON or every section copied as tables,
 * each with the rules the SE left included.
 */
export function ExportMenu({
  report,
  choices,
  onExported,
}: {
  report: DomConfigReport;
  choices: RuleChoices;
  /** After a successful export or copy, so the results read as exported. */
  onExported: () => void;
}) {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const exported = () => exportedReport(report, choices);
  // Non-modal: a modal menu hides the rest of the page with aria-hidden
  // while focusable controls stay inside it (axe aria-hidden-focus).
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="lg" className="w-full">
          {t("domConfig.page.exportResults")}
          <ChevronDownIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56">
        <DropdownMenuItem
          onSelect={() => {
            download(
              renderDomConfigMarkdown(exported()),
              exportFileName(report.applicationName, "md"),
              "text/markdown",
            );
            onExported();
          }}
        >
          <FileTextIcon aria-hidden="true" />
          {t("domConfig.page.markdown")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            download(
              JSON.stringify(exported(), null, 2),
              exportFileName(report.applicationName, "json"),
              "application/json",
            );
            onExported();
          }}
        >
          <FileCodeIcon aria-hidden="true" />
          {t("domConfig.page.json")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            download(
              JSON.stringify(toAptyDomConfig(exported()), null, 2),
              exportFileName(report.applicationName, "apty.json"),
              "application/json",
            );
            onExported();
          }}
        >
          <FileJsonIcon aria-hidden="true" />
          {t("domConfig.page.aptyJson")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            if (await copyText(allTables(t, report, choices))) {
              onExported();
              announce(t("domConfig.page.copiedAll"));
            }
          }}
        >
          <CopyIcon aria-hidden="true" />
          {t("domConfig.page.copyAll")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
