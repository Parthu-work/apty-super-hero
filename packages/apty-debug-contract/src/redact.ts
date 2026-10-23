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

import { type RedactionMode, redactJsonAware } from "./json-redact.js";

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

/** A raw `Bearer`/`Basic` credential, with or without a preceding key name (e.g. embedded directly in a log line). Runs BEFORE the generic key/value pass. */
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic|Digest)\s+[A-Za-z0-9\-._~+/]+=*/g;

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** `\w` in a pattern without the `u` flag: an ASCII letter, digit or `_`. */
function isWordChar(code: number): boolean {
  return isAsciiLetter(code) || (code >= 48 && code <= 57) || code === 95;
}

/** Whether `\b` holds at `index`: a word character on one side only. */
function isWordBoundary(text: string, index: number): boolean {
  const before = index > 0 && isWordChar(text.charCodeAt(index - 1));
  const after = index < text.length && isWordChar(text.charCodeAt(index));
  return before !== after;
}

/** `[\w-]`, the same as `[A-Za-z0-9_-]`: a character of a JWT segment or of a domain label. */
function isWordOrHyphen(code: number): boolean {
  return isWordChar(code) || code === 45;
}

/**
 * Where the longest run of `[A-Za-z0-9_-]` from `start` that ends at a word
 * boundary ends, or -1: what `[A-Za-z0-9_-]+\b` matches there, the end
 * stepping back from the longest run as the regex backtracks.
 */
function wordOrHyphenRunEnd(text: string, start: number): number {
  let end = start;
  while (isWordOrHyphen(text.charCodeAt(end))) end++;
  for (; end > start; end--) {
    if (isWordBoundary(text, end)) return end;
  }
  return -1;
}

/**
 * Each JWT-shaped string in `text` (three base64url segments, the header
 * starting `eyJ`, the base64url encoding of `{"`), left to right without
 * overlaps, anywhere in the text — not just after a recognized key name:
 * what `/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g` matches.
 * That regex tries every `eyJ` at a word boundary and scans the run after
 * it for a `.`, which is quadratic on a long run without one (`eyJ-eyJ-…`).
 * Every start in one run reaches the same `.`, so this starts from each `.`
 * and looks back for the leftmost `eyJ` the regex would start at.
 */
function jwtMatches(text: string): Array<[start: number, end: number]> {
  const matches: Array<[number, number]> = [];
  let from = 0;
  for (
    let dot = text.indexOf(".");
    dot !== -1;
    dot = text.indexOf(".", dot + 1)
  ) {
    if (dot < from) continue;
    let start = dot;
    while (start > from && isWordOrHyphen(text.charCodeAt(start - 1))) {
      start--;
    }
    while (
      start + 3 < dot &&
      !(text.startsWith("eyJ", start) && isWordBoundary(text, start))
    ) {
      start++;
    }
    if (start + 3 >= dot) continue;
    let secondDot = dot + 1;
    while (isWordOrHyphen(text.charCodeAt(secondDot))) secondDot++;
    if (secondDot === dot + 1 || text.charCodeAt(secondDot) !== 46) continue;
    const end = wordOrHyphenRunEnd(text, secondDot + 1);
    if (end === -1) continue;
    matches.push([start, end]);
    from = end;
  }
  return matches;
}

/** `text` with each JWT replaced. */
function redactJwts(text: string): string {
  let result = "";
  let last = 0;
  for (const [start, end] of jwtMatches(text)) {
    result += `${text.slice(last, start)}<REDACTED>`;
    last = end;
  }
  return result + text.slice(last);
}

const PEM_BEGIN = "-----BEGIN ";
const PEM_END = "-----END ";
const PEM_DASHES = "-----";

