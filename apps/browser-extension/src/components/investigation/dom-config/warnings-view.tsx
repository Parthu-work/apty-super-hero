import type { DomConfigReport } from "@apty/browser-runtime/apty/dom-config/index";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import { CameraIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { toneTextClass } from "../tone-classes";
import { pathOf } from "./copy-format";
import { Wrapped } from "./report-parts";

type ReportWarning = DomConfigReport["warnings"][number];

/** Warn-severity first, then by the engine's order. */
function sortedWarnings(report: DomConfigReport): ReportWarning[] {
  return [...report.warnings].sort(
    (a, b) => Number(b.severity === "warn") - Number(a.severity === "warn"),
  );
}

export function WarningIcon({ warning }: { warning: ReportWarning }) {
  return warning.severity === "warn" ? (
    <TriangleAlertIcon
      className={cn("mt-0.5 size-3 shrink-0", toneTextClass("warning"))}
      aria-hidden="true"
    />
  ) : (
    <InfoIcon
      className="mt-0.5 size-3 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
  );
}

export function WarningsView({
  report,
  onCaptureAnother,
  canCapture,
}: {
  report: DomConfigReport;
  /** Opens manual capture with the page's name filled in. */
  onCaptureAnother: (pageLabel: string) => void;
  canCapture: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 pt-1 text-xs">
      <section
        aria-label={t("domConfig.warningsTitle")}
        className="space-y-1.5"
      >
        <h4 className="font-medium text-foreground">
          {t("domConfig.warningsTitle")} ({report.warnings.length})
        </h4>
        {report.warnings.length === 0 && (
          <p className="text-foreground">{t("domConfig.warnings.none")}</p>
        )}
        <ul className="space-y-1.5">
          {sortedWarnings(report).map((warning) => (
            <li
              key={warning.code}
              className="flex items-start gap-1.5 rounded-md border px-2 py-1.5"
            >
              <WarningIcon warning={warning} />
              <div className="min-w-0 space-y-0.5">
                <p className="text-foreground">
                  <span className="sr-only">
                    {t(
                      warning.severity === "warn"
                        ? "domConfig.warnings.warn"
                        : "domConfig.warnings.info",
                    )}
                    :{" "}
                  </span>
                  <span className="font-mono">{warning.code}</span>:{" "}
                  {warning.message}
                </p>
                {(warning.count > 0 || warning.pages.length > 0) && (
                  <p className="text-muted-foreground">
                    {[
                      warning.count > 0 &&
                        t("domConfig.warnings.count", { count: warning.count }),
                      warning.pages.length > 0 &&
                        t("domConfig.rules.pages", {
                          pages: warning.pages.map(pathOf).join(", "),
                        }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label={t("domConfig.warnings.weakSelectors")}
        className="space-y-1.5"
      >
        <h4 className="font-medium text-foreground">
          {t("domConfig.warnings.weakSelectors")} ({report.weakSelectors.length}
          )
        </h4>
        <p className="text-muted-foreground">
          {t("domConfig.warnings.weakSelectorsHint")}
        </p>
        <ul className="space-y-1">
          {report.weakSelectors.map((weak) => (
            <li
              key={weak.selector}
              className="flex flex-wrap items-baseline gap-x-2 rounded-md border px-2 py-1"
            >
              <Wrapped className="font-mono text-foreground">
                {weak.selector}
              </Wrapped>
              <span className="text-muted-foreground">
                {t("domConfig.warnings.perPage", { count: weak.maxPerPage })}
                {` · ${t("domConfig.rules.pages", {
                  pages: weak.pages.map(pathOf).join(", "),
                })}`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label={t("domConfig.warnings.unready")}
        className="space-y-1.5"
      >
        <h4 className="font-medium text-foreground">
          {t("domConfig.warnings.unready")} ({report.unreadyPages.length})
        </h4>
        <p className="text-foreground">
          {t("domConfig.warnings.singleRunContribution")}
        </p>
        <ul className="space-y-1">
          {report.unreadyPages.map((page) => (
            <li
              key={page.pageId}
              className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md border px-2 py-1"
            >
              <span className="min-w-0 text-foreground">
                <Wrapped className="font-mono">{pathOf(page.label)}</Wrapped>
                {" · "}
                {t(
                  page.reason === "single-run"
                    ? "domConfig.warnings.reason.singleRun"
                    : "domConfig.warnings.reason.unreliable",
                )}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 gap-1 px-1.5 text-[11px]"
                disabled={!canCapture}
                aria-label={t("domConfig.warnings.captureAnotherAria", {
                  page: pathOf(page.label),
                })}
                onClick={() => onCaptureAnother(page.label)}
              >
                <CameraIcon className="size-3" aria-hidden="true" />
                {t("domConfig.warnings.captureAnother")}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
