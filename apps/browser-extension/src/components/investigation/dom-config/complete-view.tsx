import type { DomConfigReport } from "@apty/browser-runtime/apty/dom-config/index";
import { ListRow } from "@apty/ui/components/ui/list-row";
import { Notice } from "@apty/ui/components/ui/notice";
import { useTranslation } from "@apty/ui/i18n/context";
import type { I18nContextValue, TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import { CircleCheckIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { navigationStore } from "../../../state/navigation-store";
import { toneTextClass } from "../tone-classes";
import { isRuleIncluded } from "./copy-format";
import type { DomConfigState } from "./dom-config-store";
import { isPartial, settingValues } from "./report-summary";
import { ByHandRows, SCOPE_LABEL } from "./setup-view";

type Translate = I18nContextValue["t"];

/** "8 min 41 s", or "41 s" under a minute. */
function durationLabel(ms: number, t: Translate): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0
    ? t("domConfig.page.minSec", { min: minutes, sec: seconds % 60 })
    : t("domConfig.page.sec", { sec: seconds });
}

/** "20 pages · 2 runs each · 8 min 41 s", from what was captured. */
function summaryLine(state: DomConfigState, t: Translate): string {
  const pages = state.capture?.pages.length ?? 0;
  const parts = [
    t(
      pages === 1 ? "domConfig.page.pageCountOne" : "domConfig.page.pageCount",
      { count: pages },
    ),
  ];
  if (state.crawlOptions) {
    parts.push(
      t("domConfig.page.runsEach", {
        count: state.crawlOptions.runsPerState,
      }),
    );
  }
  if (state.crawlMs !== null) parts.push(durationLabel(state.crawlMs, t));
  return parts.join(" · ");
}

const SETTING_ROWS: {
  key: keyof ReturnType<typeof settingValues>;
  label: TranslationKey;
}[] = [
  { key: "attributePriority", label: "domConfig.tiles.attributePriority" },
  { key: "debounce", label: "domConfig.tiles.debounce" },
  { key: "maxZIndex", label: "domConfig.tiles.maxZIndex" },
  { key: "shadowDom", label: "domConfig.tiles.shadowDom" },
  { key: "ignoreEvents", label: "domConfig.tiles.ignoreEvents" },
];

function Caption({ children }: { children: string }) {
  return (
    <h3 className="px-3 text-xs font-medium text-muted-foreground">
      {children}
    </h3>
  );
}

function rulesSummary(state: DomConfigState, report: DomConfigReport) {
  const included = report.rules.filter((rule) =>
    isRuleIncluded(rule, state),
  ).length;
  return { included, total: report.rules.length };
}

/**
 * A finished capture: whether it was exported, what it covered, the six
 * proposed settings (each opening its detail) and the details the old
 * report tabs held.
 */
export function CompleteView({
  state,
  report,
  onRerun,
  onClear,
}: {
  state: DomConfigState;
  report: DomConfigReport;
  onRerun: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const values = settingValues(t, report);
  const rules = rulesSummary(state, report);
  const appIframes = report.iframes.filter(
    (frame) => frame.kind === "application" && frame.needsHandling,
  ).length;
  const toActOn = report.warnings.filter((w) => w.severity === "warn").length;
  const { outcome } = state;

  return (
    <div>
      {state.exportedAt === null ? (
        <Notice tone="warning">{t("domConfig.page.notExported")}</Notice>
      ) : (
        <Notice tone="success">{t("domConfig.page.exported")}</Notice>
      )}
      {outcome && isPartial(outcome) && (
        <Notice tone="warning" className="mt-2">
          {t(
            outcome.aborted
              ? "domConfig.partialStopped"
              : "domConfig.partialLimits",
          )}
        </Notice>
      )}
      {outcome && !outcome.returnedToSeed.success && (
        <Notice tone="info" className="mt-2">
          {t("domConfig.notReturned", {
            reason: outcome.returnedToSeed.reason ?? "",
          })}
        </Notice>
      )}
      {report.unreadyPages.some((p) => p.reason === "single-run") && (
        <Notice tone="info" className="mt-2">
          {t("domConfig.singleRunPages")}
        </Notice>
      )}

      <section className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-card p-4">
        <CircleCheckIcon
          aria-hidden="true"
          className={cn("mt-0.5 size-5 shrink-0", toneTextClass("success"))}
        />
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-title font-semibold text-foreground">
            {t("domConfig.page.completeTitle")}
          </h3>
          <p className="text-small text-muted-foreground">
            {summaryLine(state, t)}
          </p>
          {state.crawlOptions && (
            <p className="text-small text-muted-foreground">
              {t(SCOPE_LABEL[state.crawlOptions.scope])}
            </p>
          )}
        </div>
      </section>

      <section
        aria-label={t("domConfig.page.proposedSettings")}
        className="mt-6 space-y-0.5"
      >
        <Caption>{t("domConfig.page.proposedSettings")}</Caption>
        <ListRow
          label={t("domConfig.tabs.rules")}
          description={t("domConfig.page.rulesIncluded", {
            included: rules.included,
            total: rules.total,
          })}
          chevron
          onClick={() => navigationStore.openSubView("rules")}
        />
        {SETTING_ROWS.map((row) => (
          <ListRow
            key={row.key}
            label={t(row.label)}
            description={<span className="font-mono">{values[row.key]}</span>}
            chevron
            onClick={() => navigationStore.openSubView("proposed")}
          />
        ))}
      </section>

      <section
        aria-label={t("domConfig.page.details")}
        className="mt-6 space-y-0.5"
      >
        <Caption>{t("domConfig.page.details")}</Caption>
        <ListRow
          label={t("domConfig.pagesTitle")}
          description={t(
            report.pages.length === 1
              ? "domConfig.page.pageCountOne"
              : "domConfig.page.pageCount",
            { count: report.pages.length },
          )}
          chevron
          onClick={() => navigationStore.openSubView("pages")}
        />
        <ListRow
          label={t("domConfig.tabs.iframes")}
          description={t("domConfig.counts.iframes", { count: appIframes })}
          chevron
          onClick={() => navigationStore.openSubView("iframes")}
        />
        <ListRow
          label={t("domConfig.tabs.coverage")}
          description={t("domConfig.counts.notCaptured", {
            count: report.coverage.notCaptured.length,
          })}
          chevron
          onClick={() => navigationStore.openSubView("coverage")}
        />
        <ListRow
          label={t("domConfig.tabs.warnings")}
          description={t("domConfig.counts.warnings", {
            count: report.warnings.length,
            warn: toActOn,
          })}
          chevron
          onClick={() => navigationStore.openSubView("warnings")}
        />
      </section>

      <ByHandRows caption="domConfig.addTitle" />

      <section className="mt-6 space-y-0.5">
        <ListRow
          icon={<RefreshCwIcon />}
          label={t("domConfig.rerun")}
          description={t("domConfig.page.rerunBody")}
          onClick={onRerun}
        />
        <ListRow
          icon={<Trash2Icon />}
          label={t("domConfig.page.clearResults")}
          onClick={onClear}
        />
      </section>
    </div>
  );
}
