/**
 * Shapes shared by the check packs: what the loader hands over, and the one
 * result every pack returns. A result carries English text for the model and
 * the transcript, and rule IDs plus parameters for the card to localize.
 */

export type ContentKind =
  | "workflow"
  | "tooltip"
  | "launcher"
  | "announcement"
  | "validation"
  | "checklist"
  | "knowledgeContent";

export interface KindSpec {
  file: string;
  /** The segment.json array that lists this kind by `sourceId`. */
  segmentField: string;
  label: string;
}

export const KINDS: Record<ContentKind, KindSpec> = {
  workflow: {
    file: "workflow.json",
    segmentField: "workflowIds",
    label: "workflow",
  },
  tooltip: {
    file: "tooltip.json",
    segmentField: "tooltipIds",
    label: "tooltip",
  },
  launcher: {
    file: "launcher.json",
    segmentField: "launcherIds",
    label: "launcher",
  },
  announcement: {
    file: "announcement.json",
    segmentField: "announcementIds",
    label: "announcement",
  },
  validation: {
    file: "validation.json",
    segmentField: "validationIds",
    label: "validation",
  },
  checklist: {
    file: "checklist.json",
    segmentField: "checklistIds",
    label: "checklist",
  },
  knowledgeContent: {
    file: "knowledge-content.json",
    segmentField: "knowledgeContentIds",
    label: "knowledge content item",
  },
};

export type FileStatus =
  | "ok"
  | "empty"
  | "http_error"
  | "not_observed"
  | "failed"
  | "pending"
  | "body_denied"
  | "body_unavailable"
  | "too_large_to_redact"
  | "unparsable";

export interface LoadedFile {
  name: string;
  status: FileStatus;
  httpStatus?: number;
  json?: unknown;
  /** The deny-list entry, the Client's reason for a missing body, or a request error. */
  detail?: string;
}

export interface ClientEvidence {
  connection: { ok: true } | { ok: false; failure: string; message: string };
  /** Every resource name the Client reported, to tell a 4.x tenant from a 5.x one. */
  observedNames: string[];
  files: Record<string, LoadedFile>;
  /** The `env-<id>` segment of the content files' path. */
  envId?: string;
}

export type RuleId =
  | "CNV-00"
  | "CNV-V5"
  | "CNV-01"
  | "CNV-02"
  | "CNV-03"
  | "CNV-04"
  | "CNV-05"
  | "CNV-06"
  | "CNV-07"
  | "CNV-08"
  | "CNV-09"
  | "CNV-10"
  | "CNV-11"
  | "CNV-12"
  | "CNV-13"
  | "WNV-00"
  | "WNV-01"
  | "WNV-02"
  | "WNV-03"
  | "WNV-04"
  | "WNV-05"
  | "WNV-06"
  | "WNV-07"
  | "LOG-00"
  | "LOG-01"
  | "LOG-02"
  | "LOG-03"
  | "LOG-04"
  | "LOG-05"
  | "LOG-06"
  | "LOG-07";

export type GateId =
  | "data"
  | "version"
  | "environment"
  | "published"
  | "flags"
  | "segments"
  | "segment-consistency"
  | "widget-audience"
  | "visibility-rule"
  | "language"
  | "page"
  | "environment-match"
  | "restriction"
  | "client-logs"
  | "client-calls"
  | "page-console";

export type GateStatus = "pass" | "fail" | "unknown" | "info";