function isPemTypeChar(code: number): boolean {
  return (
    (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || code === 32
  );
}

/** The type at `index` in a BEGIN or END line: a run of A-Z, 0-9 and spaces closed by `-----`. */
function pemTypeAt(text: string, index: number): string | undefined {
  let end = index;
  while (end < text.length && isPemTypeChar(text.charCodeAt(end))) end++;
  if (end === index || !text.startsWith(PEM_DASHES, end)) return undefined;
  return text.slice(index, end);
}

/**
 * Every PEM-armored block of any kind (private key, certificate, ...),
 * single- or multi-line: `-----BEGIN <type>-----` up to the first
 * `-----END <type>-----` after it, left to right without overlaps — what
 * `/-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g` matches. That
 * regex rescans to the end of the text for each BEGIN line without an END,
 * which is quadratic; this finds each END line once.
 */
function pemBlocks(
  text: string,
): Array<{ start: number; end: number; type: string }> {
  const ends = new Map<string, number[]>();
  for (
    let i = text.indexOf(PEM_END);
    i !== -1;
    i = text.indexOf(PEM_END, i + 1)
  ) {
    const type = pemTypeAt(text, i + PEM_END.length);
    if (type === undefined) continue;
    const at = ends.get(type);
    if (at) at.push(i);
    else ends.set(type, [i]);
  }
  const blocks: Array<{ start: number; end: number; type: string }> = [];
  let from = 0;
  for (
    let i = text.indexOf(PEM_BEGIN);
    i !== -1;
    i = text.indexOf(PEM_BEGIN, Math.max(i + 1, from))
  ) {
    const type = pemTypeAt(text, i + PEM_BEGIN.length);
    if (type === undefined) continue;
    const bodyStart = i + PEM_BEGIN.length + type.length + PEM_DASHES.length;
    const endAt = firstAtOrAfter(ends.get(type) ?? [], bodyStart);
    if (endAt === undefined) continue;
    from = endAt + PEM_END.length + type.length + PEM_DASHES.length;
    blocks.push({ start: i, end: from, type });
  }
  return blocks;
}

/** The first number in ascending `list` that is at least `min`. */
function firstAtOrAfter(list: number[], min: number): number | undefined {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((list[mid] as number) < min) low = mid + 1;
    else high = mid;
  }
  return list[low];
}

/** `text` with each PEM block's body replaced, its BEGIN and END lines kept. */
function redactPemBlocks(text: string): string {
  let result = "";
  let last = 0;
  for (const { start, end, type } of pemBlocks(text)) {
    result += `${text.slice(last, start)}-----BEGIN ${type}-----<REDACTED>-----END ${type}-----`;
    last = end;
  }
  return result + text.slice(last);
}

/** `[a-zA-Z0-9+.-]`: a character of a URL scheme. */
function isSchemeChar(code: number): boolean {
  return (
    isAsciiLetter(code) ||
    (code >= 48 && code <= 57) ||
    code === 43 ||
    code === 46 ||
    code === 45
  );
}

