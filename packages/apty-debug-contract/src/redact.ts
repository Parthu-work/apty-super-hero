/**
 * Sensitive-data redaction.
 *
 * Applied to any diagnostic evidence (console messages, network headers,
 * request/response bodies, peer-extension responses) before it is returned
 * to the AI model — and, per DECISIONS.md, applied a SECOND time at write
 * time (`recordEvidence`) as defence in depth. The webpage and any peer
 * extension are both untrusted and may contain secrets in logs, headers, or
 * payloads — none of that should reach the LLM in the clear.
 *
 * This lives in `@apty/debug-contract` (not `@apty/browser-runtime`) so a
 * PRODUCER (Apty Client/Studio's own service worker) can import the exact
 * same redaction logic and apply it at the SOURCE, before a log line ever
 * enters its own buffer — never relying on the agent to be the only line of
 * defence.
 *
 * This is a best-effort pattern match, not a guarantee — never assume text
 * that passed through here is fully safe if you know more sensitive
 * structure is expected; redact that structure explicitly (e.g. via
 * `redactHeaders`) before falling back to the free-text pass.
 */

/** Emails are redacted by default — flip only for a deliberate, documented reason (e.g. a debugging build), never silently. */
export const REDACT_EMAILS = true;

/** Hard cap on how much of one string this module will run regex passes over — bounds worst-case regex work independent of input size (ReDoS safety). The remainder is dropped with a visible marker, never silently. */
export const MAX_REDACT_INPUT_LENGTH = 100_000;

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

/**
 * A known fully-sensitive header name (the same set `redactHeaders` treats
 * as "redact the whole value") appearing at the START of a line as
 * `Name: value` — the free-text equivalent of `redactHeaders`' structured
 * behavior. Blanks the ENTIRE rest of the line, not just a `key=value`
 * fragment within it, because a `Cookie`/`Authorization` line's value is
 * opaque and potentially sensitive as a whole regardless of what any
 * individual `;`-separated piece is named (e.g. an unlabeled cookie pair
 * sitting next to a session cookie on the same header line).
 */
const SENSITIVE_HEADER_LINE_PATTERN = new RegExp(
  `^(${[...SENSITIVE_HEADER_NAMES].join("|")})\\s*:\\s*.+$`,
  "gim",
);

/**
 * Sensitive key-name fragment, matched as a case-insensitive SUBSTRING so it
 * catches camelCase (`authToken`), snake_case (`csrf_token`), and
 * kebab-case (`api-key`) alike. Deliberately broad (substring, not whole-word)
 * per spec — a false positive here only means "redacted something that
 * wasn't actually secret," which is the safe direction to err in.
 */
const SENSITIVE_KEY_FRAGMENT =
  "token|secret|password|passwd|pwd|api[_-]?key|auth|session|csrf|xsrf|jwt|credential|signature|private[_-]?key|otp|bearer";

/**
 * `key ":"|"=" (quoted-value | unquoted-value)` for any of the sensitive
 * key-name fragments above — covers JSON (`"password":"..."`), query
 * strings (`id_token=...&state=1`), headers (`csrf_token: ...`), and cookie
 * pairs (`sessionid=SECRET1; other=SECRET2`) in one pass, since the `g` flag
 * finds every independent occurrence regardless of surrounding structure.
 *
 * The key portion is deliberately `[\w-]{0,64}FRAGMENT[\w-]{0,64}`, NOT
 * `\bFRAGMENT\b` — a real word-boundary `\b` does not fire between two word
 * characters, so it can never match a fragment sitting inside a compound
 * identifier like `id_token` (the `_` is itself a word character) or
 * `sessionid` (no separator at all before the trailing "id"). The bounded
 * (never unbounded, for ReDoS safety) `[\w-]{0,64}` on each side allows the
 * fragment to appear ANYWHERE within a reasonable-length identifier —
 * substring matching, per spec, not whole-word matching. This deliberately
 * accepts some false positives (e.g. "author" contains "auth") — redacting
 * something that wasn't actually secret is the safe direction to err in.
 *
 * The quoted-value branch handles escaped characters (so a value containing
 * `\"` doesn't end the match early) and arbitrary interior whitespace (the
 * `{"password":"my secret pass phrase"}` case). The unquoted-value branch
 * stops at the delimiters that actually separate fields in the formats this
 * targets (`;`, `,`, `&`, whitespace, a closing brace/quote) — never at an
 * open brace/bracket, so it doesn't run away into unrelated JSON structure.
 *
 * The negative lookahead before the unquoted branch excludes a bare
 * `Bearer`/`Basic`/`Digest` scheme name: those are handled by
 * `AUTH_SCHEME_PATTERN` below, which runs first and already consumes the
 * whole "scheme + credential" — without this exclusion, a header like
 * `Authorization: Bearer abc.def.ghi` would match here too (key
 * "authorization" contains "auth"), redacting only the word "Bearer" and
 * leaving the actual credential exposed right after it — the exact
 * regression this rewrite exists to fix.
 */
