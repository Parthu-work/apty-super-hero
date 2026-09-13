/**
 * Sensitive-data redaction
 *
 * Applied to any diagnostic evidence (console messages, network headers,
 * request/response bodies) before it is returned to the AI model. The
 * webpage is untrusted and may contain secrets in logs, headers, or
 * payloads — none of that should reach the LLM in the clear.
 */

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "proxy-authorization",
]);

/** Redact a headers map (case-insensitive keys) in place-safe fashion, returning a new object. */
export function redactHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return headers;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase())
      ? "<REDACTED>"
      : value;
  }
  return result;
}

// Matches "key": "value" / key: value / key=value for a set of sensitive key
// names, case-insensitively, across quotes/colons/equals-signs commonly seen
// in JSON, headers, and log lines.
const SENSITIVE_INLINE_PATTERN =
  /(["']?\b(?:authorization|cookie|set-cookie|token|access[_-]?token|refresh[_-]?token|api[_-]?key|password|passwd|secret|client[_-]?secret)\b["']?\s*[:=]\s*)(["']?)([^"'\s,}]+)(["']?)/gi;

// Matches a bearer/basic auth value even when the key name itself wasn't
// caught above (e.g. a raw "Bearer eyJ..." string embedded in a log line).
const BEARER_TOKEN_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi;

/**
 * Redact sensitive values that appear inline in free-form text (console
 * messages, error strings, request/response bodies serialized as text).
 * This is a best-effort pattern match, not a guarantee — never assume text
 * that passed through here is fully safe if you know more sensitive
 * structure is expected; redact that structure explicitly (e.g. via
 * redactHeaders) before falling back to this.
 */
export function redactSensitiveText(text: string): string {
  return text
    .replace(
      SENSITIVE_INLINE_PATTERN,
      (_match, prefix, openQuote, _value, closeQuote) => {
        return `${prefix}${openQuote}<REDACTED>${closeQuote}`;
      },
    )
    .replace(BEARER_TOKEN_PATTERN, "$1 <REDACTED>");
}

/** Redact an AptyLog-shaped entry's message field. */
export function redactLog<T extends { message: string }>(entry: T): T {
  return { ...entry, message: redactSensitiveText(entry.message) };
}

/** Redact every log entry's message field. */
export function redactLogs<T extends { message: string }>(entries: T[]): T[] {
  return entries.map(redactLog);
}
