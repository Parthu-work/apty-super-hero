/**
 * JSON-aware, key-path-based redaction.
 *
 * `redact.ts`'s free-text regex pipeline treats a `"cookie": {...}` object
 * value as an unquoted scalar (its unquoted-value branch stops at the first
 * delimiter it recognizes, which for an object value is neither `,` nor
 * `}` at the right depth) — so it redacts only a fragment of the object and
 * leaves the result invalid JSON, with the rest of the object's contents
 * (`"a":"b","c":"d"`) still exposed verbatim. Regex has no notion of
 * balanced braces; this module adds one.
 *
 * Two-tier strategy:
 * 1. If the ENTIRE input parses as JSON, walk the parsed value and
 *    `JSON.stringify` the redacted result — the common case for a log line
 *    that IS one JSON object, and the only way to guarantee valid JSON out.
 * 2. Otherwise (free text with embedded/truncated/prefixed JSON, the far
 *    more common shape of a real log line), scan for `"<known-key>":`
 *    occurrences directly and redact just that key's value in place —
 *    balanced-brace/bracket aware for object/array values, quote-aware for
 *    string values — without requiring the surrounding text to be valid
 *    JSON at all.
 *
 * Both tiers classify keys by exact normalized name (letters/digits only,
 * lowercased) or a defined prefix — never bare substring containment, so
 * `session_start_time`/`time_spent` are never mistaken for `session`/`token`
 * fields. This is deliberately different from `redact.ts`'s free-text
 * SENSITIVE_KEY_FRAGMENT pass, which still needs substring matching because
 * unstructured text has no delimited "key" to compare exactly — here, a
 * JSON object's own keys ARE exact, delimited strings, so exact-or-prefix
 * matching is both sufficient and much less prone to false positives.
 */

export type RedactionMode = "strict" | "standard" | "off";

export type KeyCategory = "secret" | "pii" | "page-context";

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Exact (post-normalization) key names whose value is always sensitive on its own — credentials, tokens, session identifiers. */
const SECRET_KEY_NAMES = new Set(
  [
    "token",
    "id_token",
    "csrf_token",
    "xsrf_token",
    "session_token",
    "auth_token",
    "authToken",
    "access_token",
    "refresh_token",
    "api_key",
    "apikey",
    "secret",
    "password",
    "passwd",
    "pwd",
    "private_key",
    "signature",
    "credential",
    "cookie",
    "set_cookie",
    "jwt",
    "otp",
    "bearer",
    "authorization",
    "session_id",
    "user_session_id",
    "sessionid",
  ].map(normalizeKey),
);

/** Exact (post-normalization) key names that are direct personal identifiers — redacted wholesale (there is no safe partial form of a name or email). */
const PII_KEY_NAMES = new Set(
  ["username", "email", "name", "phone", "address", "dob", "ssn", "mrn"].map(
    normalizeKey,
  ),
);

/** Prefixes (post-normalization) that mark a key as PII regardless of suffix — `patient_id`, `patientName`, `patientMrn`, ... */
const PII_KEY_PREFIXES = ["patient"].map(normalizeKey);

/** A PII-category key whose value is an opaque identifier, not free text — pseudonymize instead of wholesale-redacting, so repeated entries for the same user stay correlatable across a debugging session without exposing the real id. */
const PII_ID_KEY_NAMES = new Set(["user_id", "userid"].map(normalizeKey));

/** Exact (post-normalization) key names carrying page context that can itself be sensitive in a healthcare app (titles/paths naming a patient or record) — dropped/masked only in `strict` mode. */
const PAGE_CONTEXT_KEY_NAMES = new Set(
  ["page_title", "page_search", "page_path", "referrer"].map(normalizeKey),
);

