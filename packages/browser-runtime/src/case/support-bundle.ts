/**
 * The support bundle for a case (KB-RAG K25, L2, D-CASE2): what Apty
 * support needs, assembled from the case and the check, not a sentence
 * telling the SE what to collect. Every value goes through the content deny
 * list and Strict redaction; page addresses keep only their origin and path
 * with ids as `:id`, a customer's host becomes `customer-app`; KB cards are
 * ids and links only. Nothing here is sent: the SE reviews it, then copies
 * or downloads it.
 */
import type { CaseRecord } from "@apty/agent-core";
import {
  type SupportField,
  supportFieldsFor,
} from "../apty/diagnosis/support-fields.js";
import type { DiagnosisResult } from "../apty/diagnosis/types.js";

const SUPPORT_BUNDLE_SCHEMA = "apty-support-bundle";
const SUPPORT_BUNDLE_VERSION = 1;
/** @internal exported for tests */
export const SUPPORT_BUNDLE_MAX_BYTES = 200 * 1024;
const ENTRY_MAX_BYTES = 4 * 1024;
const CONSOLE_MAX_LINES = 50;

type Missing = { missing: true; hint: string };
type FieldValue = string | string[] | number | Missing;

export interface SupportBundle {
  schema: typeof SUPPORT_BUNDLE_SCHEMA;
  version: typeof SUPPORT_BUNDLE_VERSION;
  case: {
    id: string;
    createdAt: string;
    updatedAt: string;
    closedAt?: string;
    outcome: string;
  };
  fields: Record<string, FieldValue>;
  finding?: {
    ruleId: string;
    cause?: string;
    confidence?: string;
    verification?: string;
    cards: Array<{ pageId: string; link: string }>;
  };
  checks: Array<{
    packId: string;
    at: string;
    status: string;
    ruleIds: string[];
  }>;
  fileEntries: Array<{ file: string; entry: string }>;
  statusCodes: Record<string, number>;
  consoleErrors: string[];
  browser?: string;
  extensionVersion?: string;
}

export interface SupportBundleInput {
  record: CaseRecord;
  /** The check the verdict card shows, when the bundle is made from it. */
  result?: DiagnosisResult;
  /** Apty console errors the case saw (already captured, not read here). */
  consoleErrors?: readonly string[];
  /** The browser's user agent; only its name and major version are kept. */
  userAgent?: string;
  extensionVersion?: string;
  /** Strict redaction. */
  redact: (text: string) => string;
  /** Settings → Data handling's deny list: a file it names is left out. */
  denyList?: readonly string[];
  /** A KB card's link from its page id. */
  cardLink: (pageId: string) => string;
}

const OWN_HOSTS = /(^|\.)(apty\.(io|ai|com|net)|atlassian\.(net|com))$/i;
const ID_SEGMENT =
  /^(?:\d+|[0-9a-f]{8,}(?:-[0-9a-f]{4,})*|[A-Za-z0-9_-]{20,})$/i;

/**
 * A page address as a bundle may hold it: origin and path, ids as `:id`, a customer's host as `customer-app`, no query or fragment.
 * @internal exported for tests
 */
export function safePageUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const host = OWN_HOSTS.test(parsed.hostname) ? parsed.host : "customer-app";
  const path = parsed.pathname
    .split("/")
    .map((segment) => (ID_SEGMENT.test(segment) ? ":id" : segment))
    .join("/");
  return `${parsed.protocol}//${host}${path === "/" ? "" : path}`;
}