/** `\s` in a pattern without the `u` flag: a JavaScript white space or line terminator character. */
function isRegExpSpace(code: number): boolean {
  return (
    (code >= 9 && code <= 13) ||
    code === 32 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/** `[^/\s@]`: a character of URL userinfo. */
function isUserinfoChar(code: number): boolean {
  return code !== 47 && code !== 64 && !isRegExpSpace(code);
}

/**
 * Each `scheme://userinfo@` in `text`, left to right without overlaps, with
 * where its `scheme://` ends: what
 * `/\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s@]+)@/g` matches. That regex
 * tries every word boundary and scans the run of scheme characters after it
 * for `://`, which is quadratic on a long run without one (`a-a-a-…`).
 * Every match holds a `://`, so this starts from each one and looks back
 * for the leftmost start the regex would take: a letter at a word boundary
 * in the run of scheme characters right before it.
 *
 * The whole userinfo component is masked, never just the password, since
 * the username can itself be sensitive (an email, an account id).
 */
function urlUserinfoMatches(
  text: string,
): Array<{ start: number; schemeEnd: number; end: number }> {
  const matches: Array<{ start: number; schemeEnd: number; end: number }> = [];
  let from = 0;
  for (
    let colon = text.indexOf("://");
    colon !== -1;
    colon = text.indexOf("://", colon + 1)
  ) {
    let start = colon;
    while (start > from && isSchemeChar(text.charCodeAt(start - 1))) start--;
    while (
      start < colon &&
      !(isAsciiLetter(text.charCodeAt(start)) && isWordBoundary(text, start))
    ) {
      start++;
    }
    if (start === colon) continue;
    let at = colon + 3;
    while (at < text.length && isUserinfoChar(text.charCodeAt(at))) at++;
    if (at === colon + 3 || text.charCodeAt(at) !== 64) continue;
    from = at + 1;
    matches.push({ start, schemeEnd: colon + 3, end: from });
  }
  return matches;
}

/** `text` with the userinfo of each URL replaced, its scheme and `@` kept. */
function redactUrlUserinfo(text: string): string {
  let result = "";
  let last = 0;
  for (const { schemeEnd, end } of urlUserinfoMatches(text)) {
    result += `${text.slice(last, schemeEnd)}<REDACTED>@`;
    last = end;
  }
  return result + text.slice(last);
}

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

/** `[\w.+-]`: a character of an email's local part. */
function isLocalPartChar(code: number): boolean {
  return isWordChar(code) || code === 46 || code === 43 || code === 45;
}

/**
 * Where the domain that starts at `start` ends, or -1: what
 * `[\w-]+(?:\.[\w-]+)+\b` matches there. The first label is taken whole and
 * then every `.label` after it; where `\b` does not hold at the end, the end
 * steps back through the last label and then the ones before it, as the
 * regex backtracks.
 */
function emailDomainEnd(text: string, start: number): number {
  let index = start;
  while (isWordOrHyphen(text.charCodeAt(index))) index++;
  if (index === start) return -1;
  const labels: Array<[shortestEnd: number, longestEnd: number]> = [];
  while (
    text.charCodeAt(index) === 46 &&
    isWordOrHyphen(text.charCodeAt(index + 1))
  ) {
    const labelStart = index + 1;
    index = labelStart + 1;
    while (isWordOrHyphen(text.charCodeAt(index))) index++;
    labels.push([labelStart + 1, index]);
  }
  for (let i = labels.length - 1; i >= 0; i--) {
    const [shortestEnd, longestEnd] = labels[i] as [number, number];
    for (let end = longestEnd; end >= shortestEnd; end--) {
      if (isWordBoundary(text, end)) return end;
    }
  }
  return -1;
}

/**
 * Each email address in `text`, left to right without overlaps: what
 * `/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g` matches. That regex tries every word
 * boundary and scans the run after it for an `@`, which is quadratic on a
 * long run without one (`a-a-a-…`). Every match holds exactly one `@`, so
 * this starts from each `@` and looks back for the leftmost start the regex
 * would take: a word boundary in the run of local-part characters right
 * before it.
 */
function emailMatches(text: string): Array<[start: number, end: number]> {
  const matches: Array<[number, number]> = [];
  let from = 0;
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    let start = at;
    while (start > from && isLocalPartChar(text.charCodeAt(start - 1))) {
      start--;
    }
    while (start < at && !isWordBoundary(text, start)) start++;
    if (start === at) continue;
    const end = emailDomainEnd(text, at + 1);
    if (end === -1) continue;
    matches.push([start, end]);
    from = end;
  }
  return matches;
}

/** `text` with each email address replaced. */
function redactEmails(text: string): string {
  let result = "";
  let last = 0;
  for (const [start, end] of emailMatches(text)) {
    result += `${text.slice(last, start)}<REDACTED-EMAIL>`;
    last = end;
  }
  return result + text.slice(last);
}

/**
 * A medical record number written out in text (`MRN 4815162342`,
 * `MRN#A-123456`, `medical record number: 123456`): the label stays, the
 * number (at least four characters, one a digit) is masked. The JSON-aware pass already covers an `mrn` key; this
 * covers the number inside a sentence, a URL or a log line. PII, so it runs
 * in strict and standard mode, like the PII key profiles.
 */
const MRN_PATTERN =
  /\b(MRN|medical[\s_-]+record[\s_-]+(?:number|num|no\.?|#))(\s*[:#=]\s*|\s+|(?=\d))((?=[A-Z-]*\d)[A-Z0-9][A-Z0-9-]{3,})\b/gi;

/**
 * `key ":"|"=" (quoted-value | unquoted-value)` for any of the sensitive
 * key-name fragments above — covers JSON (`"password":"..."`), query
 * strings (`id_token=...&state=1`), headers (`csrf_token: ...`), and cookie
 * pairs (`sessionid=SECRET1; other=SECRET2`) in one pass, finding every
 * independent occurrence regardless of surrounding structure. Each value is
 * replaced as replacing
 * `/(["']?[\w-]{0,64}(?:FRAGMENT)[\w-]{0,64}["']?\s*[:=]\s*)(?:"((?:[^"\\]|\\.)*)(?:"|$)|'((?:[^'\\]|\\.)*)(?:'|$)|(?!(?:Bearer|Basic|Digest)\b)([^;,&\s"'}]+))/gi`
 * does.
 *
 * The key is a run of `[\w-]` holding a fragment anywhere, NOT a whole word
 * bounded by `\b` — `\b` does not fire between two word characters, so it
 * could never match a fragment inside a compound identifier like `id_token`
 * (the `_` is itself a word character) or `sessionid`. This deliberately
 * accepts some false positives (e.g. "author" contains "auth") — redacting
 * something that wasn't actually secret is the safe direction to err in.
 * As in the regex, at most 64 characters of the key may follow the fragment.
 *
 * That regex tried every start in a long run of key characters and, for
 * each, every place the fragment could sit, so it cost about 10 µs per
 * character on a run full of fragments (`token-token-…`). Every match holds
 * exactly one `:` or `=` after its key, so this starts from each one and
 * looks back over the at most 64 + 11 key characters a fragment can sit in.
 *
 * A quoted value with no closing quote (a truncated body) runs to the end
 * of the input and is redacted whole. A quoted value may hold escaped
 * characters (so a value containing `\"` doesn't end the match early) and
 * arbitrary interior whitespace (the `{"password":"my secret pass phrase"}`
 * case). An unquoted value stops at the delimiters that actually separate
 * fields in the formats this targets (`;`, `,`, `&`, whitespace, a closing
 * brace/quote) — never at an open brace/bracket, so it doesn't run away
 * into unrelated JSON structure.
 *
 * An unquoted value never starts with a bare `Bearer`/`Basic`/`Digest`
 * scheme name: those are handled by `AUTH_SCHEME_PATTERN` below, which runs
 * first and already consumes the whole "scheme + credential" — without this
 * exclusion, a header like `Authorization: Bearer abc.def.ghi` would match
 * here too (key "authorization" contains "auth"), redacting only the word
 * "Bearer" and leaving the actual credential exposed right after it.
 */
function redactKeyValuePairs(text: string): string {
  let result = "";
  let last = 0;
  for (const { valueStart, end, quote } of keyValueMatches(text)) {
    const masked =
      quote === undefined ? "<REDACTED>" : `${quote}<REDACTED>${quote}`;
    result += `${text.slice(last, valueStart)}${masked}`;
    last = end;
  }
  return result + text.slice(last);
}

/** Each spelling of the fragments in `SENSITIVE_KEY_FRAGMENT`, lowercase: `api[_-]?key` is `apikey`, `api_key` and `api-key`. */
const SENSITIVE_KEY_SPELLINGS = [
  ...new Set(
    SENSITIVE_KEY_FRAGMENT.split("|").flatMap((fragment) =>
      ["", "_", "-"].map((separator) => fragment.replace("[_-]?", separator)),
    ),
  ),
];

const LONGEST_SENSITIVE_KEY_SPELLING = Math.max(
  ...SENSITIVE_KEY_SPELLINGS.map((spelling) => spelling.length),
);

/** How many key characters may follow the fragment. */
const KEY_CHARS_AFTER_FRAGMENT = 64;

/** Whether `spelling` (lowercase ASCII) is at `index`, in any case. */
function spelledAt(text: string, index: number, spelling: string): boolean {
  for (let i = 0; i < spelling.length; i++) {
    let code = text.charCodeAt(index + i);
    if (code >= 65 && code <= 90) code += 32;
    if (code !== spelling.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Whether the `[\w-]` run ending at `keyEnd`, from `from` on, holds a
 * fragment followed by at most 64 more key characters: whether some start
 * from `from` on reads as a sensitive key ending there.
 */
function endsSensitiveKey(text: string, from: number, keyEnd: number): boolean {
  const lowest = Math.max(
    from,
    keyEnd - KEY_CHARS_AFTER_FRAGMENT - LONGEST_SENSITIVE_KEY_SPELLING,
  );
  for (
    let index = keyEnd - 1;
    index >= lowest && isWordOrHyphen(text.charCodeAt(index));
    index--
  ) {
    for (const spelling of SENSITIVE_KEY_SPELLINGS) {
      const fragmentEnd = index + spelling.length;
      if (
        fragmentEnd <= keyEnd &&
        fragmentEnd >= keyEnd - KEY_CHARS_AFTER_FRAGMENT &&
        spelledAt(text, index, spelling)
      ) {
        return true;
      }
    }
  }
  return false;
}

function isQuote(code: number): boolean {
  return code === 34 || code === 39;
}

/** A line terminator, the characters `.` does not match. */
function isLineTerminator(code: number): boolean {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

/** `[;,&\s"'}]`: a character that ends an unquoted value. */
function endsUnquotedValue(code: number): boolean {
  return (
    code === 59 ||
    code === 44 ||
    code === 38 ||
    code === 125 ||
    isQuote(code) ||
    isRegExpSpace(code)
  );
}

interface KeyValueMatch {
  valueStart: number;
  end: number;
  /** The quote around the value, if it is quoted. */
  quote?: string;
}

/**
 * The value after the `:` or `=` before `afterSeparator`, or undefined
 * when none can follow it there.
 */
function valueAfter(
  text: string,
  afterSeparator: number,
): KeyValueMatch | undefined {
  let valueStart = afterSeparator;
  while (isRegExpSpace(text.charCodeAt(valueStart))) valueStart++;
  const first = text.charCodeAt(valueStart);
  if (isQuote(first)) {
    let index = valueStart + 1;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code === first) break;
      if (code === 92) {
        if (
          index + 1 === text.length ||
          isLineTerminator(text.charCodeAt(index + 1))
        ) {
          return undefined;
        }
        index += 2;
      } else {
        index++;
      }
    }
    return {
      valueStart,
      end: Math.min(index + 1, text.length),
      quote: String.fromCharCode(first),
    };
  }
  if (valueStart === text.length || endsUnquotedValue(first)) return undefined;
  for (const scheme of ["bearer", "basic", "digest"]) {
    if (
      spelledAt(text, valueStart, scheme) &&
      isWordBoundary(text, valueStart + scheme.length)
    ) {
      return undefined;
    }
  }
  let end = valueStart + 1;
  while (end < text.length && !endsUnquotedValue(text.charCodeAt(end))) end++;
  return { valueStart, end };
}

/** Each sensitive key's value in `text`, left to right without overlaps. */
function keyValueMatches(text: string): KeyValueMatch[] {
  const matches: KeyValueMatch[] = [];
  let from = 0;
  for (let separator = 0; separator < text.length; separator++) {
    const code = text.charCodeAt(separator);
    if (code !== 58 && code !== 61) continue;
    let keyEnd = separator;
    while (keyEnd > from && isRegExpSpace(text.charCodeAt(keyEnd - 1))) {
      keyEnd--;
    }
    if (keyEnd > from && isQuote(text.charCodeAt(keyEnd - 1))) keyEnd--;
    if (!endsSensitiveKey(text, from, keyEnd)) continue;
    const value = valueAfter(text, separator + 1);
    if (value === undefined) continue;
    matches.push(value);
    from = value.end;
    separator = from - 1;
  }
  return matches;
}

/**
 * Redact sensitive values that appear inline in free-form text (console
 * messages, error strings, request/response bodies serialized as text, URLs).
 * Order matters: each pass below only needs to worry about patterns it
 * could otherwise collide with, documented pass-by-pass.
 *
 * `mode` gates the JSON-aware key-profile pass (0, below) and the PII
 * pattern (7.5) only — "off" is a deliberate, explicit development-only
 * escape hatch for over-eager PII/page-context stripping (see
 * json-redact.ts), never for the structural passes that follow it
 * (PEM/JWT/Bearer/known token shapes/emails): those catch a credential by
 * its SHAPE regardless of what key it sits under, and always run, in every
 * mode, because there is no comparable "false positive" cost to weigh
 * against leaving a real credential exposed.
 *
 * A JSON object or array is redacted value by value (`redactJsonText`), so
 * the result is still JSON; anything else, or JSON that can't be, is
 * redacted as one text.
 */
export function redactSensitiveText(
  text: string,
  mode: RedactionMode = "strict",
): string {
  let truncated = text;
  let truncationNotice = "";
  if (truncated.length > MAX_REDACT_INPUT_LENGTH) {
    truncationNotice = ` […${truncated.length - MAX_REDACT_INPUT_LENGTH} more chars truncated before redaction]`;
    truncated = truncated.slice(0, MAX_REDACT_INPUT_LENGTH);
  } else {
    const json = redactJsonText(truncated, mode);
    if (json !== undefined) return json;
  }

  // 0. JSON-aware key-profile redaction (secrets/pii/page-context, by exact
  //    key name) — must run first so an object/array-valued sensitive key
  //    (e.g. `"cookie": {...}`) is redacted as a whole, balanced unit
  //    instead of the scalar-oriented regex below only partially consuming
  //    it and corrupting the surrounding JSON.
  return redactKeyedText(truncated, mode) + truncationNotice;
}

/** What the passes write in place of what they mask. */
const PLACEHOLDER_PATTERN = /<REDACTED(?:-EMAIL)?>/g;

const WORD_PATTERN = /[\p{L}\p{N}]+/gu;

/**
 * Passes 0 to 8 over text that is not one JSON value. Pass 0 masks an
 * object or array under a hyphenated sensitive key (`"X-Api-Key": {...}`)
 * whole, which can cost a later pass a match that started inside that
 * value and ran past it (a PEM block or URL userinfo split across members,
 * a `token=` run past `]`). Where the result then shows some word more
 * often than the result without hyphenated keys does, that one is used:
 * this never shows more than redaction did before it matched them.
 */
function redactKeyedText(text: string, mode: RedactionMode): string {
  const keyed = redactJsonAware(text, mode);
  const redacted = redactPatterns(keyed, mode);
  const keyedAsBefore = redactJsonAware(text, mode, undefined, {
    hyphenatedKeys: false,
  });
  if (keyedAsBefore === keyed) return redacted;
  const asBefore = redactPatterns(keyedAsBefore, mode);
  return showsMoreThan(redacted, asBefore) ? asBefore : redacted;
}

/** Whether `candidate` shows some word more often than `reference` does, placeholders aside. */
function showsMoreThan(candidate: string, reference: string): boolean {
  const left = new Map<string, number>();
  for (const [word] of reference
    .replace(PLACEHOLDER_PATTERN, " ")
    .matchAll(WORD_PATTERN)) {
    left.set(word, (left.get(word) ?? 0) + 1);
  }
  for (const [word] of candidate
    .replace(PLACEHOLDER_PATTERN, " ")
    .matchAll(WORD_PATTERN)) {
    const count = left.get(word) ?? 0;
    if (count === 0) return true;
    left.set(word, count - 1);
  }
  return false;
}

/** Passes 0.5 to 8 of `redactSensitiveText`: everything after the key-profile pass. */
function redactPatterns(text: string, mode: RedactionMode): string {
  let result = text;
  // 0.5. A known fully-sensitive header name at the start of a line — blank
  //    the whole rest of that line first (see SENSITIVE_HEADER_LINE_PATTERN's
  //    doc comment), before any other pass gets a chance to only partially
  //    redact it.
  result = result.replace(SENSITIVE_HEADER_LINE_PATTERN, (line) => {
    const colonIndex = line.indexOf(":");
    return `${line.slice(0, colonIndex + 1)} <REDACTED>`;
  });
  // 1. PEM blocks first — they contain their own `:`/`=`-like base64 content
  //    that could otherwise confuse later passes, and are unambiguous once matched.
  result = redactPemBlocks(result);
  // 2. URL userinfo — before the email pattern, since `user:pass@host` reads
  //    like an email address once the scheme/userinfo separator is gone.
  result = redactUrlUserinfo(result);
  // 3. Signed-URL query params (by name, regardless of the generic key-fragment list).
  result = result.replace(SIGNED_URL_PARAM_PATTERN, "$1=<REDACTED>");
  // 4. Auth schemes — before the generic key/value pass, so "Authorization: Bearer x.y.z" is fully consumed here first (see redactKeyValuePairs's doc comment for why order matters).
  result = result.replace(AUTH_SCHEME_PATTERN, "$1 <REDACTED>");
  // 5. Bare JWTs anywhere (whatever's left after the auth-scheme pass already ate any that followed "Bearer ").
  result = redactJwts(result);
  // 6. Well-known token shapes, independent of any key name.
  result = result.replace(KNOWN_TOKEN_SHAPE_PATTERN, "<REDACTED>");
  // 7. Generic sensitive key = value (JSON/query/header/cookie shaped).
  result = redactKeyValuePairs(result);
  // 7.5. Medical record numbers in free text (PII: strict and standard).
  if (mode !== "off") {
    result = result.replace(MRN_PATTERN, "$1$2<REDACTED>");
  }
  // 8. Emails, last (documented default-on constant).
  if (REDACT_EMAILS) {
    result = redactEmails(result);
  }
  return result;
}

const REDACTED = "<REDACTED>";

/** Whether the key/value pass masks the value of a JSON property named `key`. */
function isSensitiveKeyName(key: string): boolean {
  const probe = `"${JSON.stringify(key).slice(1, -1)}":"v"`;
  return redactKeyValuePairs(probe) !== probe;
}

/**
 * A JSON string as the passes leave it when they see it inside the JSON
 * text (escaped, between its quotes), or a placeholder when what they leave
 * no longer reads as a string.
 */
function redactJsonString(value: string, mode: RedactionMode): string {
  const literal = JSON.stringify(value).slice(1, -1);
  const redacted = redactPatterns(literal, mode);
  if (redacted === literal) return value;
  try {
    const parsed: unknown = JSON.parse(`"${redacted}"`);
    if (typeof parsed === "string") return parsed;
  } catch {
    // Falls through to the placeholder.
  }
  return REDACTED;
}

function redactJsonNode(node: unknown, mode: RedactionMode): unknown {
  if (typeof node === "string") return redactJsonString(node, mode);
  if (Array.isArray(node))
    return node.map((item) => redactJsonNode(item, mode));
  if (typeof node === "object" && node !== null) {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [
        redactJsonString(key, mode),
        isSensitiveKeyName(key) ? REDACTED : redactJsonNode(value, mode),
      ]),
    );
  }
  return node;
}

/**
 * A JSON object or array redacted value by value with the same passes, so
 * the result is still JSON: a property whose key the key/value pass treats
 * as sensitive loses its whole value, whatever its type (over the text, a
 * number came out as a bare `<REDACTED>` and an object lost only its `{`),
 * and a string ending in `token=` no longer masks what follows its closing
 * quote. Undefined, so the text is redacted as before, when the input is
 * not a JSON object or array, or when a PEM block or URL userinfo match
 * would run from one value into the next: over the text that match is
 * masked, value by value it would not be.
 */
function redactJsonText(text: string, mode: RedactionMode): string | undefined {
  const trimmed = text.trim();
  const looksLikeJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!looksLikeJson) return undefined;
  let keyed: unknown;
  try {
    keyed = JSON.parse(redactJsonAware(trimmed, mode));
  } catch {
    return undefined;
  }
  const compact = JSON.stringify(keyed);
  if (unboundedPatternMatches(compact).some((match) => match.includes('"'))) {
    return undefined;
  }
  return JSON.stringify(redactJsonNode(keyed, mode));
}

/**
 * What the two passes of `redactSensitiveText` that are not bounded by a
 * quote character (PEM blocks, URL userinfo) would match in `text`, in the
 * order that function runs them. A caller that redacts a JSON text member by
 * member uses it to find a match that would cross from one member into the
 * next, which redacting the members apart would miss.
 */
export function unboundedPatternMatches(text: string): string[] {
  const pem = pemBlocks(text).map(({ start, end }) => text.slice(start, end));
  const afterPem = redactPemBlocks(text);
  const userinfo = urlUserinfoMatches(afterPem).map(({ start, end }) =>
    afterPem.slice(start, end),
  );
  return [...pem, ...userinfo];
}

/**
 * Whether a query parameter's value is masked by name: a signed-URL
 * parameter, or a name holding a sensitive key fragment anywhere, in any
 * ASCII case (what `/[\w-]{0,64}(?:FRAGMENT)[\w-]{0,64}/i.test(name)`
 * answered, since both sides may be empty).
 */
function isSensitiveQueryName(name: string): boolean {
  if (SIGNED_URL_PARAM_NAMES.has(name.toLowerCase())) return true;
  for (let index = 0; index < name.length; index++) {
    for (const spelling of SENSITIVE_KEY_SPELLINGS) {
      if (spelledAt(name, index, spelling)) return true;
    }
  }
  return false;
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
    const params = [...parsed.searchParams];
    if (params.some(([name]) => isSensitiveQueryName(name))) {
      // What calling `searchParams.set(name, "<REDACTED>")` for each
      // sensitive name did, in one pass: the first parameter of that name
      // keeps its place with the value masked, the others are dropped.
      // Each `set` re-serialized the whole query, so that was quadratic in
      // the number of parameters.
      const masked = new URLSearchParams();
      const maskedNames = new Set<string>();
      for (const [name, value] of params) {
        if (!isSensitiveQueryName(name)) {
          masked.append(name, value);
        } else if (!maskedNames.has(name)) {
          maskedNames.add(name);
          masked.append(name, "<REDACTED>");
        }
      }
      parsed.search = masked.toString();
    }
    return parsed.toString();
  } catch {
    // Not a parseable absolute URL (a relative path, or malformed) — fall
    // back to the same text-based passes rather than returning it unredacted.
    return redactSensitiveText(url);
  }
}

/** Redact an AptyLog-shaped entry's message field. */
export function redactLog<T extends { message: string }>(
  entry: T,
  mode: RedactionMode = "strict",
): T {
  return { ...entry, message: redactSensitiveText(entry.message, mode) };
}

/** Redact every log entry's message field. */
export function redactLogs<T extends { message: string }>(
  entries: T[],
  mode: RedactionMode = "strict",
): T[] {
  return entries.map((entry) => redactLog(entry, mode));
}
