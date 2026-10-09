/**
 * What DOM Health keeps from a customer's DOM at capture time (DOM Health
 * brief, section 4.12; defect D-9). The service worker redacts every
 * result again on exit (`@apty/browser-runtime`'s
 * `dom-health-redaction.ts`); this is the first line, in the page, so that
 * values never leave the frame in the first place:
 *
 * - `data-*` values that look like a token, an identifier or free text
 *   are replaced. The athenaOne exports carry a Datadog client token
 *   (`pub` + 32 hex) and GUID application ids in the page.
 * - Attribute values inside a selector are passed through the same rules,
 *   and a URL value (`href`, `src`) loses its secret-named and token-like
 *   query parameters.
 * - Inside a container the page marks as private, every value and every
 *   piece of text is replaced.
 *
 * Input `value` is never read: the audit profile ignores the `value`
 * attribute (`health-audit-profile.ts`) and nothing here reads the
 * property. Script and style bodies are never read either: captured text
 * goes through `composedText`, which skips them.
 */

import { closestComposed, composedText } from "./composed-tree.js";
import type { DomHealthElementAttributes } from "./health-types.js";

export const REDACTED_VALUE = "<redacted>";
export const REDACTED_TEXT = "<redacted-text>";

/**
 * Names whose values are secrets or personal data. The secret names match
 * the exit redaction's key list; the personal-data names (`patient`, `mrn`,
 * `dob`, `ssn`, `email`, `phone`) are general knowledge of healthcare and
 * CRM markup, not observed in the exports.
 */
const SENSITIVE_NAME =
  /token|secret|password|passwd|pwd|api[_-]?key|auth|session|csrf|xsrf|jwt|credential|signature|otp|bearer|tenant|patient|mrn|dob|birth|ssn|email|phone/i;

/** A Datadog browser client token, as in the athenaOne exports (`pub` + 32 hex). */
const DATADOG_CLIENT_TOKEN = /^pub[0-9a-f]{32}$/i;
const JWT = /^eyJ[\w-]+\.[\w-]+\./;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX = /^[0-9a-f]{16,}$/i;
/** 24+ characters of the base64 alphabet mixing upper case, lower case and digits: an opaque key. Underscores and hyphens are left out so a stable framework id (`ctl00_Main_txtName`) is not mistaken for one. */
const OPAQUE_KEY = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])[A-Za-z0-9+/=]{24,}$/;
/** Identifier-shaped runs inside a value: 5+ digits, a GUID, 16+ hex. */
const ID_RUN =
  /(?<![0-9a-z])(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|\d{5,})(?![0-9a-z])/gi;

/**
 * Data attributes hold identifiers and short keywords; text with several
 * words or over 40 characters is content (a name, a note, a search) and
 * says nothing about selector health. Unverified cut-off.
 */
function looksLikeFreeText(value: string): boolean {
  const words = value.trim().split(/\s+/);
  return words.length >= 4 || (words.length > 1 && value.length > 40);
}

function looksLikeSecret(value: string): boolean {
  const v = value.trim();
  return (
    DATADOG_CLIENT_TOKEN.test(v) ||
    JWT.test(v) ||
    GUID.test(v) ||
    LONG_HEX.test(v) ||
    OPAQUE_KEY.test(v)
  );
}

/**
 * Elements whose content the page itself marks as private. These are the
 * session-replay masking markers of Datadog, FullStory, Hotjar and Sentry
 * plus explicit `data-pii`-style attributes: an application that masks an
 * element from its own session replay holds personal data there. General
 * knowledge, unverified against the two applications (neither export
 * contains one).
 */
export const PRIVATE_CONTAINER_SELECTOR = [
  '[data-dd-privacy="mask"]',
  '[data-dd-privacy="hidden"]',
  ".dd-privacy-mask",
  ".dd-privacy-hidden",
  ".fs-mask",
  ".fs-exclude",
  "[data-hj-suppress]",
  ".sentry-mask",
  "[data-sentry-mask]",
  "[data-pii]",
  "[data-phi]",
  "[data-private]",
  "[data-sensitive]",
].join(", ");

