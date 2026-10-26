import type { I18nContextValue } from "@apty/ui/i18n/types";
import type { ChatDraft } from "@apty/ui/types";
import type { DomHealthScope } from "../dom-health-store";
import {
  type ValidationBundleSources,
  validationBundleJson,
} from "../validation-bundle-export";

/**
 * "Ask about this result" (correction 18): the result the page shows, as
 * the validation bundle's summary (built from an allow-list and redacted,
 * never the raw report or page text), in a removable evidence chip beside
 * an editable draft question. Nothing is sent until the user presses Send,
 * and the chip then reaches the model through the same outbound
 * sanitizer as every request.
 */
export function domHealthHandoff(
  {
    scope,
    page,
    application,
    probe,
    thresholdOverrides,
  }: ValidationBundleSources & { scope: DomHealthScope },
  t: I18nContextValue["t"],
): ChatDraft {
  return {
    text: t("domHealth.page.askDraft"),
    contexts: [
      {
        id: `dom-health-${Date.now()}`,
        type: "custom",
        label: t("domHealth.page.askChip"),
        value: validationBundleJson({
          page: scope === "page" ? page : null,
          application: scope === "application" ? application : null,
          probe,
          thresholdOverrides,
        }),
      },
    ],
  };
}
