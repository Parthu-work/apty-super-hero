import type { DomConfigReport } from "@apty/browser-runtime/apty/dom-config/index";
import { useTranslation } from "@apty/ui/i18n/context";
import type { I18nContextValue, TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import { toneTextClass } from "../tone-classes";
import type { CompletedCapture } from "./dom-config-store";
import { BasisBadge, CopyButton, Wrapped } from "./report-parts";

type Translate = I18nContextValue["t"];

interface Tile {
  label: TranslationKey;
  value: string;
  basis: DomConfigReport["debounce"]["basis"];
}

export function settingValues(t: Translate, report: DomConfigReport) {
  return {
    attributePriority: report.attributePriority.value,
    debounce: t("domConfig.milliseconds", { value: report.debounce.value }),
    maxZIndex: String(report.maxZIndex.value),
    shadowDom: t(report.shadowDom.value ? "domConfig.on" : "domConfig.off"),
    ignoreEvents: report.ignoreEvents.value.length
      ? report.ignoreEvents.value.join(", ")
      : t("domConfig.noneMeasured"),
  };
}

function tiles(t: Translate, report: DomConfigReport): Tile[] {
  const values = settingValues(t, report);
  return [
    {
      label: "domConfig.tiles.attributePriority",
      value: values.attributePriority,
      basis: report.attributePriority.basis,
    },
    {
      label: "domConfig.tiles.debounce",
      value: values.debounce,
      basis: report.debounce.basis,
    },
    {
      label: "domConfig.tiles.maxZIndex",
      value: values.maxZIndex,
      basis: report.maxZIndex.basis,
    },
    {
      label: "domConfig.tiles.shadowDom",
      value: values.shadowDom,
      basis: report.shadowDom.basis,
    },
    {
      label: "domConfig.tiles.ignoreEvents",
      value: values.ignoreEvents,
      basis: report.ignoreEvents.basis,
    },
  ];
}

export function isPartial(outcome: CompletedCapture): boolean {
  return (
    outcome.aborted ||
    outcome.limitsReached.maxPages ||
    outcome.limitsReached.maxTotalMs
  );
}

export function ReportSummary({
  outcome,
  report,
}: {
  outcome: CompletedCapture;
  report: DomConfigReport;
}) {
  const { t } = useTranslation();
  const proven = report.rules.filter(
    (r) => r.evidence === "observed_change" || r.evidence === "pattern",
  ).length;
  const review = report.rules.filter((r) => r.group === "review").length;
  const appIframes = report.iframes.filter(
    (f) => f.kind === "application" && f.needsHandling,
  ).length;

  return (
    <div className="space-y-2">
      {isPartial(outcome) && (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-foreground">
          <TriangleAlertIcon
            className={cn("mt-0.5 size-3.5 shrink-0", toneTextClass("warning"))}
            aria-hidden="true"
          />
          {t(
            outcome.aborted
              ? "domConfig.partialStopped"
              : "domConfig.partialLimits",
          )}
        </p>
      )}
      {!outcome.returnedToSeed.success && (
        <p className="text-xs text-foreground">
          {t("domConfig.notReturned", {
            reason: outcome.returnedToSeed.reason ?? "",
          })}
        </p>
      )}
      {report.unreadyPages.some((p) => p.reason === "single-run") && (
        <p className="text-xs text-foreground">
          {t("domConfig.singleRunPages")}
        </p>
      )}
      <ul className="grid grid-cols-1 gap-1.5 min-[400px]:grid-cols-2">
        {tiles(t, report).map((tile) => (
          <li
            key={tile.label}
            className="flex min-w-0 flex-col gap-1 rounded-md border bg-background p-2"
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t(tile.label)}
              </span>
              <CopyButton text={tile.value} what={t(tile.label)} />
            </div>
            <Wrapped className="font-mono text-xs text-foreground">
              {tile.value}
            </Wrapped>
            <BasisBadge basis={tile.basis} />
          </li>
        ))}
      </ul>
      <ul className="space-y-0.5 text-xs text-foreground">
        <li>
          {t("domConfig.counts.rules", {
            count: report.rules.length,
            proven,
            review,
          })}
        </li>
        <li>
          {t("domConfig.counts.warnings", { count: report.warnings.length })}
        </li>
        <li>{t("domConfig.counts.iframes", { count: appIframes })}</li>
        <li>
          {t("domConfig.counts.notCaptured", {
            count: report.coverage.notCaptured.length,
          })}
        </li>
        <li>
          {t("domConfig.counts.covered", {
            count: report.coveredByDefaults.length,
          })}
        </li>
      </ul>
      {report.warnings.length > 0 && (
        <section
          aria-label={t("domConfig.warningsTitle")}
          className="rounded-md border px-2 py-1.5 text-xs"
        >
          <h4 className="font-medium text-foreground">
            {t("domConfig.warningsTitle")}
          </h4>
          <ul className="mt-1 space-y-1">
            {report.warnings.map((warning) => (
              <li key={warning.code} className="flex items-start gap-1.5">
                {warning.severity === "warn" ? (
                  <TriangleAlertIcon
                    className={cn(
                      "mt-0.5 size-3 shrink-0",
                      toneTextClass("warning"),
                    )}
                    aria-hidden="true"
                  />
                ) : (
                  <InfoIcon
                    className="mt-0.5 size-3 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span className="text-foreground">
                  <span className="font-mono">{warning.code}</span>:{" "}
                  {warning.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
