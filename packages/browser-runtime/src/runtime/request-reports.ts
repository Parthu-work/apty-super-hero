/**
 * What was sent: one report per model request, with counts and estimated
 * tokens only (no text, URLs or tool names), kept in `chrome.storage.session`
 * so the Options page can show them. Session storage lives in memory and is
 * cleared when the browser closes; only the newest MAX_REQUEST_REPORTS stay.
 */
import type {
  AgentInputItem,
  OutboundFilter,
  OutboundRequestContext,
  RequestReport,
} from "@apty/agent-core";
import type { RedactionMode } from "@apty/debug-contract";
import { type MeasurableItem, measureRequest } from "./request-anatomy.js";

/** @internal */
export const REQUEST_REPORTS_KEY = "apty_request_reports";
/** @internal */
export const MAX_REQUEST_REPORTS = 5;

let recent: RequestReport[] = [];

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  const text = (output as { text?: unknown } | null)?.text;
  if (typeof text === "string") return text;
  try {
    return JSON.stringify(output) ?? "";
  } catch {
    return "";
  }
}

function imageCount(item: AgentInputItem): number {
  const content = (item as { content?: unknown }).content;
  return Array.isArray(content)
    ? content.filter(
        (part) => (part as { type?: string })?.type === "input_image",
      ).length
    : 0;
}

/** @internal */
export function buildRequestReport(
  items: AgentInputItem[],
  request: OutboundRequestContext,
  redactionMode: RedactionMode,
  at: number,
): RequestReport {
  const anatomy = measureRequest({
    instructions: request.instructions ?? "",
    tools: request.tools,
    input: items as unknown as MeasurableItem[],
  });
  let toolResults = 0;
  let toolResultsStubbed = 0;
  let toolResultsCut = 0;
  let images = 0;
  for (const item of items) {
    images += imageCount(item);
    if (item.type !== "function_call_result") continue;
    toolResults += 1;
    const text = outputText((item as { output?: unknown }).output);
    if (text.includes('"stubbed":true')) toolResultsStubbed += 1;
    else if (
      text.includes('"truncatedForModel"') ||
      text.includes("[truncated: first ")
    ) {
      toolResultsCut += 1;
    }
  }
  return {
    at,
    redactionMode,
    ...anatomy,
    items: items.length,
    toolResults,
    toolResultsStubbed,
    toolResultsCut,
    images,
  };
}

/** Last in the outbound chain, so it reports what is actually sent. Never changes the items. */
export function createRequestReportFilter(options: {
  getMode: () => RedactionMode;
}): OutboundFilter {
  return async (items, request) => {
    const report = buildRequestReport(
      items,
      request,
      options.getMode(),
      Date.now(),
    );
    recent = [report, ...recent].slice(0, MAX_REQUEST_REPORTS);
    try {
      await chrome.storage.session.set({ [REQUEST_REPORTS_KEY]: recent });
    } catch {
      // A report that cannot be stored must not stop the request.
    }
    return items;
  };
}

function isReport(value: unknown): value is RequestReport {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RequestReport).at === "number" &&
    typeof (value as RequestReport).totalTokens === "number"
  );
}

export async function readRequestReports(): Promise<RequestReport[]> {
  try {
    const stored = (await chrome.storage.session.get(REQUEST_REPORTS_KEY))?.[
      REQUEST_REPORTS_KEY
    ];
    return Array.isArray(stored) ? stored.filter(isReport) : [];
  } catch {
    return [];
  }
}

/** Calls `listener` with the reports whenever a new request is recorded. */
export function watchRequestReports(
  listener: (reports: RequestReport[]) => void,
): () => void {
  const onChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== "session" || !(REQUEST_REPORTS_KEY in changes)) return;
    const value = changes[REQUEST_REPORTS_KEY]?.newValue;
    listener(Array.isArray(value) ? value.filter(isReport) : []);
  };
  chrome.storage.onChanged.addListener(onChanged);
  return () => chrome.storage.onChanged.removeListener(onChanged);
}

/**
 * Test-only: forget this context's reports.
 * @internal
 */
export function resetRequestReportsForTests(): void {
  recent = [];
}
