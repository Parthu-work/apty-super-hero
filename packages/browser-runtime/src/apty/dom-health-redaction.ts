/**
 * Privacy boundary for everything DOM Health returns.
 *
 * DOM Health reads customer DOMs, healthcare tenants included, and its
 * result reaches the AI model (the `run_dom_health_audit` tools), the side
 * panel and the stored conversation. Before this module none of it passed
 * through `@apty/debug-contract`'s redaction: selectors, element paths,
 * `data-*` values, frame URLs and the page title went out verbatim. The
 * real exports in section 2 of the DOM Health brief show what that leaks:
 *
 * - athenaOne puts the 7-digit practice id in the URL path
 *   (`/<practice-id>/2/`) and the practice name and id in `document.title`.
 * - Infor OS Portal loads LN with `inforTenantId=<16 characters>_TRN` and
 *   `inforSessionId=<tenant>~<GUID>` in the application iframe's `src`
 *   (measured in the attached LN export; the brief's Factory Track example
 *   uses `tenant=` the same way).
 *
 * Applied once, at the exit of `runDomHealthAudit` and
 * `runApplicationDomHealthAudit`, and never to the internal results the
 * application audit navigates and replays with: a redacted element path
 * can no longer find its element.
 *
 * Pattern-based, like the library it builds on: a name or other free text
 * with no identifying shape is not detected. Page titles are dropped for
 * that reason rather than scrubbed (see `REDACTED_TITLE`).
 */
import { redactSensitiveText, redactUrl } from "@apty/debug-contract";
import { isIdReferenceAttribute, maskIdReference } from "@apty/dom-snapshot";

/**
 * What a captured `document.title` becomes. Titles are page context the
 * debug-contract library already redacts wholesale in its strict mode
 * (`PAGE_CONTEXT_KEY_NAMES`), and athenaOne's names the practice and its
 * id; a chart screen naming a patient is the case that rules out
 * scrubbing (from general knowledge of EHR title conventions, not seen in
 * the exports).
 */
export const REDACTED_TITLE = "<REDACTED-TITLE>";

/**
 * Identifier-shaped values: a GUID, 16+ hex characters, or 5+ digits. The
 * same shapes `@apty/debug-contract` masks in page paths. Covers athenaOne's
 * 7-digit practice id and the GUID in LN's frame name; leaves short
 * counters such as athenaOne's department segment `/2/` alone. Bounded by
 * "not a letter or digit" rather than `\b`, because `_` is a word character
 * and LN joins the GUID to its frame name with one (`LN_44_<GUID>`).
 */
const ID_LIKE_PATTERN =
  /(?<![0-9a-z])(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|\d{5,})(?![0-9a-z])/gi;

const ID_PLACEHOLDER = ":id";

/**
 * Query parameters naming a tenant: `tenant=` (the brief's Factory Track
 * iframe) and `inforTenantId=` (the attached LN export). The library's own
 * URL pass already covers `session`, `token`, `auth` and friends.
 */
const TENANT_PARAM_PATTERN = /tenant/i;

/** Same fragment list `@apty/debug-contract` uses for free-text key/value pairs, applied here to structured keys (`dataAttributes`, `{ name, value }` element-path attributes). */
const SENSITIVE_KEY_PATTERN =
  /token|secret|password|passwd|pwd|api[_-]?key|auth|session|csrf|xsrf|jwt|credential|signature|private[_-]?key|otp|bearer|tenant/i;

const REDACTED = "<REDACTED>";

/** Keys whose string values are the engine's own identifiers, which legitimately carry long digit runs (`dom-health-<timestamp>-1`). */
const ENGINE_ID_KEY_PATTERN =
  /^(?:auditId|id|stateId|\w+StateId|fingerprint|\w+Fingerprint)$/;

/**
 * Keys that hold the page's own element ids. In a record of element
 * attributes (`DomHealthElementAttributes`, recognised by its
 * `dataAttributes`) `id` is the element's id, not one of the engine's;
 * `sampleValues` lists duplicated ids.
 */
