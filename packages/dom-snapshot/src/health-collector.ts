/**
 * Apty DOM Health collector.
 *
 * Purpose-built for the DOM Health / DOM Readiness feature — separate from
 * `collectDomSnapshot` (the accessibility-tree snapshot used for element
 * search/interaction) so that existing feature is never touched by this
 * addition. This collector produces a flat inventory: element counts,
 * attribute signals on interactive elements (for selector-quality scoring),
 * iframe/Shadow DOM/z-index characteristics.
 *
 * Deliberately mechanical: it records what it observes, it does not judge
 * whether a value "looks generated" or whether a score should be high or
 * low — that interpretation lives in `browser-runtime`'s scoring engine, so
 * this module stays a pure, cheaply-testable data collector.
 *
 * Known, honest limitations (documented rather than silently glossed over):
 * - Cross-origin iframes cannot be read — this is the browser's same-origin
 *   security boundary, not something a content script can work around, and
 *   is reported as `iframes.crossOrigin`, never conflated with a DOM defect.
 * - Closed Shadow DOM roots (`{mode: "closed"}`) are invisible to any
 *   content script by design — only open roots are counted/traversed.
 * - z-index scanning is bounded to `maxStyleChecks` elements (default 2000)
 *   to avoid forcing a full-page style recalculation on very large pages;
 *   on a page with more positioned elements than the bound, some overlay
 *   signals may be missed rather than the audit becoming slow/blocking.
 */
import type {
  DomHealthCollectorOptions,
  DomHealthElement,
  DomHealthElementAttributes,
  DomHealthSnapshot,
} from "./health-types.js";

const DEFAULT_MAX_INTERACTIVE_ELEMENTS = 500;
const DEFAULT_MAX_STYLE_CHECKS = 2000;
/** Maximum iframe nesting depth traversed — guards against pathological/adversarial nesting. */
const MAX_FRAME_DEPTH = 3;
/** A positioned element at or above this z-index is counted as "high" for overlay-risk scoring (see `apty/dom-health-scoring.ts`). */
const HIGH_Z_INDEX_THRESHOLD = 1000;

const INTERACTIVE_TAGS = new Set([
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "details",
  "video",
  "audio",
]);

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "combobox",
  "textbox",
  "searchbox",
  "slider",
  "spinbutton",
]);

interface CollectorState {
  totalElements: number;
  buttons: number;
  inputs: number;
  selects: number;
  textareas: number;
  links: number;
  forms: number;
  contentEditable: number;
  interactiveCount: number;
  interactiveElements: DomHealthElement[];
  iframeTotal: number;
  iframeAccessible: number;
  iframeCrossOrigin: number;
  shadowRoots: number;
  shadowElements: number;
  maxZIndex: number;
  highZIndexElementCount: number;
  styleChecksPerformed: number;
}

function createState(): CollectorState {
  return {
    totalElements: 0,
    buttons: 0,
    inputs: 0,
    selects: 0,
    textareas: 0,
    links: 0,
    forms: 0,
    contentEditable: 0,
    interactiveCount: 0,
    interactiveElements: [],
    iframeTotal: 0,
    iframeAccessible: 0,
    iframeCrossOrigin: 0,
    shadowRoots: 0,
    shadowElements: 0,
    maxZIndex: 0,
    highZIndexElementCount: 0,
    styleChecksPerformed: 0,
  };
}

function isContentEditable(el: Element): boolean {
  const value = el.getAttribute("contenteditable");
  return value === "" || value === "true";
}

function isInteractiveElement(el: Element, tag: string): boolean {
  if (INTERACTIVE_TAGS.has(tag)) {
    return true;
  }
  const role = el.getAttribute("role");
  if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) {
    return true;
  }
  return isContentEditable(el);
}

function extractAttributes(el: Element): DomHealthElementAttributes {
  const dataAttributes: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith("data-")) {
      dataAttributes[attr.name.slice(5)] = attr.value;
    }
  }
  const className =
    typeof el.className === "string" && el.className ? el.className : undefined;
  return {
    id: el.id || undefined,
    className,
    name: el.getAttribute("name") || undefined,
    role: el.getAttribute("role") || undefined,
    ariaLabel: el.getAttribute("aria-label") || undefined,
    ariaLabelledby: el.getAttribute("aria-labelledby") || undefined,
    dataAttributes,
  };
}

