import {
  type DomConfigReport,
  renderDomConfigMarkdown,
} from "@apty/browser-runtime/apty/dom-config/index";
import { redactToolOutput } from "@apty/browser-runtime/runtime/outbound-sanitizer";
import { currentRedactionMode } from "@apty/browser-runtime/runtime/redaction-mode";
import type { I18nContextValue } from "@apty/ui/i18n/types";
import type { ChatDraft } from "@apty/ui/types";
import { exportedReport, type RuleChoices } from "./copy-format";

/**
 * "Ask about these" (correction 18): the results as the Markdown export
 * writes them (the included rules only, PII-shaped values already
 * hidden), redacted as a tool result is in the current mode, in a
 * removable chip beside an editable draft. Nothing is sent until Send.
 */
export function domConfigHandoff(
  report: DomConfigReport,
  choices: RuleChoices,
  t: I18nContextValue["t"],
): ChatDraft {
  const markdown = renderDomConfigMarkdown(exportedReport(report, choices));
  return {
    text: t("domConfig.page.askDraft"),
    contexts: [
      {
        id: `dom-config-${Date.now()}`,
        type: "custom",
        label: t("domConfig.page.askChip"),
        value: String(redactToolOutput(markdown, currentRedactionMode())),
      },
    ],
  };
}
