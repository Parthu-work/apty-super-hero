/**
 * Turns raw Ask Dapty calls into a conversation. The shapes are ai-service's
 * (apty-dap `shared/contracts/src/ai/ai-chat-widget/ai-chat-widget.schema.ts`):
 * a chat request carries the new question and the whole earlier
 * conversation as `context`, its answer `{reply, suggestions, title}`, and a
 * stored chat file `{id, name, messages}`. Every text is redacted here, so
 * nothing downstream holds the user's words unmasked.
 */
import { redactText } from "../../runtime/redaction-mode.js";
import type {
  DaptyCall,
  DaptyEvidence,
  DaptySource,
  DaptySuggestion,
  DaptyTurn,
  RawDaptyCall,
  RawDaptyDomTurn,
} from "./dapty-types.js";
import { quotedErrorText, type Rec, records, text } from "./pack-kit.js";

/** @internal */
export const MAX_TURNS = 50;
/** @internal */
export const MAX_TURN_CHARS = 4_000;

const CHAT_PATH =
  /\/ai-service\/api\/v1\/ai\/([^/]+)\/widget\/chat(?:\/stream)?$/;
const STORED_CHAT_PATH = /\/widget-chat\/([^/]+)\.json$/;

/** What a call is to the Ask Dapty check, or undefined when it is not one of its calls. */
export function daptyKindOf(
  url: string,
  method: string,
): RawDaptyCall["kind"] | undefined {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const verb = method.toUpperCase();
  if (verb === "POST" && CHAT_PATH.test(path)) return "chat";
  const stored = STORED_CHAT_PATH.exec(path);
  if (verb !== "GET" || !stored) return undefined;
  return stored[1] === "chat-list" ? "chat-list" : "stored-chat";
}

function idsOf(url: string): Pick<DaptyCall, "tenantId" | "applicationId"> {
  try {
    const parsed = new URL(url);
    const tenantId = CHAT_PATH.exec(parsed.pathname)?.[1];
    const applicationId = parsed.searchParams.get("applicationId") ?? undefined;
    return {
      ...(tenantId ? { tenantId: decodeURIComponent(tenantId) } : {}),
      ...(applicationId ? { applicationId } : {}),
    };
  } catch {
    return {};
  }
}

function json(body: string | undefined): unknown {
  if (body === undefined) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function shown(value: string): string {
  const masked = redactText(value.trim());
  return masked.length > MAX_TURN_CHARS
    ? `${masked.slice(0, MAX_TURN_CHARS)}…`
    : masked;
}

function suggestionsOf(value: unknown): DaptySuggestion[] {
  return records(value).flatMap((s): DaptySuggestion[] => {
    const name = text(s.name);
    const type =
      s.type === "workflow" || s.type === "knowledge_content"
        ? s.type
        : undefined;
    if (!name || !type) return [];
    const id = text(s.id);
    return [{ ...(id ? { id } : {}), name: shown(name), type }];
  });
}

function turn(
  role: unknown,
  content: unknown,
  suggestions: unknown,
): DaptyTurn | undefined {
  const words = text(content);
  if (!words) return undefined;
  const who = role === "user" || role === "assistant" ? role : undefined;
  if (!who) return undefined;
  return {
    role: who,
    text: shown(words),
    suggestions: suggestionsOf(suggestions),
  };
}

/**
 * The answer of a chat call: the JSON reply, or the `/stream` variant's
 * server-sent events, whose `done` frame carries the whole reply and a
 * `suggestions` frame the suggestions.
 */
function answerOf(body: string | undefined): Rec | undefined {
  const parsed = json(body);
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Rec;
  }
  if (body === undefined || !body.includes("data:")) return undefined;
  const answer: Rec = {};
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const frame = json(line.slice(5).trim());
    if (typeof frame !== "object" || frame === null) continue;
    const f = frame as Rec;
    if (f.type === "done") answer.reply = f.reply;
    if (f.type === "suggestions") answer.suggestions = f.suggestions;
  }
  return "reply" in answer ? answer : undefined;
}

