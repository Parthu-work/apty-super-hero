/**
 * The Ask Dapty evidence bundle: what an SE sends back from a live-tenant
 * test so the check can be verified against real evidence (E1 to E12):
 * build facts, the result, timing, which source answered and why each
 * earlier one did not, and the shape of every file and call the check read.
 *
 * Built from an allow-list of counts, keys, statuses and reasons, never by
 * copying a body. No text of the conversation, no URL, and no tenant,
 * application, user or chat id goes in; every string left is redacted in
 * the current mode on the way out.
 *
 * A check run fills a `DaptyTrace` as it reads its sources; the responder
 * turns it into a `DaptyEvidenceSummary` (plain data, kept on the card's
 * result and never sent to the model), and the card's "Export evidence"
 * adds the build facts with `buildDaptyEvidenceBundle`.
 */
import { redactText } from "../../runtime/redaction-mode.js";
import type { AptyPageProbe, StoredChatState } from "../apty-cdn-source.js";
import { APP_FILES, TENANT_FILES } from "../apty-cdn-source.js";
import type {
  DaptyEvidence,
  DaptySource,
  RawDaptyCall,
  RawDaptyDomTurn,
} from "./dapty-types.js";
import { type Rec, records, text } from "./pack-kit.js";
import type { ClientEvidence, DiagnosisResult } from "./types.js";

const DAPTY_EVIDENCE_BUNDLE_VERSION = "apty-dapty-evidence/1";

/** How a Client found on the page, or saved, was reached. */
export type ClientPing =
  | "saved-id"
  | "answered"
  | "silent"
  | "not-on-page"
  | "no-tab";

interface DaptySourceAttempt {
  source: DaptySource | "widget-chat";
  ms: number;
  /** It held a conversation, and the check used it. */
  used: boolean;
  calls?: number;
  turns?: number;
  /** The connection failure code, or the reason it held nothing. */
  reason?: string;
}

/** Filled while the check runs; never leaves the side panel as is. */
export interface DaptyTrace {
  startedAt: number;
  attempts: DaptySourceAttempt[];
  clientPing?: ClientPing;
  /** The Client record's connection failure for the content files. */
  filesConnection?: string;
  cdnProbe?: "ok" | Extract<AptyPageProbe, { ok: false }>["reason"];
  cdnAllowed?: boolean;
  storedChat?: StoredChatState;
  filesMs?: number;
  calls: RawDaptyCall[];
  dom?: { ok: true; turns: RawDaptyDomTurn[] } | { ok: false; reason: string };
}

export function createDaptyTrace(now = Date.now()): DaptyTrace {
  return { startedAt: now, attempts: [], calls: [] };
}

/** Times one reader and records what it gave. */
export async function traced<T>(
  trace: DaptyTrace | undefined,
  source: DaptySourceAttempt["source"],
  read: () => Promise<T>,
  describe: (value: T) => Omit<DaptySourceAttempt, "source" | "ms">,
): Promise<T> {
  const started = Date.now();
  const value = await read();
  trace?.attempts.push({
    source,
    ms: Date.now() - started,
    ...describe(value),
  });
  return value;
}

type Scope = "tenant" | "app" | "env";

interface FileSummary {
  name: string;
  scope: Scope;
  status: string;
  httpStatus?: number;
  /** Characters of the parsed JSON, re-serialized: the body's size, near enough. */
  size?: number;
  topLevelKeys?: string[];
  items?: number;
  apps?: number;
  environments?: number;
  patternShapes?: Record<string, number>;
  userIdentificationType?: string;
  aiAssistant?: boolean;
  /** For each suggestion of this file's type, in order: which field its id matched. */
  suggestionIdMatches?: Array<"sourceId" | "id" | "none">;
}

export interface DaptyEvidenceSummary {
  totalMs: number;
  filesMs?: number;
  answeredBy: DaptySource;
  attempts: DaptySourceAttempt[];
  clientPing?: ClientPing;
  filesConnection?: string;
  filesFromCdn: boolean;
  cdnAllowed?: boolean;
  cdnProbe?: string;
  storedChat?: string;
  files: FileSummary[];
  chatCall?: {
    status?: number;
    failed?: boolean;
    errorText?: string;
    requestContextLength?: number;
    responseKeys?: string[];
    suggestionCount?: number;
  };
  storedChatFile?: { messages: number; suggestionFields: string[] };
  chatPanel?:
    | {
        read: true;
        markers: string[];
        turns: { user: number; assistant: number; error: number };
      }
    | { read: false; reason: string };
}

