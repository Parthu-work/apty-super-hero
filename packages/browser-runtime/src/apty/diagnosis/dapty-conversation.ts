/**
 * Check pack for "the user asked Ask Dapty and …": reads the conversation
 * the widget's AI assistant had, then checks, in order, what Apty's own
 * code decides (apty-dap `origin/development`):
 *
 * - the chat is turned on: `config.widgetConfig.features.aiAssistant` in
 *   app-data.json (`player/…/widget/OpenedWidget.tsx:49`);
 * - the chat call answered: in injected mode ai-service only lets in an
 *   Origin among the origins of the application's environment URLs
 *   (`ai-service/…/widget-cors.service.ts:86-107`);
 * - Dapty found an answer: ai-service's fixed give-up reply
 *   (`ai-chat-widget.service.ts:23-24`);
 * - each suggestion would launch: Dapty suggests from the environment's
 *   whole workflow.json and knowledge-content.json, unfiltered
 *   (`widget-content.service.ts`), but a click launches only an item this
 *   environment publishes and whose visibility rule passes
 *   (`player/…/cdn/cdn.service.ts:441-477`); otherwise the player logs
 *   "Workflow … is unavailable" and nothing opens
 *   (`workflow-engine/…/workflow-engine.service.ts:526-534`).
 *
 * Every rule is from code, not runtime-verified, so nothing here is more
 * certain than "likely". The conversation's text is already redacted.
 */
import type { DaptyEvidence, DaptySuggestion } from "./dapty-types.js";
import {
  fileOf,
  jsonOf,
  labelOf,
  makeGate,
  type Rec,
  records,
  resolveItems,
  short,
  text,
  texts,
} from "./pack-kit.js";
import type {
  Cause,
  ClientEvidence,
  DaptyRow,
  DiagnosisResult,
  GateId,
  GateReason,
  GateResult,
  GateStatus,
  NextCheck,
  NotChecked,
  Params,
  RuleId,
  Verdict,
} from "./types.js";

export const DAPTY_FILES = [
  "app-data.json",
  "app-urls.json",
  "workflow.json",
  "knowledge-content.json",
  "rule.json",
];

const VERIFIED_ON =
  "Apty widget chat and ai-service code, apty-dap development, 2026-10-30; from code, not runtime-verified";

/**
 * ai-service's fixed reply when no grounded source answers (`ai-chat-widget.service.ts:23-24`).
 * @internal
 */
export const CANNOT_ANSWER_MESSAGE =
  "I couldn't find information about that in the available documentation. Could you rephrase, or check with your team?";

const MAX_QUESTION_CHARS = 200;

const FILE_OF_TYPE = {
  workflow: "workflow.json",
  knowledge_content: "knowledge-content.json",
} as const;

function gate(
  id: GateId,
  status: GateStatus,
  ruleId: RuleId,
  reason: GateReason,
  detail: string,
  params: Params = {},
  evidence: string[] = [],
): GateResult {
  return makeGate("", id, status, ruleId, reason, detail, params, evidence);
}

function cause(
  ruleId: RuleId,
  params: Params,
  summary: string,
  fix: string,
  evidence: string[],
): Cause {
  return { ruleId, cardPageId: "", params, summary, fix, evidence };
}

const FILES_SHOWN = DAPTY_FILES;

function finish(
  dapty: DaptyEvidence,
  files: ClientEvidence,
  gates: GateResult[],
  verdict: Verdict,
  rows: DaptyRow[],
  notChecked: NotChecked[],
): DiagnosisResult {
  const question = [...dapty.turns].reverse().find((t) => t.role === "user");
  return {
    packId: "dapty-conversation",
    cardPageId: "",
    verifiedOn: VERIFIED_ON,
    subject: { kind: "dapty", matched: [] },
    gates,
    verdict,
    confidence: verdict.status === "no_data" ? "unknown" : "likely",
    files: FILES_SHOWN.map((name) => {
      const file = fileOf(files, name);
      return {
        name,
        status: file.status,
        ...(file.httpStatus !== undefined
          ? { httpStatus: file.httpStatus }
          : {}),
      };
    }),
    notChecked,
    dapty: {
      source: dapty.source,
      turns: dapty.turns.length,
      ...(question
        ? {
            lastQuestion:
              question.text.length > MAX_QUESTION_CHARS
                ? `${question.text.slice(0, MAX_QUESTION_CHARS)}…`
                : question.text,
          }
        : {}),
      suggestions: rows,
      namesOnly: !dapty.suggestionIds,
    },
  };
}