const ELEMENT_ATTRIBUTE_ID_KEYS = new Set(["id", "ariaLabelledby"]);
const ID_LIST_KEY = "sampleValues";

const URL_KEY_PATTERN = /^(?:url|href|src|\w+Url|\w+URL)$/;
const URL_LIST_KEY_PATTERN = /^(?:urls|\w+Urls)$/;
const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/** `value` with every identifier-shaped run (see `ID_LIKE_PATTERN`) replaced by `:id`. */
export function maskIdLike(value: string): string {
  return value.replace(ID_LIKE_PATTERN, ID_PLACEHOLDER);
}

/**
 * A URL safe to report: credentials and secret-named parameters removed by
 * `redactUrl`, tenant parameters removed, identifier-shaped path and
 * fragment segments replaced with `:id`. Not a URL template (that is the
 * job of `urlTemplate`); this only decides what may leave the device.
 */
export function redactAuditUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(redactUrl(url));
  } catch {
    return maskIdLike(redactSensitiveText(url));
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (TENANT_PARAM_PATTERN.test(key)) parsed.searchParams.set(key, REDACTED);
  }
  for (const [key, value] of [...parsed.searchParams.entries()]) {
    if (value !== REDACTED) parsed.searchParams.set(key, maskIdLike(value));
  }
  parsed.pathname = parsed.pathname
    .split("/")
    .map((segment) => maskIdLike(segment))
    .join("/");
  if (parsed.hash) {
    parsed.hash = maskIdLike(redactSensitiveText(parsed.hash.slice(1)));
  }
  return parsed.toString();
}

/** Free text read from the DOM (a title, heading or label), with secrets and identifier-shaped runs removed. Names without an identifying shape survive. */
export function redactDomText(value: string): string {
  return maskIdLike(redactSensitiveText(value));
}

function redactString(key: string | null, value: string): string {
  if (key === "pageTitle") return value ? REDACTED_TITLE : value;
  if (key && ENGINE_ID_KEY_PATTERN.test(key)) return value;
  if (key && URL_KEY_PATTERN.test(key)) return redactAuditUrl(value);
  if (ABSOLUTE_URL_PATTERN.test(value)) return redactAuditUrl(value);
  return redactDomText(value);
}

function isNameValuePair(
  value: Record<string, unknown>,
): value is { name: string; value: string } {
  return typeof value.name === "string" && typeof value.value === "string";
}

function redactValue(key: string | null, value: unknown): unknown {
  if (typeof value === "string") return redactString(key, value);
  if (Array.isArray(value)) {
    if (key === ID_LIST_KEY) {
      return value.map((item) =>
        typeof item === "string" ? maskIdReference(item) : item,
      );
    }
    const itemKey = key && URL_LIST_KEY_PATTERN.test(key) ? "url" : key;
    return value.map((item) => redactValue(itemKey, item));
  }
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const holdsElementAttributes = "dataAttributes" in record;
  const out: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(record)) {
    if (typeof child === "string" && SENSITIVE_KEY_PATTERN.test(childKey)) {
      out[childKey] = REDACTED;
    } else if (
      holdsElementAttributes &&
      typeof child === "string" &&
      ELEMENT_ATTRIBUTE_ID_KEYS.has(childKey)
    ) {
      out[childKey] = maskIdReference(redactDomText(child));
    } else {
      out[childKey] = redactValue(childKey, child);
    }
  }
  if (isNameValuePair(record)) {
    if (SENSITIVE_KEY_PATTERN.test(record.name)) {
      out.value = REDACTED;
    } else if (isIdReferenceAttribute(record.name)) {
      out.value = maskIdReference(redactDomText(record.value));
    }
  }
  return out;
}

/**
 * Deep-copies a DOM Health result (single page, application, or a tool
 * response wrapping one) with every string passed through the redaction
 * rules above. Numbers, booleans and structure are untouched, so scores and
 * counts read exactly as computed.
 */
export function redactDomHealthOutput<T>(result: T): T {
  return redactValue(null, result) as T;
}
