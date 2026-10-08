/**
 * Composed-tree reads: what the user sees, across shadow boundaries.
 *
 * `querySelectorAll` stops at every shadow root, and `textContent` reads a
 * host's light DOM without the shadow tree that renders it. The real
 * exports in section 2 of the DOM Health brief make that the normal case,
 * not an edge case:
 *
 * - Infor OS Portal: 251 open shadow roots nested up to 3 deep and 358
 *   `<slot>` elements in one top document. Its only `<h1>` sits inside an
 *   `ids-text type="h1"` shadow root and its text ("Infor OS Portal") is
 *   slotted in from the host's light DOM; `ids-button` renders a `<button>`
 *   inside its shadow root while the label (`<span class="audible">`) stays
 *   in the light DOM.
 * - athenaOne: a whole Nimbus micro-frontend (the Patient Registration
 *   form) lives in one open shadow root of a `div` in the top document.
 *
 * Every helper here takes the same walk: an element's own subtree, then its
 * shadow root (open, or closed through `shadowRootOf`), recursively.
 */
import { shadowRootOf } from "./shadow-roots.js";

export type QueryRoot = Document | ShadowRoot | Element;

/** Elements never read for text: their content is code, styling or inert markup, not something the user sees. */
const NON_RENDERED_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);

export interface DeepWalkOptions {
  /** A host for which this returns true is not entered (its own element is still visited). */
  skipShadowOf?: (host: Element) => boolean;
  /** Stop after visiting this many elements; `truncated` in the result says so. */
  maxElements?: number;
}

export interface DeepWalkResult {
  elementsVisited: number;
  shadowRootsEntered: number;
  truncated: boolean;
}

/**
 * Visit every element under `root` in composed pre-order: each element,
 * then (if it hosts one) everything in its shadow root, then its next
 * light-DOM descendant. `visit` returning `false` stops the walk.
 */
export function walkComposedTree(
  root: QueryRoot,
  visit: (element: Element, owner: Document | ShadowRoot) => unknown,
  options: DeepWalkOptions = {},
): DeepWalkResult {
  const result: DeepWalkResult = {
    elementsVisited: 0,
    shadowRootsEntered: 0,
    truncated: false,
  };
  const max = options.maxElements ?? Number.POSITIVE_INFINITY;
  let stopped = false;

  const walkRoot = (scope: QueryRoot, owner: Document | ShadowRoot) => {
    const elements =
      scope instanceof Element
        ? [scope, ...Array.from(scope.querySelectorAll("*"))]
        : Array.from(scope.querySelectorAll("*"));
    for (const element of elements) {
      if (stopped) return;
      if (result.elementsVisited >= max) {
        result.truncated = true;
        stopped = true;
        return;
      }
      result.elementsVisited++;
      if (visit(element, owner) === false) {
        stopped = true;
        return;
      }
      if (options.skipShadowOf?.(element)) continue;
      const shadow = shadowRootOf(element);
      if (shadow) {
        result.shadowRootsEntered++;
        walkRoot(shadow, shadow);
      }
    }
  };

  const owner =
    root instanceof Element
      ? (root.getRootNode() as Document | ShadowRoot)
      : root;
  walkRoot(root, owner);
  return result;
}

/** `querySelectorAll` across every shadow root under `root`, in composed pre-order, up to `limit` matches. */
export function querySelectorAllDeep(
  root: QueryRoot,
  selector: string,
  limit = Number.POSITIVE_INFINITY,
  options: Omit<DeepWalkOptions, "maxElements"> = {},
): Element[] {
  const found: Element[] = [];
  walkComposedTree(
    root,
    (element) => {
      if (element.matches(selector)) found.push(element);
      return found.length < limit;
    },
    options,
  );
  return found;
}

/** First match of `selector` anywhere in the composed tree under `root`, or null. */
export function querySelectorDeep(
  root: QueryRoot,
  selector: string,
  options: Omit<DeepWalkOptions, "maxElements"> = {},
): Element | null {
  return querySelectorAllDeep(root, selector, 1, options)[0] ?? null;
}

interface TextBuffer {
  parts: string[];
  length: number;
  budget: number;
}

function collectComposedText(node: Node, buffer: TextBuffer) {
  if (buffer.length >= buffer.budget) return;
  if (node.nodeType === Node.TEXT_NODE) {
    const data = (node as Text).data;
    buffer.parts.push(data);
    buffer.length += data.length;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as Element;
  if (NON_RENDERED_TAGS.has(element.tagName)) return;
  if (element.hasAttribute("hidden")) return;

  if (
    element.tagName === "SLOT" &&
    element.getRootNode() instanceof ShadowRoot
  ) {
    const assigned = (element as HTMLSlotElement).assignedNodes({
      flatten: true,
    });
    const projected =
      assigned.length > 0 ? assigned : Array.from(element.childNodes);
    for (const child of projected) collectComposedText(child, buffer);
    return;
  }

  const shadow = shadowRootOf(element);
  const children = shadow ? shadow.childNodes : element.childNodes;
  for (const child of Array.from(children)) collectComposedText(child, buffer);
}

/**
 * The text a user sees for `node`: shadow trees rendered in place of their
 * host's light DOM, `<slot>`s replaced by what is assigned to them
 * (`assignedNodes({ flatten: true })`, or the slot's fallback content), and
 * script/style bodies and `hidden` subtrees skipped (LN keeps each tab's
 * closed context menu inside the tab: "LN", not "LN Unpin"). Whitespace-collapsed and cut at `maxLength`.
 */
export function composedText(node: Node, maxLength = 200): string {
  const buffer: TextBuffer = { parts: [], length: 0, budget: maxLength * 4 };
  collectComposedText(node, buffer);
  return buffer.parts.join(" ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/**
 * The element's parent in the composed (flat) tree: the slot it is
 * assigned to, else its light-DOM parent, else the host of the shadow root
 * it sits in. Infor's theme menu reaches its `nav` container only through
 * slot assignment (`ids-menu-group` is slotted into `nav.ids-menu`).
 */
export function composedParentElement(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const parent = element.parentNode;
  return parent instanceof ShadowRoot ? parent.host : null;
}

/** `Element.closest` across shadow boundaries and slot assignment, starting at `element` itself. */
export function closestComposed(
  element: Element,
  selector: string,
): Element | null {
  for (
    let current: Element | null = element;
    current;
    current = composedParentElement(current)
  ) {
    if (current.matches(selector)) return current;
  }
  return null;
}

/**
 * Whether `element` is rendered, judged over its composed ancestors as
 * well as itself: an element inside a shadow root of a `hidden` host is not
 * rendered even though its own computed style says nothing. Uses the
 * browser's `checkVisibility` when present (it already walks the flat tree);
 * jsdom has no layout, so the fallback walks `display` / `visibility`.
 */
export function isRenderedInComposedTree(element: Element): boolean {
  const withCheck = element as Element & {
    checkVisibility?: (options: {
      visibilityProperty: boolean;
      checkVisibilityCSS: boolean;
    }) => boolean;
  };
  if (typeof withCheck.checkVisibility === "function") {
    return withCheck.checkVisibility({
      visibilityProperty: true,
      checkVisibilityCSS: true,
    });
  }
  const view = element.ownerDocument?.defaultView;
  if (!view) return true;
  for (
    let current: Element | null = element;
    current;
    current = composedParentElement(current)
  ) {
    if (current.tagName === "SLOT") continue;
    const style = view.getComputedStyle(current);
    if (style.display === "none") return false;
    if (current === element && style.visibility === "hidden") return false;
  }
  return true;
}