/** The chat panel can be turned off per application, and a self-hosted config always turns it off. */
function availableGate(files: ClientEvidence): {
  gate: GateResult;
  cause?: Cause;
} {
  const appData = fileOf(files, "app-data.json");
  if (appData.status !== "ok") {
    return {
      gate: gate(
        "chat-available",
        "unknown",
        "DAP-01",
        "appDataUnread",
        "app-data.json could not be read, so whether the chat is turned on was not checked.",
      ),
    };
  }
  const features = (
    ((appData.json as Rec | undefined)?.config as Rec | undefined)
      ?.widgetConfig as Rec | undefined
  )?.features as Rec | undefined;
  if (features?.aiAssistant === false) {
    const summary =
      "The AI assistant is turned off for this application (widgetConfig.features.aiAssistant is false), so the widget shows no chat.";
    return {
      gate: gate("chat-available", "fail", "DAP-01", "aiAssistantOff", summary),
      cause: cause(
        "DAP-01",
        {},
        summary,
        "Turn the AI assistant on in the application's widget settings in Admin, then publish.",
        ["app-data.json: config.widgetConfig.features.aiAssistant = false"],
      ),
    };
  }
  return {
    gate: gate(
      "chat-available",
      "pass",
      "DAP-01",
      "aiAssistantOn",
      "The AI assistant is turned on for this application.",
    ),
  };
}

/** `toOriginPattern` in ai-service's widget CORS check: scheme, host and port, lowercased; none without a scheme. */
function originPattern(url: string): string | undefined {
  return /^(https?:\/\/[^/]+)/i.exec(url.trim())?.[1]?.toLowerCase();
}

function originMatches(pattern: string, origin: string): boolean {
  if (!pattern.includes("*")) return pattern === origin;
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(origin);
}

/**
 * In injected mode the page itself calls ai-service, which answers only an
 * Origin that one of the application's environment URLs allows; an
 * environment URL with no scheme allows no origin at all, though the player
 * still matches the page with it.
 */
function originGate(
  dapty: DaptyEvidence,
  files: ClientEvidence,
  pageUrl: string | undefined,
): { gate: GateResult; cause?: Cause } {
  const call = dapty.lastCall;
  if (call?.mode === "extension") {
    return {
      gate: gate(
        "chat-origin",
        "info",
        "DAP-04",
        "chatOriginExtension",
        "The chat call came from the Apty Client's service worker (Extension mode), where the CORS check does not block it.",
      ),
    };
  }
  if (!call) {
    return {
      gate: gate(
        "chat-origin",
        "info",
        "DAP-04",
        "chatOriginUnchecked",
        "No chat call was recorded, so ai-service's CORS check was not reproduced.",
      ),
    };
  }
  // A rejected Origin never gets an HTTP status: the browser reports a failed call.
  if (!call.failed && call.status !== undefined) {
    return {
      gate: gate(
        "chat-origin",
        "pass",
        "DAP-04",
        "chatOriginAnswered",
        "The chat call got an answer, so ai-service allowed the page's origin.",
      ),
    };
  }
  const appUrls = jsonOf(files, "app-urls.json");
  let origin: string | undefined;
  try {
    origin = pageUrl ? new URL(pageUrl).origin.toLowerCase() : undefined;
  } catch {
    origin = undefined;
  }
  const app = records(appUrls).find(
    (a) => call?.applicationId && text(a.id) === call.applicationId,
  );
  if (!origin || !app) {
    return {
      gate: gate(
        "chat-origin",
        "unknown",
        "DAP-04",
        "chatOriginUnknown",
        "The page or the application's environment URLs are not known, so ai-service's CORS check was not reproduced.",
      ),
    };
  }
  const urls = records(app.environments).flatMap((env) => texts(env.urls));
  const patterns = urls.flatMap((u) => originPattern(u) ?? []);
  if (patterns.some((p) => originMatches(p, origin))) {
    return {
      gate: gate(
        "chat-origin",
        "pass",
        "DAP-04",
        "chatOriginAllowed",
        "The page's origin is among the origins the application's environment URLs allow.",
      ),
    };
  }
  const withoutScheme = urls.length - patterns.length;
  const summary =
    withoutScheme > 0
      ? `The page's origin is not among the origins the application's environment URLs allow, and ${withoutScheme} of its ${urls.length} URL(s) have no https:// scheme, which allows no origin. In Injected mode ai-service's CORS check rejects the chat call.`
      : `The page's origin is not among the origins the application's ${urls.length} environment URL(s) allow, so in Injected mode ai-service's CORS check rejects the chat call.`;
  const params: Params = {
    urls: urls.length,
    withoutScheme,
    ...(withoutScheme > 0 ? { variant: "noScheme" } : {}),
  };
  return {
    gate: gate(
      "chat-origin",
      "fail",
      "DAP-04",
      "chatOriginRejected",
      summary,
      params,
    ),
    cause: cause(
      "DAP-04",
      params,
      summary,
      "Add this page's address, with its https:// scheme, to an environment's URLs in Admin, then publish. ai-service reads them from app-urls.json, cached for up to 5 minutes.",
      [
        `app-urls.json: ${urls.length} URL(s) for this application, ${withoutScheme} without a scheme`,
      ],
    ),
  };
}

