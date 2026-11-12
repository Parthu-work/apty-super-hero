/**
 * What Apty support needs to act on each rule's finding (KB-RAG K25, L2),
 * declared in code as structured keys, never derived from card text. A
 * rule with no list of its own gets the default set.
 */
import type { RuleId } from "./types.js";

export type SupportField =
  | "aptyVersion"
  | "clientVersion"
  | "mode"
  | "environment"
  | "browser"
  | "pageOrigin"
  | "workflowId"
  | "segmentIds"
  | "consoleErrors"
  | `fileEntry:${string}`
  | `statusCode:${string}`;

/** Every finding's bundle has these, and the finding and the files the check read. */
const DEFAULT_SUPPORT_FIELDS: readonly SupportField[] = [
  "aptyVersion",
  "mode",
  "environment",
  "browser",
  "pageOrigin",
];

const CONTENT: readonly SupportField[] = [
  ...DEFAULT_SUPPORT_FIELDS,
  "clientVersion",
  "workflowId",
  "segmentIds",
  "fileEntry:workflows.json",
  "fileEntry:segment.json",
  "statusCode:workflows.json",
];

const WIDGET: readonly SupportField[] = [
  ...DEFAULT_SUPPORT_FIELDS,
  "clientVersion",
  "fileEntry:app-data.json",
  "fileEntry:app-urls.json",
  "statusCode:app-data.json",
  "consoleErrors",
];

const LOGS: readonly SupportField[] = [
  ...DEFAULT_SUPPORT_FIELDS,
  "clientVersion",
  "consoleErrors",
];

const SELECTOR: readonly SupportField[] = [
  ...DEFAULT_SUPPORT_FIELDS,
  "clientVersion",
  "workflowId",
  "consoleErrors",
];

const DAPTY: readonly SupportField[] = [
  ...DEFAULT_SUPPORT_FIELDS,
  "clientVersion",
  "consoleErrors",
];

/** By rule family: content (CNV, C4X), widget (WNV, W4X), logs, selectors, page (DOM), Ask Dapty. */
const BY_FAMILY: Record<string, readonly SupportField[]> = {
  CNV: CONTENT,
  C4X: CONTENT,
  WNV: WIDGET,
  W4X: WIDGET,
  LOG: LOGS,
  SEL: SELECTOR,
  DOM: DEFAULT_SUPPORT_FIELDS,
  DAP: DAPTY,
};

/** Rules whose finding needs more than their family's set. */
const BY_RULE: Partial<Record<RuleId, readonly SupportField[]>> = {
  "CNV-03": [...CONTENT, "fileEntry:segment-rules.json"],
  "WNV-02": [...WIDGET, "fileEntry:app-data.json"],
  "LOG-01": [...LOGS, "statusCode:app-urls.json"],
};

/** The support fields of a rule, without duplicates, in declaration order. */
export function supportFieldsFor(ruleId: RuleId | string): SupportField[] {
  const own =
    BY_RULE[ruleId as RuleId] ??
    BY_FAMILY[String(ruleId).split("-")[0] ?? ""] ??
    DEFAULT_SUPPORT_FIELDS;
  return [...new Set(own)];
}
