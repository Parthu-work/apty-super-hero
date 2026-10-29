import type { AgentError } from "@apty/agent-core";
import type { TranslationKey } from "../i18n/types";

export type ChatErrorKind =
  | "badKey"
  | "rateLimit"
  | "offline"
  | "network"
  | "notFound"
  | "toolCalling"
  | "contextTooLong"
  | "overBudget"
  | "timeout"
  | "cancelled"
  | "stepLimit"
  | "unknown";

/** A failed chat turn as the transcript keeps it: what kind of failure, and the provider's own words. */
export interface ChatErrorInfo {
  kind: ChatErrorKind;
  /** The error's message for the Details disclosure: no stack lines, no echoed keys. */
  message: string;
  retryAfterMs?: number;
}

const NETWORK_FAILURE =
  /failed to fetch|networkerror|network request failed|load failed|err_internet_disconnected|err_network_changed|err_name_not_resolved|err_connection_(refused|reset|closed)/i;
const CONTEXT_TOO_LONG =
  /context (length|window)|maximum context|too many tokens|prompt is too long|input is too long|exceeds? the (token|context) limit/i;
const TOOLS_UNSUPPORTED =
  /(does not|doesn't) support (tools|tool use|tool calling|function calling)|(tools|tool use|tool calling|function calling) (is |are )?not supported/i;
const MODEL_NOT_FOUND =
  /\bmodels?\b[^.\n]{0,80}\b(not found|does not exist|not exist)|no such model|unknown model/i;

const STACK_LINE = /^\s*at\s/;
const MAX_MESSAGE = 1000;

/** Keys and auth headers a provider can echo back, masked as Options masks its connection errors. */
export function maskSecrets(message: string): string {
  return message
    .replace(
      /Authorization:\s*(Bearer\s+)?[^\s,}"\]]+/gi,
      "Authorization: [REDACTED]",
    )
    .replace(/(bearer\s+)[a-zA-Z0-9._-]{10,}/gi, "$1[REDACTED]")
    .replace(
      /\b(sk-ant-|sk-or-v1-|sk-|gsk_|AIza)[a-zA-Z0-9_-]{8,}\b/g,
      "[REDACTED]",
    );
}

function statusCodeOf(error: AgentError): number | undefined {
  const value = error.context?.statusCode;
  return typeof value === "number" ? value : undefined;
}

function kindOf(error: AgentError, online: boolean): ChatErrorKind {
  const { message } = error;
  if (!online) return "offline";
  if (NETWORK_FAILURE.test(message)) return "network";
  switch (error.code) {
    case "LLM_RATE_LIMIT":
      return "rateLimit";
    case "LLM_AUTH_ERROR":
      return "badKey";
    case "LLM_TIMEOUT":
      return "timeout";
    case "TURN_CANCELLED":
      return "cancelled";
    case "MAX_TURNS_REACHED":
      return "stepLimit";
    case "REQUEST_OVER_BUDGET":
      return "overBudget";
  }
  const status = statusCodeOf(error);
  if (status === 413 || CONTEXT_TOO_LONG.test(message)) {
    return "contextTooLong";
  }
  if (TOOLS_UNSUPPORTED.test(message)) return "toolCalling";
  if (status === 404 || MODEL_NOT_FOUND.test(message)) return "notFound";
  return "unknown";
}

/** Which known failure an error is, from its code, its HTTP status and the provider's text. */
export function chatErrorInfo(
  error: AgentError,
  online = typeof navigator === "undefined" || navigator.onLine !== false,
): ChatErrorInfo {
  const retryAfterMs = error.context?.retryAfterMs;
  return {
    kind: kindOf(error, online),
    message: maskSecrets(
      error.message
        .split("\n")
        .filter((line) => !STACK_LINE.test(line))
        .join("\n")
        .trim(),
    ).slice(0, MAX_MESSAGE),
    ...(typeof retryAfterMs === "number" && retryAfterMs > 0
      ? { retryAfterMs }
      : {}),
  };
}

/** A stored failure the notice can show: a known kind and a message. */
export function isChatErrorInfo(value: unknown): value is ChatErrorInfo {
  if (!value || typeof value !== "object") return false;
  const { kind, message } = value as Record<string, unknown>;
  return (
    typeof kind === "string" &&
    Object.hasOwn(CHAT_ERROR_TEXT, kind) &&
    typeof message === "string"
  );
}

export const CHAT_ERROR_TEXT: Record<ChatErrorKind, TranslationKey> = {
  badKey: "chatErrors.badKey",
  rateLimit: "chatErrors.rateLimit",
  offline: "chatErrors.offline",
  network: "chatErrors.network",
  notFound: "chatErrors.notFound",
  toolCalling: "chatErrors.toolCalling",
  contextTooLong: "chatErrors.contextTooLong",
  overBudget: "chatErrors.overBudget",
  timeout: "chatErrors.timeout",
  cancelled: "chatErrors.cancelled",
  stepLimit: "chatErrors.stepLimit",
  unknown: "chatErrors.unknown",
};

/** The failures a change in Options → AI provider can fix. */
export function settingsCanFix(kind: ChatErrorKind): boolean {
  return (
    kind === "badKey" ||
    kind === "network" ||
    kind === "notFound" ||
    kind === "toolCalling" ||
    kind === "overBudget"
  );
}