function callGate(dapty: DaptyEvidence): { gate: GateResult; cause?: Cause } {
  const call = dapty.lastCall;
  if (!call) {
    return {
      gate: gate(
        "chat-call",
        "info",
        "DAP-02",
        "chatCallNotSeen",
        "No chat call was recorded; the conversation comes from a stored chat or the chat panel.",
      ),
    };
  }
  if (call.failed || call.status === undefined) {
    const detail = call.errorText ?? "no response";
    const summary = `The newest chat call failed before ai-service answered (${detail}).`;
    return {
      gate: gate("chat-call", "fail", "DAP-02", "chatCallFailed", summary, {
        detail,
      }),
      cause: cause(
        "DAP-02",
        { detail },
        summary,
        "In Injected mode this is most often the CORS check (see the origin check); otherwise the network or a blocker extension. Ask again with the Network tab open.",
        [`chat call: failed (${detail})`],
      ),
    };
  }
  if (call.status >= 400) {
    const summary = `The newest chat call failed with HTTP ${call.status}, so Dapty could not answer.`;
    return {
      gate: gate("chat-call", "fail", "DAP-03", "chatCallHttp", summary, {
        httpStatus: call.status,
      }),
      cause: cause(
        "DAP-03",
        { httpStatus: call.status },
        summary,
        "A 4xx means ai-service rejected the request; a 5xx means it failed while answering. Send the time of the call to Apty support with the status.",
        [`chat call: HTTP ${call.status}`],
      ),
    };
  }
  return {
    gate: gate(
      "chat-call",
      "pass",
      "DAP-02",
      "chatCallOk",
      `The newest chat call answered (HTTP ${call.status}).`,
      { httpStatus: call.status },
    ),
  };
}

function answerGate(dapty: DaptyEvidence): { gate: GateResult; cause?: Cause } {
  const last = dapty.turns.at(-1);
  if (!last || last.role === "user") {
    return {
      gate: gate(
        "chat-answer",
        "unknown",
        "DAP-05",
        "daptyNoAnswer",
        "No answer to the last question was recorded.",
      ),
    };
  }
  if (last.role === "error") {
    const summary =
      "The chat panel shows an error instead of an answer to the last question.";
    return {
      gate: gate("chat-answer", "fail", "DAP-05", "daptyErrorReply", summary),
      cause: cause(
        "DAP-03",
        { variant: "panel" },
        summary,
        "Open the Network tab, ask again and read the widget chat call's status.",
        ["chat panel: error message"],
      ),
    };
  }
  if (last.text.trim() === CANNOT_ANSWER_MESSAGE) {
    const summary =
      'Dapty gave its fixed "couldn\'t find information" reply: no indexed document or allowed web page answered the question.';
    return {
      gate: gate("chat-answer", "fail", "DAP-05", "daptyGaveUp", summary),
      cause: cause(
        "DAP-05",
        {},
        summary,
        "Check that this application has documents or a connected repository indexed in Admin (AI settings), that they cover the question, and that the application's support docs domains list your help site.",
        ["last answer: ai-service's fixed give-up reply"],
      ),
    };
  }
  return {
    gate: gate(
      "chat-answer",
      "pass",
      "DAP-05",
      "daptyAnswered",
      "Dapty answered the last question.",
    ),
  };
}

