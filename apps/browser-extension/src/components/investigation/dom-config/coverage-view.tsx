import type { DomConfigReport } from "@apty/browser-runtime/apty/dom-config/index";
import { useTranslation } from "@apty/ui/i18n/context";
import type { I18nContextValue, TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import {
  CalendarClockIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
} from "lucide-react";
import { toneTextClass } from "../tone-classes";
import { pathOf, tsv } from "./copy-format";
import type { CoverageKey, CoverageMark } from "./dom-config-store";
import { CopyButton } from "./report-parts";

type Translate = I18nContextValue["t"];
type CoverageStatus = DomConfigReport["coverage"]["items"][number]["status"];

const COVERAGE_LABEL: Record<CoverageKey, TranslationKey> = {
  "entry-forms": "domConfig.coverage.key.entryForms",
  "detail-pages": "domConfig.coverage.key.detailPages",
  "list-grid-pages": "domConfig.coverage.key.listGridPages",
  "modals-dialogs": "domConfig.coverage.key.modalsDialogs",
  popups: "domConfig.coverage.key.popups",
  "dropdown-panels": "domConfig.coverage.key.dropdownPanels",
  tooltips: "domConfig.coverage.key.tooltips",
  "side-panels": "domConfig.coverage.key.sidePanels",
  "print-report-views": "domConfig.coverage.key.printReportViews",
  "embedded-documents": "domConfig.coverage.key.embeddedDocuments",
  "click-only-states": "domConfig.coverage.key.clickOnlyStates",
};

const STATUS: Record<
  CoverageStatus,
  {
    label: TranslationKey;
    icon: typeof CircleCheckIcon;
    tone: "success" | "neutral" | "active" | "warning";
  }
> = {
  captured: {
    label: "domConfig.coverage.status.captured",
    icon: CircleCheckIcon,
    tone: "success",
  },
  "not-applicable": {
    label: "domConfig.coverage.status.notApplicable",
    icon: CircleMinusIcon,
    tone: "neutral",
  },
  planned: {
    label: "domConfig.coverage.status.planned",
    icon: CalendarClockIcon,
    tone: "active",
  },
  "not-captured": {
    label: "domConfig.coverage.status.notCaptured",
    icon: CircleDashedIcon,
    tone: "warning",
  },
};

const MARKS: CoverageMark[] = ["captured", "not-applicable", "planned"];

export function coverageTableText(t: Translate, report: DomConfigReport) {
  return tsv(
    [
      t("domConfig.coverage.state"),
      t("domConfig.coverage.statusHeader"),
      t("domConfig.coverage.candidatesHeader"),
    ],
    report.coverage.items.map((item) => [
      t(COVERAGE_LABEL[item.key]),
      t(STATUS[item.status].label),
      item.candidates.map(pathOf).join(", "),
    ]),
  );
}

export function CoverageView({
  report,
  onMark,
}: {
  report: DomConfigReport;
  onMark: (key: CoverageKey, mark: CoverageMark | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 pt-1 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="text-foreground">{t("domConfig.coverage.intro")}</p>
        <CopyButton
          text={coverageTableText(t, report)}
          what={t("domConfig.tabs.coverage")}
          label={t("domConfig.copyTable")}
          ariaLabel={t("domConfig.copyTableAria", {
            section: t("domConfig.tabs.coverage"),
          })}
        />
      </div>
      <ul className="space-y-1.5">
        {report.coverage.items.map((item) => {
          const status = STATUS[item.status];
          const Icon = status.icon;
          const label = t(COVERAGE_LABEL[item.key]);
          return (
            <li
              key={item.key}
              className="space-y-1 rounded-md border px-2 py-1.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="font-medium text-foreground">{label}</span>
                <span className="inline-flex items-center gap-1 text-foreground">
                  <Icon
                    className={cn("size-3", toneTextClass(status.tone))}
                    aria-hidden="true"
                  />
                  {t(status.label)}
                </span>
              </div>
              <p className="text-muted-foreground">
                {item.candidates.length
                  ? t("domConfig.coverage.candidates", {
                      pages: item.candidates.map(pathOf).join(", "),
                    })
                  : t("domConfig.coverage.noCandidates")}
              </p>
              <label className="flex items-center gap-2 text-foreground">
                <span>{t("domConfig.coverage.mark")}</span>
                <select
                  aria-label={t("domConfig.coverage.markAria", {
                    state: label,
                  })}
                  value={item.status === "not-captured" ? "" : item.status}
                  onChange={(e) =>
                    onMark(
                      item.key,
                      e.target.value ? (e.target.value as CoverageMark) : null,
                    )
                  }
                  className="rounded-md border bg-background px-1.5 py-1 text-xs text-foreground"
                >
                  <option value="">{t("domConfig.coverage.unmarked")}</option>
                  {MARKS.map((mark) => (
                    <option key={mark} value={mark}>
                      {t(STATUS[mark].label)}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