/** Every URL in `text` made safe, then the text Strict-redacted. */
function clean(text: string, redact: (text: string) => string): string {
  const urls = text.replace(/\bhttps?:\/\/[^\s"'<>)]+/gi, (url) =>
    safePageUrl(url),
  );
  // Emails and long numbers (user and record ids) go, whatever redaction left.
  return redact(urls)
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[email]")
    .replace(/(?<![\w.])\d{7,}(?![\w.])/g, "[id]");
}

function cut(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  return `${new TextDecoder().decode(bytes.slice(0, maxBytes - 3))}…`;
}

const HINTS: Record<string, string> = {
  aptyVersion:
    "Run a check, or choose the Apty version on the KB card, then prepare the bundle again.",
  clientVersion:
    "Add the Apty Client version (chrome://extensions, or the Client's About).",
  mode: "Add whether the tenant runs the Extension or the Injected script.",
  environment: "Add the environment name from Admin → Environments.",
  browser: "Add the browser and its version.",
  pageOrigin: "Add the page's address (origin and path only).",
  workflowId: "Add the workflow or item id (its sourceId) from Studio.",
  segmentIds: "Add the segment ids from Admin → Segments.",
  consoleErrors:
    "Ask about the Apty logs on the page, then prepare the bundle again.",
};

function hintFor(field: string): string {
  if (field.startsWith("fileEntry:")) {
    return `Prepare the bundle from the verdict card of a check that read ${field.slice(10)}, or attach the trimmed entry.`;
  }
  if (field.startsWith("statusCode:")) {
    return `Add the HTTP status of ${field.slice(11)} from the Network tab.`;
  }
  return HINTS[field] ?? "Add it by hand.";
}

function browserOf(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;
  const match =
    /\b(Edg|Chrome|Firefox|Safari)\/(\d+)/.exec(userAgent) ?? undefined;
  if (!match) return undefined;
  return `${match[1] === "Edg" ? "Edge" : match[1]} ${match[2]}`;
}

/** The values of one kind of param in the check's causes and gates. */
function params(result: DiagnosisResult | undefined, keys: string[]) {
  const values = new Set<string>();
  for (const params of [
    ...(result?.verdict.causes.map((c) => c.params) ?? []),
    ...(result?.gates.map((g) => g.params) ?? []),
  ]) {
    for (const key of keys) {
      const value = params?.[key];
      if (typeof value === "string" || typeof value === "number") {
        for (const part of String(value).split(/\s*,\s*/)) {
          if (part) values.add(part);
        }
      }
    }
  }
  return [...values].sort();
}

const denied = (file: string, denyList: readonly string[]) =>
  denyList.some(
    (entry) => entry.trim() && file.toLowerCase().includes(entry.toLowerCase()),
  );

/** The bundle, its JSON (at most 200 KB), the fields the SE should add, and a short Markdown summary from the same data. */
export function buildSupportBundle(input: SupportBundleInput): {
  bundle: SupportBundle;
  json: string;
  missing: string[];
  markdown: string;
} {
  const { record, result, redact, denyList = [] } = input;
  const ruleId = record.finding?.ruleId ?? result?.verdict.causes[0]?.ruleId;
  const wanted: SupportField[] = ruleId
    ? supportFieldsFor(ruleId)
    : supportFieldsFor("default");
  const fileEntries: SupportBundle["fileEntries"] = [];
  const statusCodes: Record<string, number> = {};
  for (const file of result?.files ?? []) {
    if (file.httpStatus !== undefined && !denied(file.name, denyList)) {
      statusCodes[file.name] = file.httpStatus;
    }
  }
  const evidence = [
    ...(result?.verdict.causes.flatMap((c) => c.evidence) ?? []),
  ];
  const consoleErrors = (input.consoleErrors ?? [])
    .slice(0, CONSOLE_MAX_LINES)
    .map((line) => cut(clean(line, redact), 1024));

  const fields: Record<string, FieldValue> = {};
  const missing: string[] = [];
  const set = (field: string, value: FieldValue | undefined) => {
    const empty =
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    fields[field] = empty ? { missing: true, hint: hintFor(field) } : value;
    if (empty) missing.push(field);
  };

  for (const field of wanted) {
    switch (field) {
      case "aptyVersion":
        set(
          field,
          record.aptyVersion && record.aptyVersion !== "unknown"
            ? record.aptyVersion
            : undefined,
        );
        break;
      case "clientVersion":
      case "mode":
      case "environment":
        set(field, record[field] ? clean(record[field], redact) : undefined);
        break;
      case "browser":
        set(field, browserOf(input.userAgent));
        break;
      case "pageOrigin":
        set(
          field,
          record.tabHost
            ? safePageUrl(`https://${record.tabHost}/`)
            : undefined,
        );
        break;
      case "workflowId":
        set(
          field,
          params(result, ["sourceId", "workflowId"])
            .map((v) => clean(v, redact))
            .join(", ") || undefined,
        );
        break;
      case "segmentIds":
        set(
          field,
          params(result, ["segmentIds", "segmentId"]).map((v) =>
            clean(v, redact),
          ),
        );
        break;
      case "consoleErrors":
        set(field, consoleErrors.length ? consoleErrors.length : undefined);
        break;
      default:
        if (field.startsWith("fileEntry:")) {
          const file = field.slice(10);
          const lines = denied(file, denyList)
            ? []
            : evidence.filter((line) => line.startsWith(`${file}:`));
          for (const line of lines) {
            fileEntries.push({
              file,
              entry: cut(clean(line, redact), ENTRY_MAX_BYTES),
            });
          }
          set(field, lines.length ? lines.length : undefined);
        } else if (field.startsWith("statusCode:")) {
          set(field, statusCodes[field.slice(11)]);
        }
    }
  }

  const finding = record.finding ?? (ruleId ? { ruleId } : undefined);
  const cardIds = [
    ...new Set(
      [
        finding && "cardPageId" in finding ? finding.cardPageId : undefined,
        ...(result?.verdict.causes.map((c) => c.cardPageId) ?? []),
      ].filter(
        (id): id is string => typeof id === "string" && /^\d+$/.test(id),
      ),
    ),
  ];
  const bundle: SupportBundle = {
    schema: SUPPORT_BUNDLE_SCHEMA,
    version: SUPPORT_BUNDLE_VERSION,
    case: {
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.closedAt ? { closedAt: record.closedAt } : {}),
      outcome: record.outcome,
    },
    fields,
    ...(finding
      ? {
          finding: {
            ruleId: finding.ruleId,
            ...("cause" in finding && finding.cause
              ? { cause: finding.cause }
              : {}),
            ...("confidence" in finding && finding.confidence
              ? { confidence: finding.confidence }
              : {}),
            ...("verification" in finding && finding.verification
              ? { verification: finding.verification }
              : {}),
            cards: cardIds.map((pageId) => ({
              pageId,
              link: input.cardLink(pageId),
            })),
          },
        }
      : {}),
    checks: record.checks.map(({ packId, at, status, ruleIds }) => ({
      packId,
      at,
      status,
      ruleIds,
    })),
    fileEntries,
    statusCodes,
    consoleErrors,
    ...(browserOf(input.userAgent)
      ? { browser: browserOf(input.userAgent) }
      : {}),
    ...(input.extensionVersion
      ? { extensionVersion: input.extensionVersion }
      : {}),
  };

  // The cap trims file entries first, then console lines.
  let json = JSON.stringify(bundle, null, 2);
  while (
    new TextEncoder().encode(json).length > SUPPORT_BUNDLE_MAX_BYTES &&
    (bundle.fileEntries.length > 0 || bundle.consoleErrors.length > 0)
  ) {
    if (bundle.fileEntries.length > 0) bundle.fileEntries.pop();
    else bundle.consoleErrors.pop();
    json = JSON.stringify(bundle, null, 2);
  }

  const markdown = [
    `**Apty support case ${record.id}** (${record.outcome})`,
    ...Object.entries(fields).map(
      ([field, value]) =>
        `- ${field}: ${
          typeof value === "object" && !Array.isArray(value)
            ? "_missing_"
            : Array.isArray(value)
              ? value.join(", ")
              : String(value)
        }`,
    ),
    ...(bundle.finding
      ? [
          `- finding: ${bundle.finding.ruleId}${bundle.finding.confidence ? ` (${bundle.finding.confidence})` : ""}${bundle.finding.verification ? `, ${bundle.finding.verification}` : ""}`,
          ...bundle.finding.cards.map(
            (c) => `- KB card ${c.pageId}: ${c.link}`,
          ),
        ]
      : []),
    `- checks: ${bundle.checks.map((c) => `${c.packId} ${c.status}`).join("; ") || "none"}`,
  ].join("\n");

  return { bundle, json, missing, markdown };
}