/** The turns one chat call shows: its question with the earlier `context`, then its answer. */
function turnsOfChat(call: RawDaptyCall): DaptyTurn[] {
  const request = json(call.requestBody) as Rec | undefined;
  const answer = answerOf(call.responseBody);
  const turns: DaptyTurn[] = [];
  if (request) {
    for (const c of records(request.context)) {
      const t = turn(c.role, c.content, undefined);
      if (t) turns.push(t);
    }
    const asked = turn("user", request.message, undefined);
    if (asked) turns.push(asked);
  }
  const replied = answer && turn("assistant", answer.reply, answer.suggestions);
  if (replied) turns.push(replied);
  return turns;
}

function turnsOfStoredChat(call: RawDaptyCall): DaptyTurn[] {
  const chat = json(call.responseBody) as Rec | undefined;
  return records(chat?.messages).flatMap((m) => {
    const t = turn(m.role, m.content, m.suggestions);
    return t ? [t] : [];
  });
}

function modeOf(chat: RawDaptyCall): DaptyCall["mode"] {
  if (chat.source === "client") return "extension";
  if (chat.source === "page") return "injected";
  if (!chat.origin) return undefined;
  return chat.origin.startsWith("chrome-extension://")
    ? "extension"
    : "injected";
}

function callOf(chat: RawDaptyCall): DaptyCall {
  const mode = modeOf(chat);
  return {
    ...(chat.status !== undefined ? { status: chat.status } : {}),
    ...(chat.failed ? { failed: true } : {}),
    ...(chat.errorText ? { errorText: quotedErrorText(chat.errorText) } : {}),
    ...idsOf(chat.url),
    ...(mode ? { mode } : {}),
    timestamp: chat.timestamp,
  };
}

/**
 * The conversation from the calls one source saw, newest record first: a
 * chat call with its request holds every earlier turn in `context`; without
 * one, the newest stored chat file, followed by the answers of chat calls
 * made after it was read; without either, the answers alone.
 */
export function daptyEvidenceFromCalls(
  raw: readonly RawDaptyCall[],
  source: Exclude<DaptySource, "widget-dom">,
): DaptyEvidence {
  const calls = [...raw].sort((a, b) => a.timestamp - b.timestamp);
  const chats = calls.filter((c) => c.kind === "chat");
  const stored = calls.filter((c) => c.kind === "stored-chat");
  const withRequest = [...chats].reverse().find((c) => json(c.requestBody));
  const newestStored = [...stored]
    .reverse()
    .find((c) => turnsOfStoredChat(c).length > 0);

  let turns: DaptyTurn[];
  if (withRequest) {
    turns = turnsOfChat(withRequest);
  } else if (newestStored) {
    const after = chats.filter((c) => c.timestamp > newestStored.timestamp);
    turns = [...turnsOfStoredChat(newestStored), ...after.flatMap(turnsOfChat)];
  } else {
    turns = chats.flatMap(turnsOfChat);
  }

  const last = chats.at(-1);
  return {
    source,
    connection: { ok: true },
    turns: turns.slice(-MAX_TURNS),
    ...(last ? { lastCall: callOf(last) } : {}),
    calls: chats.length,
    storedChats: stored.length,
    suggestionIds: true,
  };
}

/**
 * The conversation from the widget's chat panel: names only, and no call to
 * judge. The capture layer's chat-panel reader feeds it at integration.
 * @internal
 */
export function daptyEvidenceFromDom(
  raw: readonly RawDaptyDomTurn[],
): DaptyEvidence {
  const turns = raw.flatMap((t): DaptyTurn[] => {
    const words = text(t.text);
    if (!words) return [];
    return [
      {
        role: t.role,
        text: shown(words),
        suggestions: t.suggestionNames.flatMap((name) =>
          text(name) ? [{ name: shown(name) }] : [],
        ),
      },
    ];
  });
  return {
    source: "widget-dom",
    connection: { ok: true },
    turns: turns.slice(-MAX_TURNS),
    calls: 0,
    storedChats: 0,
    suggestionIds: false,
  };
}