const FILE_TYPE = {
  "workflow.json": "workflow",
  "knowledge-content.json": "knowledge_content",
} as const;

const scopeOf = (name: string): Scope =>
  TENANT_FILES.has(name) ? "tenant" : APP_FILES.has(name) ? "app" : "env";

const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function keysOf(json: unknown): string[] | undefined {
  if (isRec(json)) return Object.keys(json).sort();
  if (Array.isArray(json)) {
    return [...new Set(records(json).flatMap((item) => Object.keys(item)))]
      .sort()
      .map((key) => `[].${key}`);
  }
  return undefined;
}

/** What a URL pattern looks like, never the pattern. */
function patternShape(pattern: string): string[] {
  if (pattern === "") return ["empty"];
  return [
    /^[a-z*]+:\/\//i.test(pattern) ? "scheme" : "noScheme",
    ...(pattern.includes("*") ? ["wildcard"] : []),
    ...(/[\\()|[\]^$+?{}]/.test(pattern) ? ["regexLooking"] : []),
  ];
}

function appUrlsSummary(json: unknown): Partial<FileSummary> {
  const apps = records(json);
  const envs = apps.flatMap((app) => records(app.environments));
  const shapes: Record<string, number> = {};
  for (const env of envs) {
    for (const pattern of Array.isArray(env.urls) ? env.urls : []) {
      if (typeof pattern !== "string") continue;
      for (const shape of patternShape(pattern)) {
        shapes[shape] = (shapes[shape] ?? 0) + 1;
      }
    }
  }
  return {
    apps: apps.length,
    environments: envs.length,
    patternShapes: shapes,
  };
}

function appDataSummary(json: unknown): Partial<FileSummary> {
  const config = isRec(json) && isRec(json.config) ? json.config : {};
  const ident = isRec(config.userIdentificationConfig)
    ? config.userIdentificationConfig
    : {};
  const widget = isRec(config.widgetConfig) ? config.widgetConfig : {};
  const features = isRec(widget.features) ? widget.features : {};
  return {
    ...(text(ident.type) ? { userIdentificationType: text(ident.type) } : {}),
    ...(typeof features.aiAssistant === "boolean"
      ? { aiAssistant: features.aiAssistant }
      : {}),
  };
}

function contentSummary(
  json: unknown,
  type: string,
  chat: DaptyEvidence,
): Partial<FileSummary> {
  const items = records(json);
  const newest = [...chat.turns]
    .reverse()
    .find((t) => t.role === "assistant" && t.suggestions.length > 0);
  const ids = (newest?.suggestions ?? [])
    .filter((s) => s.id && s.type === type)
    .map((s) => s.id as string);
  return {
    items: items.length,
    ...(ids.length > 0
      ? {
          suggestionIdMatches: ids.map((id) =>
            items.some((i) => text(i.sourceId) === id)
              ? "sourceId"
              : items.some((i) => text(i.id) === id)
                ? "id"
                : "none",
          ),
        }
      : {}),
  };
}

function fileSummaries(
  files: ClientEvidence,
  chat: DaptyEvidence,
): FileSummary[] {
  return Object.values(files.files).map((file) => {
    const { json } = file;
    const type = FILE_TYPE[file.name as keyof typeof FILE_TYPE];
    const keys = keysOf(json);
    return {
      name: file.name,
      scope: scopeOf(file.name),
      status: file.status,
      ...(file.httpStatus !== undefined ? { httpStatus: file.httpStatus } : {}),
      ...(json !== undefined ? { size: JSON.stringify(json).length } : {}),
      ...(keys ? { topLevelKeys: keys } : {}),
      ...(file.name === "app-urls.json" ? appUrlsSummary(json) : {}),
      ...(file.name === "app-data.json" ? appDataSummary(json) : {}),
      ...(type && json !== undefined ? contentSummary(json, type, chat) : {}),
    };
  });
}

function parsed(body: string | undefined): unknown {
  if (body === undefined) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function chatCallSummary(
  calls: RawDaptyCall[],
): DaptyEvidenceSummary["chatCall"] {
  const call = calls
    .filter((c) => c.kind === "chat")
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!call) return undefined;
  const request = parsed(call.requestBody);
  const response = parsed(call.responseBody);
  return {
    ...(call.status !== undefined ? { status: call.status } : {}),
    ...(call.failed ? { failed: true } : {}),
    ...(call.errorText ? { errorText: call.errorText } : {}),
    ...(isRec(request) && Array.isArray(request.context)
      ? { requestContextLength: request.context.length }
      : {}),
    ...(isRec(response)
      ? {
          responseKeys: Object.keys(response).sort(),
          suggestionCount: records(response.suggestions).length,
        }
      : {}),
  };
}

