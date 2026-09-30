export enum ErrorCode {
  // LLM errors
  LLM_API_ERROR = "LLM_API_ERROR",
  LLM_STREAM_ERROR = "LLM_STREAM_ERROR",
  LLM_TIMEOUT = "LLM_TIMEOUT",
  LLM_RATE_LIMIT = "LLM_RATE_LIMIT",
  LLM_INVALID_RESPONSE = "LLM_INVALID_RESPONSE",
  LLM_AUTH_ERROR = "LLM_AUTH_ERROR",

  // Tool errors
  TOOL_NOT_FOUND = "TOOL_NOT_FOUND",
  TOOL_EXECUTION_ERROR = "TOOL_EXECUTION_ERROR",
  TOOL_TIMEOUT = "TOOL_TIMEOUT",
  TOOL_VALIDATION_ERROR = "TOOL_VALIDATION_ERROR",

  // Session errors
  SESSION_NOT_FOUND = "SESSION_NOT_FOUND",
  SESSION_EXPIRED = "SESSION_EXPIRED",

  // Execution errors
  MAX_TURNS_REACHED = "MAX_TURNS_REACHED",
  LOOP_DETECTED = "LOOP_DETECTED",
  TURN_CANCELLED = "TURN_CANCELLED",
}

export class AgentError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public recoverable = false,
    public context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AgentError";
    Object.setPrototypeOf(this, AgentError.prototype);
  }
}

export class LLMError extends AgentError {
  constructor(
    message: string,
    code: ErrorCode,
    public provider: string,
    public retryDelay?: number,
  ) {
    super(message, code, code !== ErrorCode.LLM_INVALID_RESPONSE, {
      provider,
      retryDelay,
    });
    this.name = "LLMError";
    Object.setPrototypeOf(this, LLMError.prototype);
  }
}

export class LLMStreamError extends LLMError {
  constructor(message: string, provider: string, retryDelay?: number) {
    super(message, ErrorCode.LLM_STREAM_ERROR, provider, retryDelay);
    this.name = "LLMStreamError";
    this.recoverable = true;
    Object.setPrototypeOf(this, LLMStreamError.prototype);
  }
}

export class ToolError extends AgentError {
  constructor(
    message: string,
    code: ErrorCode,
    public toolName: string,
    public shouldContinue = true,
  ) {
    super(message, code, shouldContinue, { toolName });
    this.name = "ToolError";
    Object.setPrototypeOf(this, ToolError.prototype);
  }
}

export class ToolTimeoutError extends ToolError {
  constructor(toolName: string, timeoutMs: number) {
    super(
      `Tool ${toolName} execution timeout after ${timeoutMs}ms`,
      ErrorCode.TOOL_TIMEOUT,
      toolName,
      true,
    );
    this.name = "ToolTimeoutError";
    Object.setPrototypeOf(this, ToolTimeoutError.prototype);
  }
}

export class TurnCancelledError extends AgentError {
  constructor(reason: string) {
    super(`Turn cancelled: ${reason}`, ErrorCode.TURN_CANCELLED, false);
    this.name = "TurnCancelledError";
    Object.setPrototypeOf(this, TurnCancelledError.prototype);
  }
}

export interface ClassifiedLlmError {
  code: ErrorCode;
  recoverable: boolean;
  statusCode?: number;
  retryAfterMs?: number;
}

/** Read an HTTP-status-like field off an error object, following one level of `.cause` nesting (fetch-based SDKs sometimes wrap the real error there). */
function extractStatusCode(error: unknown, depth = 0): number | undefined {
  if (depth > 1 || !error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  for (const key of ["statusCode", "status", "httpStatus"]) {
    const value = record[key];
    if (typeof value === "number") return value;
  }
  return extractStatusCode(record.cause, depth + 1);
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}

/** `retry-after` is seconds per HTTP spec (a small integer), not milliseconds — occasionally an SDK normalizes it to ms already; treat anything above 3600 as already-ms rather than an implausible multi-hour wait. */
function extractRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  const headers = record.responseHeaders ?? record.headers;
  const raw = readHeader(headers, "retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isNaN(seconds) || seconds < 0) return undefined;
  return seconds > 3600 ? seconds : seconds * 1000;
}

/**
 * Classify an arbitrary thrown value into one of the existing `ErrorCode`s
 * (rate limit / auth / timeout / cancelled / generic API error) instead of
 * always collapsing to `LLM_API_ERROR`, which previously made every
 * failure look identically non-retryable to the UI regardless of cause.
 * Best-effort: prefers an HTTP status code when one is present on the
 * error (or one level of `.cause`), falls back to message-text heuristics.
 */
export function classifyLlmError(error: unknown): ClassifiedLlmError {
  if (error instanceof AgentError) {
    return { code: error.code, recoverable: error.recoverable };
  }

  const name = error instanceof Error ? error.name : undefined;
  const message = error instanceof Error ? error.message : String(error ?? "");
  const statusCode = extractStatusCode(error);
  const retryAfterMs = extractRetryAfterMs(error);

  if (name === "AbortError" || /\baborted?\b/i.test(message)) {
    return { code: ErrorCode.TURN_CANCELLED, recoverable: false, statusCode };
  }
  if (statusCode === 429 || /rate.?limit|too many requests/i.test(message)) {
    return {
      code: ErrorCode.LLM_RATE_LIMIT,
      recoverable: true,
      retryAfterMs,
      statusCode,
    };
  }
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    /unauthorized|invalid api key|authentication failed|forbidden/i.test(
      message,
    )
  ) {
    return { code: ErrorCode.LLM_AUTH_ERROR, recoverable: false, statusCode };
  }
  if (
    statusCode === 408 ||
    statusCode === 504 ||
    /timed? ?out/i.test(message)
  ) {
    return { code: ErrorCode.LLM_TIMEOUT, recoverable: true, statusCode };
  }
  if (statusCode !== undefined && statusCode >= 500) {
    return { code: ErrorCode.LLM_API_ERROR, recoverable: true, statusCode };
  }
  if (statusCode !== undefined && statusCode >= 400) {
    return { code: ErrorCode.LLM_API_ERROR, recoverable: false, statusCode };
  }
  // No usable status code and no recognized message pattern — assume
  // transient (a network blip, a stream hiccup) rather than a hard failure,
  // since those are far more common than a truly unrecoverable unknown error.
  return { code: ErrorCode.LLM_API_ERROR, recoverable: true, statusCode };
}