export type GateReason =
  | "filesRead"
  | "clientUnreachable"
  | "notObserved"
  | "emptyList"
  | "httpError"
  | "requestFailed"
  | "pending"
  | "denied"
  | "bodyUnavailable"
  | "unparsable"
  | "version4x"
  | "envLoaded"
  | "envUnknown"
  | "found"
  | "notPublished"
  | "severalMatch"
  | "flagsOk"
  | "flagsFail"
  | "noSegments"
  | "allInactive"
  | "rulesMissing"
  | "mustMatch"
  | "segmentsUnread"
  | "oneSided"
  | "widgetForAll"
  | "widgetLimited"
  | "widgetDisjoint"
  | "appDataUnread"
  | "noVisibilityRule"
  | "visibilityRule"
  | "localeFound"
  | "localeRegional"
  | "localeMissing"
  | "appUrlsEmpty"
  | "pageUnknown"
  | "pageRead"
  | "envMatch"
  | "noEnvMatch"
  | "envTooSpecific"
  | "severalEnvMatch"
  | "otherEnvLoaded"
  | "envVisibilityRule"
  | "widgetOtherUsers"
  | "widgetNoActiveSegment"
  | "widgetSegmentsMissing"
  | "restrictionPatterns"
  | "logsUnavailable"
  | "pageConsoleUnavailable"
  | "noPageConsole"
  | "noKnownMessage"
  | "noActiveApplication"
  | "fetchOrParseError"
  | "noMatchingVersion"
  | "errorsLogged"
  | "callsOk"
  | "contentCallsFailed"
  | "otherCallsFailed"
  | "no404FromApty"
  | "apty404s"
  | "cspBlockedApty"
  | "cspBlockedOther"
  | "aptyResourceFailed";

export type NextCheck =
  | "fixConnection"
  | "reload"
  | "readStatus"
  | "fixRequest"
  | "waitForLoad"
  | "denyList"
  | "bodyLimit"
  | "openResponse"
  | "manual4x"
  | "nameItem"
  | "whichOne"
  | "testAsMember"
  | "openAppPage"
  | "comparePatterns"
  | "removalTest"
  | "readConsoleText"
  | "openItems"
  | "sendSupport";

export type NotChecked =
  | "membership"
  | "runtime-rules"
  | "widget-css"
  | "extension-page-console"
  | "cors";

export type PackId =
  | "content-not-visible"
  | "widget-not-visible"
  | "logs-and-errors";

/** One console or log line, already redacted. */
export interface LogLine {
  level: string;
  message: string;
  /** For page lines, what the bridge saw: console, csp-violation, resource-error. */
  source?: string;
}

/** What the logs pack reads: the Client's logs and calls, and the page's console. */
export interface LogEvidence {
  connection: ClientEvidence["connection"];
  clientLogs:
    | { ok: true; lines: LogLine[] }
    | { ok: false; failure: string; message: string };
  /** The Client's calls by file name, with no URL: only the host is kept, to tell its own from others. */
  calls: Array<{
    name: string;
    host: string;
    status?: number;
    failed?: boolean;
    errorText?: string;
  }>;
  /** Undefined when no web page is open in the conversation's tab. */
  page?:
    | { ok: true; lines: LogLine[]; framesRead: number; framesDisabled: number }
    | { ok: false; code: string; message: string };
}

export type Params = Record<string, string | number>;

export interface GateResult {
  id: GateId;
  status: GateStatus;
  ruleId: RuleId;
  /** Why the gate came out this way, keyed for the card's strings. */
  reason: GateReason;
  params: Params;
  detail: string;
  evidence: string[];
  cardPageId: string;
}

export interface Cause {
  ruleId: RuleId;
  cardPageId: string;
  params: Params;
  summary: string;
  fix: string;
  evidence: string[];
}

export type VerdictStatus =
  | "cause_found"
  | "candidates"
  | "no_cause_in_data"
  | "no_data"
  | "out_of_scope";

export interface Verdict {
  status: VerdictStatus;
  headline: string;
  causes: Cause[];
  /** The one check that would decide what the files cannot (P4). */
  nextCheck?: NextCheck;
}

export interface ScanRow {
  name: string;
  sourceId: string;
  blockers: Array<"hidden" | "no-name" | "inactive-segments">;
}

export interface DiagnosisResult {
  packId: PackId;
  /** The KB card the rules come from, and how far they were verified. */
  cardPageId: string;
  verifiedOn: string;
  /** `name` is the item's own name when the query resolved to exactly one. */
  subject: {
    kind: ContentKind | "widget" | "logs";
    query?: string;
    /** The language the message named, as a code ("fr"), for the language gate. */
    language?: string;
    name?: string;
    matched: string[];
  };
  gates: GateResult[];
  verdict: Verdict;
  /** Never "confirmed" while the rules are verified from code only (P2). */
  confidence: "likely" | "unknown";
  files: Array<{ name: string; status: FileStatus; httpStatus?: number }>;
  notChecked: NotChecked[];
  scan?: { total: number; rows: ScanRow[] };
}
