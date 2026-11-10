import {
  type CompressionOptions,
  type Context,
  formatContextsForPrompt,
  type OutboundFilter,
} from "@apty/agent-core";
import { createContextBudgetFilter } from "@apty/browser-runtime/runtime/context-budget";
import { privateContexts } from "@apty/browser-runtime/runtime/context-privacy";
import { createKbEgressFilter } from "@apty/browser-runtime/runtime/kb-egress";
import { createOutboundSanitizer } from "@apty/browser-runtime/runtime/outbound-sanitizer";
import { currentRedactionMode } from "@apty/browser-runtime/runtime/redaction-mode";
import { createRequestBudgetFilter } from "@apty/browser-runtime/runtime/request-budget";
import {
  currentSummaryWatermark,
  getRequestLimits,
} from "@apty/browser-runtime/runtime/request-limits";
import { createRequestReportFilter } from "@apty/browser-runtime/runtime/request-reports";
import { currentValuePolicy } from "@apty/browser-runtime/runtime/value-policy";
import { kbEgressLog } from "../services/kb-egress-log";

/**
 * What runs over every request before it leaves the extension, in order:
 * withhold KB card text the organization policy does not let go (KB-RAG
 * K22, D-SEC1; also run over the summary request's source), then mask, so
 * sizes and previews are measured on what would be sent, fit
 * the request budget from Settings, and report last, so the report describes
 * what is actually sent.
 * Kept apart from the agent hooks so the request-size report can build the
 * same chain without loading the browser runtime.
 */
export function createOutboundFilters(): OutboundFilter[] {
  return [
    // A request that leaves with KB text is recorded (D-SEC6); one that
    // cannot be recorded does not carry it.
    createKbEgressFilter({ onSent: (sent) => kbEgressLog().append(sent) }),
    createOutboundSanitizer({ getMode: currentRedactionMode }),
    createRequestBudgetFilter(),
    createContextBudgetFilter({
      getBudget: async () => (await getRequestLimits()).requestTokenBudget,
    }),
    createRequestReportFilter({ getMode: currentRedactionMode }),
  ];
}

/** The answer cap from Settings, read before every turn. */
export async function maxOutputTokens(): Promise<number | undefined> {
  return (await getRequestLimits()).maxOutputTokens;
}

/**
 * Summaries of earlier turns, off unless Settings turns them on. The newest
 * four messages and their tool calls stay whole; a chat of eight items or
 * fewer is never summarized.
 */
export const EARLIER_TURN_SUMMARIES: CompressionOptions = {
  getTokenWatermark: currentSummaryWatermark,
  protectRecentMessages: 4,
  summarizeAfterItems: 8,
  maxSummaryLength: 2_000,
};

/** Attached page and tab contexts, worded under the current URL and page-title policy. */
export function formatContextsPrivately(contexts: Context[]): string {
  return formatContextsForPrompt(
    privateContexts(contexts, currentValuePolicy()),
  );
}