/** What would happen on a click: the player launches only a published item whose visibility rule passes. */
function suggestionRow(
  suggestion: DaptySuggestion,
  files: ClientEvidence,
  rules: Rec[] | undefined,
): DaptyRow {
  const types = suggestion.type
    ? [suggestion.type]
    : (["workflow", "knowledge_content"] as const);
  const base = {
    name: suggestion.name,
    ...(suggestion.type ? { type: suggestion.type } : {}),
  };
  const unread = types.filter(
    (t) => fileOf(files, FILE_OF_TYPE[t]).status !== "ok",
  );
  if (unread.length === types.length) return { ...base, status: "unchecked" };
  const found = types.flatMap((t) => {
    const items = records(jsonOf(files, FILE_OF_TYPE[t]));
    const matches = suggestion.id
      ? items.filter((i) => text(i.sourceId) === suggestion.id)
      : resolveItems(items, suggestion.name).filter(
          (i) =>
            labelOf(i).trim().toLowerCase() ===
            suggestion.name.trim().toLowerCase(),
        );
    return matches.map((item) => ({ item, type: t }));
  });
  if (found.length === 0) {
    return unread.length > 0
      ? { ...base, status: "unchecked" }
      : { ...base, status: "missing" };
  }
  if (found.length > 1) return { ...base, status: "ambiguous" };
  const [{ item, type }] = found as [
    { item: Rec; type: "workflow" | "knowledge_content" },
  ];
  // Dapty launches by id, so an item hidden from the widget's list still opens.
  const listHidden = item.hideFromWidget === true;
  const ruleId = text(item.visibilityRuleId);
  if (ruleId) {
    const rule = rules?.find((r) => r.id === ruleId);
    return {
      ...base,
      type,
      sourceId: text(item.sourceId),
      status: "rule",
      rule: text(rule?.name) ?? short(ruleId),
      ...(listHidden ? { listHidden } : {}),
    };
  }
  return {
    ...base,
    type,
    sourceId: text(item.sourceId),
    status: "launches",
    ...(listHidden ? { listHidden } : {}),
  };
}

function suggestionsGate(
  dapty: DaptyEvidence,
  files: ClientEvidence,
): { gate: GateResult; causes: Cause[]; rows: DaptyRow[] } {
  const answered = [...dapty.turns]
    .reverse()
    .find((t) => t.role === "assistant" && t.suggestions.length > 0);
  if (!answered) {
    return {
      gate: gate(
        "chat-suggestions",
        "info",
        "DAP-06",
        "suggestionsNone",
        "Dapty suggested no workflow or knowledge item.",
      ),
      causes: [],
      rows: [],
    };
  }
  const ruleFile = fileOf(files, "rule.json");
  const rules = ruleFile.status === "ok" ? records(ruleFile.json) : undefined;
  const rows = answered.suggestions.map((s) => suggestionRow(s, files, rules));
  const missing = rows.filter((r) => r.status === "missing");
  const open = rows.filter(
    (r) =>
      r.status === "rule" ||
      r.status === "unchecked" ||
      r.status === "ambiguous",
  );
  const causes = missing.map((row) =>
    cause(
      "DAP-06",
      { name: row.name },
      `Dapty suggested "${row.name}", which this environment does not publish, so clicking it opens nothing; the player logs that the item is unavailable.`,
      "Dapty lists the environment's items from ai-service's own copy of the content files, which can lag a publish by a few minutes, or the model named an item it was not given. Publish the item to this environment, or ask again once ai-service has the newest content.",
      [
        `${row.type ? FILE_OF_TYPE[row.type] : "content files"}: no item ${dapty.suggestionIds ? "with this sourceId" : "with this name"}`,
      ],
    ),
  );
  const status: GateStatus =
    missing.length > 0 ? "fail" : open.length > 0 ? "unknown" : "pass";
  const reason: GateReason =
    missing.length > 0
      ? "suggestionsMissing"
      : open.length > 0
        ? "suggestionsOpen"
        : "suggestionsLaunch";
  const detail =
    missing.length > 0
      ? `${missing.length} of ${rows.length} suggestion(s) are not published in this environment.`
      : open.length > 0
        ? `${open.length} of ${rows.length} suggestion(s) depend on a visibility rule or could not be checked.`
        : `All ${rows.length} suggestion(s) are published here with no visibility rule, so a click launches them.`;
  return {
    gate: gate("chat-suggestions", status, "DAP-06", reason, detail, {
      count: rows.length,
      missing: missing.length,
      open: open.length,
    }),
    causes,
    rows,
  };
}

