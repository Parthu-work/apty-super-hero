import {
  type Context,
  formatContextsForPrompt,
  type OutboundFilter,
} from "@apty/agent-core";
import { privateContexts } from "@apty/browser-runtime/runtime/context-privacy";
import { createOutboundSanitizer } from "@apty/browser-runtime/runtime/outbound-sanitizer";
import { currentRedactionMode } from "@apty/browser-runtime/runtime/redaction-mode";
import { createRequestBudgetFilter } from "@apty/browser-runtime/runtime/request-budget";
import { createRequestReportFilter } from "@apty/browser-runtime/runtime/request-reports";
import { currentValuePolicy } from "@apty/browser-runtime/runtime/value-policy";

/**
 * What runs over every request before it leaves the extension, in order:
 * mask first, so sizes and previews are measured on what would be sent, and
 * report last, so the report describes what is actually sent.
 * Kept apart from the agent hooks so the request-size report can build the
 * same chain without loading the browser runtime.
 */
export function createOutboundFilters(): OutboundFilter[] {
  return [
    createOutboundSanitizer({ getMode: currentRedactionMode }),
    createRequestBudgetFilter(),
    createRequestReportFilter({ getMode: currentRedactionMode }),
  ];
}

/** Attached page and tab contexts, worded under the current URL and page-title policy. */
export function formatContextsPrivately(contexts: Context[]): string {
  return formatContextsForPrompt(
    privateContexts(contexts, currentValuePolicy()),
  );
}
