import type { DomConfigReport } from "@apty/browser-runtime/apty/dom-config/index";
import { useTranslation } from "@apty/ui/i18n/context";
import type { I18nContextValue, TranslationKey } from "@apty/ui/i18n/types";
import type { ReactNode } from "react";
import { type SettingRow, settingsTable } from "./copy-format";
import { BasisBadge, CopyButton, Wrapped } from "./report-parts";
import { settingValues } from "./report-summary";

type Translate = I18nContextValue["t"];

const BASIS_KEY: Record<DomConfigReport["debounce"]["basis"], TranslationKey> =
  {
    measured: "domConfig.basis.measured",
    derived: "domConfig.basis.derived",
    default: "domConfig.basis.default",
  };

function positionText(t: Translate, position: number | null): string {
  return position === null
    ? t("domConfig.settings.notListed")
    : t("domConfig.settings.position", { n: position });
}

function zSource(t: Translate, report: DomConfigReport): string {
  const source = report.maxZIndex.appMaxSource;
  if (!source) return t("domConfig.settings.unknownSource");
  return [
    source.tag,
    source.id ? `#${source.id}` : "",
    source.class ? `.${source.class}` : "",
  ]
    .join("")
    .trim();
}

/** The Settings tab as rows, for the screen and for "Copy as table". */
function settingRows(t: Translate, report: DomConfigReport): SettingRow[] {
  const values = settingValues(t, report);
  const basis = (b: DomConfigReport["debounce"]["basis"]) => t(BASIS_KEY[b]);
  return [
    {
      label: t("domConfig.tiles.attributePriority"),
      value: values.attributePriority,
      basis: basis(report.attributePriority.basis),
      reason: report.attributePriority.reason,
    },
    {
      label: t("domConfig.tiles.debounce"),
      value: values.debounce,
      basis: basis(report.debounce.basis),
      reason: report.debounce.reason,
    },
    {
      label: t("domConfig.tiles.ignoreEvents"),
      value: values.ignoreEvents,
      basis: basis(report.ignoreEvents.basis),
      reason: report.ignoreEvents.reason,
    },
    {
      label: t("domConfig.tiles.shadowDom"),
      value: values.shadowDom,
      basis: basis(report.shadowDom.basis),
      reason: report.shadowDom.reason,
    },
    {
      label: t("domConfig.tiles.maxZIndex"),
      value: values.maxZIndex,
      basis: basis(report.maxZIndex.basis),
      reason: report.maxZIndex.reason,
    },
    {
      label: t("domConfig.settings.containerScoreThreshold"),
      value: t("domConfig.settings.containerValues", {
        reference: report.containerScoreThreshold.referenceConfigValue,
        model: report.containerScoreThreshold.reconstructedModelValue,
      }),
      basis: basis(report.containerScoreThreshold.basis),
      reason: report.containerScoreThreshold.reason,
    },
    {
      label: t("domConfig.settings.clickAdvance"),
      value: t("domConfig.settings.aptyDefault"),
      basis: basis(report.clickAdvance.basis),
      reason: report.clickAdvance.reason,
    },
  ];
}

export function settingsTableText(t: Translate, report: DomConfigReport) {
  return settingsTable(settingRows(t, report), [
    t("domConfig.table.setting"),
    t("domConfig.table.value"),
    t("domConfig.table.basis"),
    t("domConfig.table.reason"),
  ]);
}

function Row({
  label,
  value,
  basis,
  reason,
  children,
}: {
  label: string;
  value: string;
  basis: DomConfigReport["debounce"]["basis"];
  reason: string;
  children?: ReactNode;
}) {
  return (
    <li className="space-y-1 rounded-md border p-2">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <div className="flex items-center gap-1">
          <BasisBadge basis={basis} />
          <CopyButton text={value} what={label} />
        </div>
      </div>
      <Wrapped className="block font-mono text-xs text-foreground">
        {value}
      </Wrapped>
      <p className="text-[11px] text-muted-foreground">
        <Wrapped>{reason}</Wrapped>
      </p>
      {children}
    </li>
  );
}

export function SettingsView({ report }: { report: DomConfigReport }) {
  const { t } = useTranslation();
  const values = settingValues(t, report);
  const priority = report.attributePriority;

  return (
    <section aria-label={t("domConfig.settings.title")} className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <h4 className="text-xs font-semibold text-foreground">
          {t("domConfig.settings.title")}
        </h4>
        <CopyButton
          text={settingsTableText(t, report)}
          what={t("domConfig.settings.title")}
          label={t("domConfig.copyTable")}
          ariaLabel={t("domConfig.copyTableAria", {
            section: t("domConfig.settings.title"),
          })}
        />
      </div>
      <ul className="space-y-1.5">
        <Row
          label={t("domConfig.tiles.attributePriority")}
          value={values.attributePriority}
          basis={priority.basis}
          reason={priority.reason}
        >
          <p className="text-[11px] text-muted-foreground">
            {t("domConfig.settings.defaultOrder", {
              order: priority.defaultPriority.join(","),
            })}
          </p>
          <ul className="space-y-0.5 text-[11px] text-foreground">
            {priority.diff.map((entry) => (
              <li key={entry.name}>
                {t("domConfig.settings.priorityDiff", {
                  name: entry.name,
                  proposed: positionText(t, entry.proposedPosition),
                  default: positionText(t, entry.defaultPosition),
                })}
              </li>
            ))}
          </ul>
        </Row>
        <Row
          label={t("domConfig.tiles.debounce")}
          value={values.debounce}
          basis={report.debounce.basis}
          reason={report.debounce.reason}
        >
          {report.debounce.basis === "derived" && (
            <p className="text-[11px] text-foreground">
              {t("domConfig.settings.heuristic")}
            </p>
          )}
        </Row>
        <Row
          label={t("domConfig.tiles.ignoreEvents")}
          value={values.ignoreEvents}
          basis={report.ignoreEvents.basis}
          reason={report.ignoreEvents.reason}
        />
        <Row
          label={t("domConfig.tiles.shadowDom")}
          value={values.shadowDom}
          basis={report.shadowDom.basis}
          reason={report.shadowDom.reason}
        />
        <Row
          label={t("domConfig.tiles.maxZIndex")}
          value={values.maxZIndex}
          basis={report.maxZIndex.basis}
          reason={report.maxZIndex.reason}
        >
          {report.maxZIndex.appMax !== null && (
            <p className="text-[11px] text-foreground">
              {t("domConfig.settings.appMax", {
                value: report.maxZIndex.appMax,
              })}{" "}
              {t("domConfig.settings.appMaxSource", {
                source: zSource(t, report),
              })}
            </p>
          )}
          <ul className="space-y-0.5 text-[11px] text-foreground">
            {report.maxZIndex.excluded.map((entry) => (
              <li key={`${entry.value}-${entry.source}`}>
                {t("domConfig.settings.excludedZIndex", {
                  value: entry.value,
                  source: entry.source,
                })}
              </li>
            ))}
          </ul>
        </Row>
        <Row
          label={t("domConfig.settings.containerScoreThreshold")}
          value={t("domConfig.settings.containerValues", {
            reference: report.containerScoreThreshold.referenceConfigValue,
            model: report.containerScoreThreshold.reconstructedModelValue,
          })}
          basis={report.containerScoreThreshold.basis}
          reason={report.containerScoreThreshold.reason}
        />
        <Row
          label={t("domConfig.settings.clickAdvance")}
          value={t("domConfig.settings.aptyDefault")}
          basis={report.clickAdvance.basis}
          reason={report.clickAdvance.reason}
        />
      </ul>
    </section>
  );
}