const SENSITIVE_KEYVALUE_PATTERN = new RegExp(
  `(["']?[\\w-]{0,64}(?:${SENSITIVE_KEY_FRAGMENT})[\\w-]{0,64}["']?\\s*[:=]\\s*)(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)'|(?!(?:Bearer|Basic|Digest)\\b)([^;,&\\s"'}]+))`,
  "gi",
);

/** A raw `Bearer`/`Basic` credential, with or without a preceding key name (e.g. embedded directly in a log line). Runs BEFORE the generic key/value pass. */
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic|Digest)\s+[A-Za-z0-9\-._~+/]+=*/g;

/** JWT-shaped: three base64url segments, header segment starting `eyJ` (the base64url encoding of `{"`), anywhere in the text — not just after a recognized key name. */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

/** A PEM-armored block of any kind (private key, certificate, ...), single- or multi-line. */
const PEM_BLOCK_PATTERN =
  /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g;

/** `scheme://user:password@host` — the whole userinfo component, never just the password, since the username can itself be sensitive (an email, an account id). */
const URL_USERINFO_PATTERN = /\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s@]+)@/g;

/**
 * Exact query-param names used by cloud-signed URLs (AWS SigV4, Azure SAS,
 * GCS) whose VALUE is sensitive even though the name itself isn't in the
 * generic key-fragment list — deliberately an exact-name set, not a prefix
 * like `X-Amz-*`, since that family also carries non-secret metadata params
 * (`X-Amz-Date`, `X-Amz-Expires`, `X-Amz-Algorithm`, ...) that must stay
 * visible.
 */
const SIGNED_URL_PARAM_NAMES = new Set(
  [
    "x-amz-signature",
    "x-amz-credential",
    "x-amz-security-token",
    "signature",
    "awsaccesskeyid",
    "sig",
    "sv",
    "se",
    "sp",
    "sr",
    "skoid",
    "sktid",
    "skt",
    "ske",
    "sks",
    "skv",
  ].map((name) => name.toLowerCase()),
);

const SIGNED_URL_PARAM_PATTERN = new RegExp(
  `\\b(${[...SIGNED_URL_PARAM_NAMES].join("|")})=([^&\\s"'}]+)`,
  "gi",
);

/**
 * Well-known token/key shapes with a distinctive enough prefix that
 * matching them requires no surrounding key name at all:
 * AWS access key id, GitHub PAT/OAuth/user/server tokens, Slack tokens,
 * Google API keys, OpenAI/Anthropic-style secret keys.
 */
const KNOWN_TOKEN_SHAPE_PATTERN =
  /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]+|AIza[0-9A-Za-z_-]{35}|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,})\b/g;

const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;

function redactKeyValuePairs(text: string): string {
  return text.replace(
    SENSITIVE_KEYVALUE_PATTERN,
    (_match, prefix, dq, sq, unquoted) => {
      if (dq !== undefined) return `${prefix}"<REDACTED>"`;
      if (sq !== undefined) return `${prefix}'<REDACTED>'`;
      void unquoted;
      return `${prefix}<REDACTED>`;
    },
  );
}

/**
 * Redact sensitive values that appear inline in free-form text (console
 * messages, error strings, request/response bodies serialized as text, URLs).
 * Order matters: each pass below only needs to worry about patterns it
 * could otherwise collide with, documented pass-by-pass.
 */