function storedChatSummary(
  calls: RawDaptyCall[],
): DaptyEvidenceSummary["storedChatFile"] {
  const call = calls
    .filter((c) => c.kind === "stored-chat")
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  const stored = parsed(call?.responseBody);
  if (!isRec(stored)) return undefined;
  const messages = records(stored.messages);
  return {
    messages: messages.length,
    suggestionFields: [
      ...new Set(
        messages.flatMap((m) =>
          records(m.suggestions).flatMap((s) => Object.keys(s)),
        ),
      ),
    ].sort(),
  };
}

/** The chat panel markers the reader matched (`dapty-widget-reader.ts`), and how many turns of each kind. */
function chatPanelSummary(
  dom: DaptyTrace["dom"],
): DaptyEvidenceSummary["chatPanel"] {
  if (!dom) return undefined;
  if (!dom.ok) return { read: false, reason: dom.reason };
  const count = (role: RawDaptyDomTurn["role"]) =>
    dom.turns.filter((t) => t.role === role).length;
  const turns = {
    user: count("user"),
    assistant: count("assistant"),
    error: count("error"),
  };
  return {
    read: true,
    markers: [
      'data-chat-dialog="show.feedback"',
      ...(turns.user > 0 ? [".MuiTypography-body2"] : []),
      ...(turns.error > 0 ? [".MuiTypography-body1"] : []),
      ...(dom.turns.some((t) => t.suggestionNames.length > 0)
        ? [".MuiButton-root"]
        : []),
    ],
    turns,
  };
}

/** The trace as plain counts and reasons, for the card's result. */
export function summarizeDaptyTrace(
  trace: DaptyTrace,
  chat: DaptyEvidence,
  files: ClientEvidence,
  now = Date.now(),
): DaptyEvidenceSummary {
  const chatCall = chatCallSummary(trace.calls);
  const storedChatFile = storedChatSummary(trace.calls);
  const chatPanel = chatPanelSummary(trace.dom);
  return {
    totalMs: now - trace.startedAt,
    ...(trace.filesMs !== undefined ? { filesMs: trace.filesMs } : {}),
    answeredBy: chat.source,
    attempts: trace.attempts,
    ...(trace.clientPing ? { clientPing: trace.clientPing } : {}),
    ...(trace.filesConnection
      ? { filesConnection: trace.filesConnection }
      : {}),
    filesFromCdn: files.fromCdn === true,
    ...(trace.cdnAllowed !== undefined ? { cdnAllowed: trace.cdnAllowed } : {}),
    ...(trace.cdnProbe ? { cdnProbe: trace.cdnProbe } : {}),
    ...(trace.storedChat ? { storedChat: trace.storedChat } : {}),
    files: fileSummaries(files, chat),
    ...(chatCall ? { chatCall } : {}),
    ...(storedChatFile ? { storedChatFile } : {}),
    ...(chatPanel ? { chatPanel } : {}),
  };
}

const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s)"']+/gi;

/** Every string, recursively, redacted in the current mode and with no URL. */
function redactStrings(value: unknown): unknown {
  if (typeof value === "string") {
    return redactText(value).replace(URL_IN_TEXT, "[url]");
  }
  if (Array.isArray(value)) return value.map(redactStrings);
  if (isRec(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactStrings(child)]),
    );
  }
  return value;
}

interface DaptyEvidenceBundleInput {
  result: DiagnosisResult;
  versions: { agent: string; commit: string | null; chrome: string | null };
  generatedAt?: Date;
}

export function buildDaptyEvidenceBundle({
  result,
  versions,
  generatedAt = new Date(),
}: DaptyEvidenceBundleInput) {
  const { daptyEvidence, ...rest } = result;
  // The user's question is their own words: the bundle keeps no conversation text.
  const shown = rest.dapty
    ? { ...rest, dapty: { ...rest.dapty, lastQuestion: undefined } }
    : rest;
  return redactStrings({
    bundleVersion: DAPTY_EVIDENCE_BUNDLE_VERSION,
    generatedAt: generatedAt.toISOString(),
    versions,
    result: shown,
    evidence: daptyEvidence ?? null,
  }) as {
    bundleVersion: string;
    generatedAt: string;
    versions: DaptyEvidenceBundleInput["versions"];
    result: Omit<DiagnosisResult, "daptyEvidence">;
    evidence: DaptyEvidenceSummary | null;
  };
}