function classifyKey(key: string): KeyCategory | null {
  const normalized = normalizeKey(key);
  if (SECRET_KEY_NAMES.has(normalized)) return "secret";
  if (PII_KEY_NAMES.has(normalized) || PII_ID_KEY_NAMES.has(normalized)) {
    return "pii";
  }
  if (PII_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "pii";
  }
  if (PAGE_CONTEXT_KEY_NAMES.has(normalized)) return "page-context";
  return null;
}

function categoryActiveInMode(
  category: KeyCategory,
  mode: RedactionMode,
): boolean {
  if (mode === "off") return false;
  if (category === "secret") return true;
  if (category === "pii") return mode === "strict" || mode === "standard";
  // "page-context"
  return mode === "strict";
}

/** A small, dependency-free, non-cryptographic hash (FNV-1a, 32-bit) — good enough to turn an identifier into a short, stable, non-reversible-in-practice token for correlating repeated entries; NOT a security control, just a debugging convenience. Runs in a service worker (no `node:crypto`) as well as Node test environments. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Stable per-value pseudonym, salted so it can't be dictionary-reversed by anyone without the salt (still not a cryptographic guarantee — a hash-based pseudonym, not encryption). */
export function pseudonymizeId(value: string, salt: string): string {
  return `u_${fnv1a(`${salt}:${value}`).toString(16).padStart(8, "0")}`;
}

/** ID-shaped path/query segments (UUIDs, long hex/numeric runs) — masked so a page path stays useful for debugging ("which route", not "which record") without naming a specific record. */
const ID_LIKE_SEGMENT_PATTERN =
  /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|\d{5,})\b/gi;

function maskIdLikeSegments(value: string): string {
  return value.replace(ID_LIKE_SEGMENT_PATTERN, "<ID>");
}

function redactPageContextValue(key: string, value: unknown): unknown {
  const normalized = normalizeKey(key);
  if (normalized === normalizeKey("page_search")) {
    // A query string is essentially arbitrary key/value data (often
    // including the very tokens WP1 already flags) — drop it entirely
    // rather than trying to selectively parse it.
    return typeof value === "string" ? "" : value;
  }
  if (typeof value !== "string") return value;
  if (normalized === normalizeKey("page_title")) return "<REDACTED>";
  return maskIdLikeSegments(value);
}

/** Recursively redact a parsed JSON value using the classification/mode rules above. Never invokes anything beyond plain data traversal — safe on arbitrary parsed JSON. */
export function redactJsonValue(
  value: unknown,
  mode: RedactionMode,
  salt: string,
): unknown {
  if (mode === "off") return value;
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item, mode, salt));
  }

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const category = classifyKey(key);
    if (!category || !categoryActiveInMode(category, mode)) {
      out[key] =
        typeof raw === "object" ? redactJsonValue(raw, mode, salt) : raw;
      continue;
    }

    if (category === "secret") {
      out[key] = "<REDACTED>";
    } else if (category === "pii") {
      if (PII_ID_KEY_NAMES.has(normalizeKey(key)) && typeof raw === "string") {
        out[key] = pseudonymizeId(raw, salt);
      } else {
        out[key] = "<REDACTED>";
      }
    } else {
      out[key] = redactPageContextValue(key, raw);
    }
  }
  return out;
}

/** Index just past the character that balances the opener at `openIndex` (`{`/`[`), string- and escape-aware, or -1 if the text ends unbalanced. */
function findBalancedEnd(text: string, openIndex: number): number {
  const opener = text[openIndex];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i++; // skip the escaped character
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === opener) {
      depth++;
    } else if (ch === closer) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Index just past the closing (unescaped) quote of a string starting at `quoteIndex` (the opening `"`), or -1 if unterminated. */
function findStringEnd(text: string, quoteIndex: number): number {
  for (let i = quoteIndex + 1; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === '"') return i + 1;
  }
  return -1;
}

const ALL_KNOWN_KEYS = [
  ...SECRET_KEY_NAMES,
  ...PII_KEY_NAMES,
  ...PII_ID_KEY_NAMES,
  ...PAGE_CONTEXT_KEY_NAMES,
];