export function redactSensitiveText(text: string): string {
  let truncated = text;
  let truncationNotice = "";
  if (truncated.length > MAX_REDACT_INPUT_LENGTH) {
    truncationNotice = ` […${truncated.length - MAX_REDACT_INPUT_LENGTH} more chars truncated before redaction]`;
    truncated = truncated.slice(0, MAX_REDACT_INPUT_LENGTH);
  }

  let result = truncated;
  // 0. A known fully-sensitive header name at the start of a line — blank
  //    the whole rest of that line first (see SENSITIVE_HEADER_LINE_PATTERN's
  //    doc comment), before any other pass gets a chance to only partially
  //    redact it.
  result = result.replace(SENSITIVE_HEADER_LINE_PATTERN, (line) => {
    const colonIndex = line.indexOf(":");
    return `${line.slice(0, colonIndex + 1)} <REDACTED>`;
  });
  // 1. PEM blocks first — they contain their own `:`/`=`-like base64 content
  //    that could otherwise confuse later passes, and are unambiguous once matched.
  result = result.replace(
    PEM_BLOCK_PATTERN,
    (_m, type) => `-----BEGIN ${type}-----<REDACTED>-----END ${type}-----`,
  );
  // 2. URL userinfo — before the email pattern, since `user:pass@host` reads
  //    like an email address once the scheme/userinfo separator is gone.
  result = result.replace(URL_USERINFO_PATTERN, "$1<REDACTED>@");
  // 3. Signed-URL query params (by name, regardless of the generic key-fragment list).
  result = result.replace(SIGNED_URL_PARAM_PATTERN, "$1=<REDACTED>");
  // 4. Auth schemes — before the generic key/value pass, so "Authorization: Bearer x.y.z" is fully consumed here first (see SENSITIVE_KEYVALUE_PATTERN's doc comment for why order matters).
  result = result.replace(AUTH_SCHEME_PATTERN, "$1 <REDACTED>");
  // 5. Bare JWTs anywhere (whatever's left after the auth-scheme pass already ate any that followed "Bearer ").
  result = result.replace(JWT_PATTERN, "<REDACTED>");
  // 6. Well-known token shapes, independent of any key name.
  result = result.replace(KNOWN_TOKEN_SHAPE_PATTERN, "<REDACTED>");
  // 7. Generic sensitive key = value (JSON/query/header/cookie shaped).
  result = redactKeyValuePairs(result);
  // 8. Emails, last (documented default-on constant).
  if (REDACT_EMAILS) {
    result = result.replace(EMAIL_PATTERN, "<REDACTED-EMAIL>");
  }

  return result + truncationNotice;
}

/**
 * Redact query-string parameters and userinfo in a URL specifically — for
 * call sites that only ever have a URL, not free text (network capture,
 * evidence records, peer responses). Delegates to the same passes as
 * `redactSensitiveText` so a signed-URL param or embedded credential is
 * handled identically wherever it appears.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = "<REDACTED>";
      parsed.password = "";
    }
    for (const [key] of [...parsed.searchParams.entries()]) {
      const fragmentMatch = new RegExp(
        `[\\w-]{0,64}(?:${SENSITIVE_KEY_FRAGMENT})[\\w-]{0,64}`,
        "i",
      ).test(key);
      const signedUrlMatch = SIGNED_URL_PARAM_NAMES.has(key.toLowerCase());
      if (fragmentMatch || signedUrlMatch) {
        parsed.searchParams.set(key, "<REDACTED>");
      }
    }
    return parsed.toString();
  } catch {
    // Not a parseable absolute URL (a relative path, or malformed) — fall
    // back to the same text-based passes rather than returning it unredacted.
    return redactSensitiveText(url);
  }
}

/** Redact an AptyLog-shaped entry's message field. */
export function redactLog<T extends { message: string }>(entry: T): T {
  return { ...entry, message: redactSensitiveText(entry.message) };
}

/** Redact every log entry's message field. */
export function redactLogs<T extends { message: string }>(entries: T[]): T[] {
  return entries.map(redactLog);
}