export function isInPrivateContainer(element: Element): boolean {
  return closestComposed(element, PRIVATE_CONTAINER_SELECTOR) !== null;
}

function sanitizeUrl(url: string): string {
  const [beforeHash, hash] = url.split("#", 2) as [string, string | undefined];
  const [path, query] = beforeHash.split("?", 2) as [
    string,
    string | undefined,
  ];
  const cleanPath = path.replace(ID_RUN, ":id");
  if (!query) return hash === undefined ? cleanPath : `${cleanPath}#${hash}`;
  const params = query
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const [name, value = ""] = pair.split("=", 2) as [string, string?];
      if (SENSITIVE_NAME.test(name) || looksLikeSecret(decode(value))) {
        return `${name}=${REDACTED_VALUE}`;
      }
      return `${name}=${value.replace(ID_RUN, ":id")}`;
    });
  return `${cleanPath}?${params.join("&")}${hash === undefined ? "" : `#${hash}`}`;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * True for an attribute that must not go into a stored element path: a
 * secret-named attribute, a token-shaped value, or a URL carrying a
 * secret parameter. Such a value also changes per session, so it is no
 * loss as a selector.
 */
export function isPrivateAttribute(name: string, value: string): boolean {
  if (SENSITIVE_NAME.test(name) || looksLikeSecret(value)) return true;
  return (
    (name === "href" || name === "src" || name === "action") &&
    sanitizeUrl(value).includes(REDACTED_VALUE)
  );
}

/** One attribute value as DOM Health may report it. */
export function sanitizeAttributeValue(name: string, value: string): string {
  if (SENSITIVE_NAME.test(name) || looksLikeSecret(value)) {
    return REDACTED_VALUE;
  }
  if (name === "href" || name === "src" || name === "action") {
    return sanitizeUrl(value);
  }
  if (name.startsWith("data-") && looksLikeFreeText(value)) {
    return REDACTED_TEXT;
  }
  return value.replace(ID_RUN, ":id");
}

/** The element's captured attributes with every value passed through `sanitizeAttributeValue`, or replaced outright inside a private container. */
export function sanitizeReportAttributes(
  attributes: DomHealthElementAttributes,
  element: Element,
): DomHealthElementAttributes {
  const isPrivate = isInPrivateContainer(element);
  const clean = (name: string, value: string | undefined) =>
    value === undefined
      ? undefined
      : isPrivate
        ? REDACTED_VALUE
        : sanitizeAttributeValue(name, value);
  const dataAttributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes.dataAttributes)) {
    dataAttributes[key] = clean(`data-${key}`, value)!;
  }
  return {
    id: attributes.id === undefined ? undefined : clean("id", attributes.id),
    className: attributes.className,
    name: clean("name", attributes.name),
    role: attributes.role,
    ariaLabel: clean("aria-label", attributes.ariaLabel),
    ariaLabelledby: attributes.ariaLabelledby,
    dataAttributes,
  };
}

const SELECTOR_ATTRIBUTE_VALUE = /\[([\w:-]+)([~|^$*]?=)"((?:[^"\\]|\\.)*)"\]/g;

/** `selector` with each `[name="value"]` value sanitized (or redacted, inside a private container). Structure, tags and positions are kept. */
export function sanitizeSelector(
  selector: string | null,
  element: Element,
): string | null {
  if (selector === null) return null;
  const isPrivate = isInPrivateContainer(element);
  return selector.replace(
    SELECTOR_ATTRIBUTE_VALUE,
    (_match, name: string, operator: string, value: string) =>
      `[${name}${operator}"${isPrivate ? REDACTED_VALUE : sanitizeAttributeValue(name, value)}"]`,
  );
}

/** Text DOM Health reports for an element (a control's label): composed and script-free, or redacted inside a private container. */
export function capturedText(element: Element, maxLength = 120): string {
  const text = composedText(element, maxLength);
  return text && isInPrivateContainer(element) ? REDACTED_TEXT : text;
}
