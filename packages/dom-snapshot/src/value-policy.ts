/**
 * What a snapshot may say about the values a person typed or chose.
 *
 * - "show": as the page has them.
 * - "mask": a non-empty value becomes MASKED_VALUE, so a filled field can be
 *   told from an empty one without its content (or its length) being known.
 * - "withhold": no value at all.
 *
 * Pure functions on plain data; the default everywhere is "show", so nothing
 * changes until a caller opts in.
 */

export type ValuePolicy = "show" | "mask" | "withhold";

export const MASKED_VALUE = "[masked]";

/** Identifier-shaped runs inside a value: 5+ digits, a GUID, 16+ hex. */
export const ID_RUN =
  /(?<![0-9a-z])(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|\d{5,})(?![0-9a-z])/gi;

/** Characters an email in a path cannot contain. */
const PATH_EMAIL_BOUNDARY = /[/@\s]/;
const ASCII_LETTER = /[a-z]/i;

function emailPartEnd(path: string, from: number): number {
  let end = from;
  while (end < path.length && !PATH_EMAIL_BOUNDARY.test(path[end]!)) end++;
  return end;
}

/** Where an email starting at `start` ends: `local@domain`, the domain's last `.` followed by two or more letters; -1 for none. */
function pathEmailEnd(path: string, start: number): number {
  const at = emailPartEnd(path, start);
  if (at === start || path[at] !== "@") return -1;
  const domainEnd = emailPartEnd(path, at + 1);
  for (let dot = domainEnd - 1; dot > at + 1; dot--) {
    if (path[dot] !== ".") continue;
    let end = dot + 1;
    while (end < domainEnd && ASCII_LETTER.test(path[end]!)) end++;
    if (end - dot > 2) return end;
  }
  return -1;
}

/**
 * `path` with every email replaced, as a global replace of
 * `/[^/@\s]+@[^/@\s]+\.[a-z]{2,}/gi` would, in linear time. That replace
 * retries from every character, quadratic on a long run without an `@`. A
 * leftmost match can only start where the previous one ended or right after
 * a `/`, `@` or space (one starting inside a run could start a character
 * earlier), so only those positions are tried.
 */
function replacePathEmails(path: string): string {
  let out = "";
  let copied = 0;
  let start = 0;
  while (start < path.length) {
    const end = pathEmailEnd(path, start);
    if (end === -1) {
      start = emailPartEnd(path, start) + 1;
      continue;
    }
    out += `${path.slice(copied, start)}:email`;
    start = copied = end;
  }
  return out + path.slice(copied);
}

/** A URL path with record numbers, GUIDs, long hex ids and emails replaced. */
function withholdPathIdentifiers(path: string): string {
  return replacePathEmails(path).replace(ID_RUN, ":id");
}

/** Roles whose value, and whose text children, are what a person entered. */
const EDITABLE_ROLES = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "spinbutton",
]);

export function isEditableRole(role: string): boolean {
  return EDITABLE_ROLES.has(role);
}

export function applyValuePolicy(
  value: string | undefined,
  policy: ValuePolicy,
): string | undefined {
  if (policy === "show") return value;
  if (policy === "withhold") return undefined;
  return value ? MASKED_VALUE : value;
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * `scheme://host`, or `scheme:` for a URL with no authority (`about:`,
 * `mailto:`). Never `"null"`, which `URL#origin` gives for `file:`,
 * `chrome:` and `chrome-extension:` URLs.
 */
export function urlOrigin(url: string, parsed: URL): string {
  if (parsed.origin !== "null") return parsed.origin;
  return url.slice(parsed.protocol.length).startsWith("//")
    ? `${parsed.protocol}//${parsed.host}`
    : parsed.protocol;
}

function maskedQuery(search: string): string {
  return search
    .split("&")
    .filter(Boolean)
    .map((pair) => `${pair.split("=")[0]}=${MASKED_VALUE}`)
    .join("&");
}

/** A relative URL masked as text, so a path is never re-encoded or normalized. */
function applyRelativeUrlPolicy(url: string, policy: ValuePolicy): string {
  const end = url.search(/[?#]/);
  const path = end === -1 ? url : url.slice(0, end);
  if (policy === "withhold") return withholdPathIdentifiers(path);
  const query =
    end !== -1 && url[end] === "?"
      ? (url.slice(end + 1).split("#")[0] ?? "")
      : "";
  return query ? `${path}?${maskedQuery(query)}` : path;
}

/**
 * A URL as the policy lets it be described: Strict keeps the origin and the
 * path with record numbers, GUIDs and emails replaced; Standard keeps the
 * path and masks every query value. A relative or protocol-relative URL is
 * masked the same way; anything that can't be parsed comes back empty,
 * never as its raw text.
 */
export function applyUrlPolicy(
  url: string | undefined,
  policy: ValuePolicy,
): string | undefined {
  if (policy === "show" || !url) return url;
  if (url.startsWith("//")) {
    const shown = applyUrlPolicy(`https:${url}`, policy);
    return shown ? shown.slice("https:".length) : "";
  }
  if (!HAS_SCHEME.test(url)) return applyRelativeUrlPolicy(url, policy);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const origin = urlOrigin(url, parsed);
  if (policy === "withhold") {
    return `${origin}${withholdPathIdentifiers(parsed.pathname)}`;
  }
  const base = `${origin}${parsed.pathname}`;
  return parsed.search
    ? `${base}?${maskedQuery(parsed.search.slice(1))}`
    : base;
}

const WITHHELD_TITLE = "[title withheld]";

export interface PolicyNode {
  role: string;
  name?: string;
  value?: string;
  /** Set by the collector when `name` is the selected option or the field's own text. */
  nameIsValue?: boolean;
  /** A region the user can type into whatever its role (contenteditable). */
  editable?: boolean;
  selected?: boolean;
  children: PolicyNode[];
}

/** The option a person chose in a select or listbox: its name is the value. */
function isChosenOption(node: PolicyNode): boolean {
  return node.role === "option" && node.selected === true;
}

/**
 * The node as the policy lets it be described: for an editable node, the
 * value is masked or dropped, a name that came from the value is dropped, and
 * text children (which for an editor are its content) are removed. The
 * option a person chose is hidden (masked, or removed when withholding) among
 * the children of whatever node holds it. Any other node is returned
 * untouched.
 */
export function prepareNodeForPolicy<T extends PolicyNode>(
  node: T,
  policy: ValuePolicy,
): T {
  if (policy === "show") return node;
  // The document's name is its title, which can name the patient.
  if (
    policy === "withhold" &&
    (node.role === "RootWebArea" || node.role === "WebArea") &&
    node.name
  ) {
    return { ...node, name: WITHHELD_TITLE };
  }
  if (isEditableRole(node.role) || node.editable) {
    return {
      ...node,
      value: applyValuePolicy(node.value, policy),
      name: node.nameIsValue ? "" : node.name,
      children: withoutChosenOptionNames(
        node.children.filter((child) => child.role !== "StaticText"),
        policy,
      ),
    };
  }
  if (node.children.some(isChosenOption)) {
    return {
      ...node,
      children: withoutChosenOptionNames(node.children, policy),
    };
  }
  return node;
}

function withoutChosenOptionNames(
  children: PolicyNode[],
  policy: ValuePolicy,
): PolicyNode[] {
  if (policy === "withhold") {
    return children.filter((child) => !isChosenOption(child));
  }
  return children.map((child) =>
    isChosenOption(child) ? { ...child, name: MASKED_VALUE } : child,
  );
}
