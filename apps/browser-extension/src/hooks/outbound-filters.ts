import type { OutboundFilter } from "@apty/agent-core";
import { createOutboundSanitizer } from "@apty/browser-runtime/runtime/outbound-sanitizer";
import { currentRedactionMode } from "@apty/browser-runtime/runtime/redaction-mode";
import { createRequestBudgetFilter } from "@apty/browser-runtime/runtime/request-budget";

/**
 * What runs over every request before it leaves the extension, in order:
 * mask first, so sizes and previews are measured on what would be sent.
 * Kept apart from the agent hooks so the request-size report can build the
 * same chain without loading the browser runtime.
 */
export function createOutboundFilters(): OutboundFilter[] {
  return [
    createOutboundSanitizer({ getMode: currentRedactionMode }),
    createRequestBudgetFilter(),
  ];
}
