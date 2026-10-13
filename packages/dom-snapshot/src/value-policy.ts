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

export function applyUrlPolicy(
  url: string | undefined,
  policy: ValuePolicy,
): string | undefined {
  if (policy === "show" || !url) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const base = `${parsed.origin}${parsed.pathname}`;
  if (policy === "withhold" || !parsed.search) return base;
  const keys = parsed.search
    .slice(1)
    .split("&")
    .filter(Boolean)
    .map((pair) => `${pair.split("=")[0]}=${MASKED_VALUE}`);
  return `${base}?${keys.join("&")}`;
}

export interface PolicyNode {
  role: string;
  name?: string;
  value?: string;
  /** Set by the collector when `name` is the selected option or the field's own text. */
  nameIsValue?: boolean;
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
  if (isEditableRole(node.role)) {
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