function checkZIndex(
  el: Element,
  state: CollectorState,
  maxStyleChecks: number,
): void {
  if (state.styleChecksPerformed >= maxStyleChecks) return;
  state.styleChecksPerformed++;

  const view = el.ownerDocument?.defaultView;
  if (!view) return;

  let position: string;
  let zIndexRaw: string;
  try {
    const style = view.getComputedStyle(el);
    position = style.position;
    zIndexRaw = style.zIndex;
  } catch {
    return;
  }

  // jsdom returns "" (not the spec default "static") for an unset
  // `position` — treat both as "not positioned".
  if (!position || position === "static") return;
  const z = Number.parseInt(zIndexRaw, 10);
  if (Number.isNaN(z)) return;

  if (z > state.maxZIndex) state.maxZIndex = z;
  if (z >= HIGH_Z_INDEX_THRESHOLD) state.highZIndexElementCount++;
}

/** Walks one root (a Document or an open ShadowRoot) — recurses into open shadow roots and accessible same-origin iframes. */
function collectFromRoot(
  root: ParentNode,
  state: CollectorState,
  options: Required<DomHealthCollectorOptions>,
  depth: number,
  insideShadowDom: boolean,
): void {
  const all = root.querySelectorAll("*");
  state.totalElements += all.length;
  if (insideShadowDom) state.shadowElements += all.length;

  for (const el of Array.from(all)) {
    const tag = el.tagName.toLowerCase();

    if (tag === "button") state.buttons++;
    else if (tag === "input") state.inputs++;
    else if (tag === "select") state.selects++;
    else if (tag === "textarea") state.textareas++;
    else if (tag === "a" && el.hasAttribute("href")) state.links++;
    else if (tag === "form") state.forms++;
    if (isContentEditable(el)) state.contentEditable++;

    if (isInteractiveElement(el, tag)) {
      state.interactiveCount++;
      if (state.interactiveElements.length < options.maxInteractiveElements) {
        state.interactiveElements.push({
          tagName: tag,
          attributes: extractAttributes(el),
        });
      }
    }

    checkZIndex(el, state, options.maxStyleChecks);

    const shadowRoot = (el as HTMLElement).shadowRoot;
    if (shadowRoot) {
      state.shadowRoots++;
      collectFromRoot(shadowRoot, state, options, depth, true);
    }
  }

  const iframes = root.querySelectorAll("iframe");
  for (const iframe of Array.from(iframes)) {
    state.iframeTotal++;
    if (depth >= MAX_FRAME_DEPTH) {
      // Treat as an accessibility boundary rather than silently dropping it.
      state.iframeCrossOrigin++;
      continue;
    }
    let innerDoc: Document | null = null;
    try {
      innerDoc = (iframe as HTMLIFrameElement).contentDocument;
    } catch {
      innerDoc = null;
    }
    if (innerDoc) {
      state.iframeAccessible++;
      collectFromRoot(
        innerDoc.body ?? innerDoc,
        state,
        options,
        depth + 1,
        false,
      );
    } else {
      state.iframeCrossOrigin++;
    }
  }
}

/**
 * Collect a DOM Health snapshot from the given document. Synchronous and
 * single-pass; safe to call twice in quick succession for the multi-snapshot
 * stability comparison in `apty/dom-health.ts`.
 */
export function collectDomHealthSnapshot(
  rootDocument: Document,
  options: DomHealthCollectorOptions = {},
): DomHealthSnapshot {
  const resolvedOptions: Required<DomHealthCollectorOptions> = {
    maxInteractiveElements:
      options.maxInteractiveElements ?? DEFAULT_MAX_INTERACTIVE_ELEMENTS,
    maxStyleChecks: options.maxStyleChecks ?? DEFAULT_MAX_STYLE_CHECKS,
  };

  const state = createState();
  // Start from <body>, not the whole document — querySelectorAll("*") on a
  // Document also matches <html>/<head>, which are irrelevant noise for DOM
  // Health and would otherwise consume the bounded style-check budget.
  collectFromRoot(
    rootDocument.body ?? rootDocument,
    state,
    resolvedOptions,
    0,
    false,
  );

  return {
    collectedAt: Date.now(),
    url: rootDocument.location?.href ?? "",
    title: rootDocument.title ?? "",
    counts: {
      totalElements: state.totalElements,
      interactiveElements: state.interactiveCount,
      buttons: state.buttons,
      inputs: state.inputs,
      selects: state.selects,
      textareas: state.textareas,
      links: state.links,
      forms: state.forms,
      contentEditable: state.contentEditable,
    },
    interactiveElements: state.interactiveElements,
    iframes: {
      total: state.iframeTotal,
      accessible: state.iframeAccessible,
      crossOrigin: state.iframeCrossOrigin,
    },
    shadowDom: {
      roots: state.shadowRoots,
      elements: state.shadowElements,
    },
    zIndex: {
      maxZIndex: state.maxZIndex,
      highZIndexElementCount: state.highZIndexElementCount,
    },
  };
}