/**
 * Scan free text for `"<known-key>"\s*:\s*<value>` occurrences (JSON- or
 * object-literal-shaped) and redact each value in place, whatever the
 * surrounding text looks like — including truncated/invalid JSON, which is
 * the normal shape of a real log line and exactly the case the whole-parse
 * tier can't handle. Only touches values whose key classifies as sensitive
 * in the given mode; everything else, including the surrounding braces the
 * key was found in, is left untouched.
 */
function redactKnownKeysInText(
  text: string,
  mode: RedactionMode,
  salt: string,
): string {
  if (mode === "off" || ALL_KNOWN_KEYS.length === 0) return text;

  // Matches "<any run of letters/digits/_>"\s*:\s* — then classifies the
  // captured key name itself (rather than baking every known key into the
  // alternation) so this stays correct if the known-key lists above grow.
  const KEY_PATTERN = /"([A-Za-z][A-Za-z0-9_]*)"\s*:\s*/g;

  let result = "";
  let lastIndex = 0;
  for (
    let match = KEY_PATTERN.exec(text);
    match !== null;
    match = KEY_PATTERN.exec(text)
  ) {
    const key = match[1] as string;
    const category = classifyKey(key);
    if (!category || !categoryActiveInMode(category, mode)) continue;

    const valueStart = KEY_PATTERN.lastIndex;
    const nextChar = text[valueStart];
    let valueEnd: number;
    let replacement: string;

    if (nextChar === "{" || nextChar === "[") {
      const end = findBalancedEnd(text, valueStart);
      if (end === -1) continue; // unbalanced to the end of input — leave as-is rather than guess
      valueEnd = end;
      replacement = category === "secret" ? '"<REDACTED>"' : '"<REDACTED>"';
    } else if (nextChar === '"') {
      const end = findStringEnd(text, valueStart);
      if (end === -1) continue;
      valueEnd = end;
      const raw = text.slice(valueStart + 1, end - 1);
      if (category === "pii" && PII_ID_KEY_NAMES.has(normalizeKey(key))) {
        replacement = `"${pseudonymizeId(raw, salt)}"`;
      } else if (category === "page-context") {
        const masked = redactPageContextValue(key, raw);
        replacement = `"${masked}"`;
      } else {
        replacement = '"<REDACTED>"';
      }
    } else {
      // Unquoted scalar (number/bool/null) — nothing meaningful to redact.
      continue;
    }

    result += text.slice(lastIndex, valueStart) + replacement;
    lastIndex = valueEnd;
    KEY_PATTERN.lastIndex = valueEnd;
  }
  result += text.slice(lastIndex);
  return result;
}

let installSalt: string | undefined;

/** A process-lifetime-stable salt for pseudonymizing IDs, generated once. Not persisted across restarts by design — pseudonyms only need to be stable within one debugging session, not forever, and never persisting it avoids it becoming its own secret to protect. */
function getInstallSalt(): string {
  if (!installSalt) {
    installSalt = `${Date.now()}-${Math.random()}`;
  }
  return installSalt;
}

/**
 * Redact known-sensitive JSON keys anywhere in `text`, preserving JSON
 * validity when the whole input happens to already be valid JSON, and
 * degrading gracefully (targeted in-place redaction, original structure
 * otherwise untouched) when it isn't. Safe to call on plain text with no
 * JSON in it at all — it will simply find nothing to do.
 */
export function redactJsonAware(
  text: string,
  mode: RedactionMode = "strict",
  salt: string = getInstallSalt(),
): string {
  if (mode === "off") return text;

  const trimmed = text.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      const redacted = redactJsonValue(parsed, mode, salt);
      return JSON.stringify(redacted);
    } catch {
      // Not actually valid JSON despite the brace/bracket wrapping (e.g.
      // truncated) — fall through to the targeted scan below.
    }
  }

  return redactKnownKeysInText(text, mode, salt);
}