/** Runs the pack on the conversation, the Client's (or a HAR's) content files and the page in the tab. */
export function diagnoseDaptyConversation(
  dapty: DaptyEvidence,
  files: ClientEvidence,
  pageUrl?: string,
): DiagnosisResult {
  const notChecked: NotChecked[] = ["kb-contents", "runtime-rules"];
  if (!dapty.connection.ok) {
    const { message, failure } = dapty.connection;
    const data = gate(
      "data",
      "fail",
      "DAP-00",
      "clientUnreachable",
      `Could not read the chat: ${message}`,
      { message, failure },
    );
    return finish(
      dapty,
      files,
      [data],
      {
        status: "no_data",
        headline: data.detail,
        causes: [],
        nextCheck: "fixConnection",
      },
      [],
      notChecked,
    );
  }
  if (dapty.turns.length === 0 && dapty.calls === 0) {
    const detail =
      dapty.source === "har"
        ? "This HAR holds no Ask Dapty chat call or stored chat."
        : "No Ask Dapty chat was observed for this page.";
    return finish(
      dapty,
      files,
      [
        gate("data", "fail", "DAP-00", "daptyNotObserved", detail, {
          source: dapty.source,
        }),
      ],
      {
        status: "no_data",
        headline: detail,
        causes: [],
        nextCheck: "askDapty",
      },
      [],
      notChecked,
    );
  }

  const data = gate(
    "data",
    "pass",
    "DAP-00",
    "daptyRead",
    `Read ${dapty.turns.length} turn(s) of the chat, ${dapty.calls} chat call(s) and ${dapty.storedChats} stored chat(s).`,
    {
      turns: dapty.turns.length,
      calls: dapty.calls,
      stored: dapty.storedChats,
      source: dapty.source,
    },
  );
  const available = availableGate(files);
  const call = callGate(dapty);
  const origin = originGate(dapty, files, pageUrl);
  const answer = answerGate(dapty);
  const suggestions = suggestionsGate(dapty, files);

  const gates = [
    data,
    available.gate,
    call.gate,
    origin.gate,
    answer.gate,
    suggestions.gate,
  ];
  if (!dapty.suggestionIds) notChecked.unshift("suggestion-ids");

  const causes = [
    available.cause,
    // A rejected origin is why the call failed, so it comes first.
    origin.cause,
    call.cause,
    answer.cause,
    ...suggestions.causes,
  ].filter((c): c is Cause => c !== undefined);
  const open = gates.some((g) => g.status === "unknown");
  let nextCheck: NextCheck | undefined;
  if (answer.cause?.ruleId === "DAP-05") nextCheck = "checkKb";
  else if (call.cause) nextCheck = "fixRequest";
  else if (suggestions.rows.some((r) => r.status === "rule")) {
    nextCheck = "clickAsUser";
  } else if (open) nextCheck = "openItems";

  const verdict: Verdict = {
    status:
      causes.length > 0
        ? "cause_found"
        : open
          ? "candidates"
          : "no_cause_in_data",
    headline:
      causes[0]?.summary ??
      (open
        ? "Nothing in the chat or the files blocks it, but some checks are open."
        : "The chat answered, and every suggestion is published here with no visibility rule."),
    causes,
    ...(nextCheck ? { nextCheck } : {}),
  };
  return finish(dapty, files, gates, verdict, suggestions.rows, notChecked);
}
