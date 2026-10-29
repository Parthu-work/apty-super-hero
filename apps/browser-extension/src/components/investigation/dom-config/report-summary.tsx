import type { DomConfigReport } from "@apty/browser-runtime/apty/dom-config/index";
import type { I18nContextValue } from "@apty/ui/i18n/types";
import { conditionLabel } from "./copy-format";
import type { CompletedCapture } from "./dom-config-store";

type Translate = I18nContextValue["t"];

export function settingValues(t: Translate, report: DomConfigReport) {
  return {
    attributePriority: report.attributePriority.value,
    debounce: t("domConfig.milliseconds", { value: report.debounce.value }),
    maxZIndex: String(report.maxZIndex.value),
    shadowDom: t(report.shadowDom.value ? "domConfig.on" : "domConfig.off"),
    ignoreEvents: report.ignoreEvents.value.length
      ? report.ignoreEvents.value.map(conditionLabel).join("; ")
      : t("domConfig.noneMeasured"),
  };
}

export function isPartial(outcome: CompletedCapture | null): boolean {
  return Boolean(
    outcome &&
      (outcome.aborted ||
        outcome.limitsReached.maxPages ||
        outcome.limitsReached.maxTotalMs),
  );
}
