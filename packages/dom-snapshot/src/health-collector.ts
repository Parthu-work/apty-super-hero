/**
 * Apty DOM Health collector.
 *
 * Runs entirely in-page (content-script context), because the evidence the
 * DOM Health feature needs — real selector uniqueness, target identity,
 * cross-snapshot stability, and hit-testing — can only be produced against
 * a live DOM. This collector is where "measure" and "verify" happen (see
 * `health-selector-engine.ts` and `health-hit-test.ts`); the scoring engine
 * in `@aipexstudio/browser-runtime` only aggregates and weights numbers
 * that already exist on the snapshot it's given.
 *
 * Cross-snapshot stability (spec section 23) is tracked with a real,
 * identity-based comparison rather than pairing elements by array index:
 * this module keeps a short-lived, in-memory registry (`Element -> the
 * selector last chosen for it`) across the 2-3 calls that make up one
 * audit run (see `DomHealthCollectorOptions.freshAudit`). On each
 * subsequent call, a previously-seen element's stored selector is
 * re-queried against the live DOM right now — if it no longer resolves,
 * or resolves to a different element, that is real, verified instability,
 * not a guess from reordered array positions.
 *
 * Known, honest limitations (documented rather than silently glossed over):
 * - Cross-origin iframes cannot be read — this is the browser's same-origin
 *   security boundary, not something a content script can work around, and
 *   is reported as `iframes.crossOrigin`, never conflated with a DOM defect.
 * - Closed Shadow DOM roots (`{mode: "closed"}`) are invisible to any
 *   content script by design — only open roots are counted/traversed.
 * - Style-based checks (hidden/overlay classification, z-index) are bounded
 *   to `maxStyleChecks` elements (default 2000) to avoid forcing a full-page
 *   style recalculation on very large pages; elements beyond that bound are
 *   assumed visible/non-overlay rather than the audit becoming slow/blocking.
 * - The selector-resolution + hit-test pipeline (the expensive part) only
 *   runs on the bounded `maxInteractiveElements` sample (default 300); true
 *   element-universe counts are exact, but per-element evidence is a sample
 *   on very large pages — this is reported, never hidden.
 */
import { hitTestElement } from "./health-hit-test.js";
import {
  extractElementAttributes,
  hasAccessibleName,
  resolveElement,
  testSelector,
} from "./health-selector-engine.js";
import type {
  DomHealthCollectorOptions,
  DomHealthSnapshot,
  ElementClassification,
  ElementSelectorReport,
  StabilityVerdict,
} from "./health-types.js";

const DEFAULT_MAX_INTERACTIVE_ELEMENTS = 300;
const DEFAULT_MAX_STYLE_CHECKS = 2000;
/** Maximum iframe nesting depth traversed — guards against pathological/adversarial nesting. */
const MAX_FRAME_DEPTH = 3;
/** A positioned element at or above this z-index is counted as "high" for overlay-risk scoring. */
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

const SEMANTIC_CONTAINER_TAGS = new Set([
  "header",
  "nav",
  "main",
  "footer",
  "section",
  "article",
  "aside",
  "form",
  "dialog",
  "table",
  "ul",
  "ol",
]);

const SEMANTIC_CONTAINER_ROLES = new Set([
  "region",
  "dialog",
  "navigation",
  "banner",
  "contentinfo",
  "main",
  "list",
  "table",
]);

interface RegistryEntry {
  selector: string;
  root: ParentNode;
  id?: string;
  className?: string;
}

/**
 * Module-scoped, short-lived: holds the previous snapshot's chosen selector
 * per element for exactly as long as one audit run's 2-3 calls take. Reset
 * whenever a new audit starts (`freshAudit !== false`). Never sent across
 * the extension message boundary — only plain data on `DomHealthSnapshot`
 * is serialized.
 */
let auditRegistry = new Map<Element, RegistryEntry>();

interface StyleSignals {
  hidden: boolean;
  position: string;
  zIndex: number;
}

function readStyleSignals(el: Element): StyleSignals | null {
  const view = el.ownerDocument?.defaultView;
  if (!view) return null;
  try {
    const style = view.getComputedStyle(el);
    const opacity = Number.parseFloat(style.opacity);
    const hidden =
      style.display === "none" ||
      style.visibility === "hidden" ||
      (!Number.isNaN(opacity) && opacity === 0);
    const zIndexRaw = Number.parseInt(style.zIndex, 10);
    return {
      hidden,
      position: style.position || "",
      zIndex: Number.isNaN(zIndexRaw) ? 0 : zIndexRaw,
    };
  } catch {
    return null;
  }
}

function isContentEditable(el: Element): boolean {
  const value = el.getAttribute("contenteditable");
  return value === "" || value === "true";
}

function isInteractiveElement(el: Element, tag: string): boolean {
  if (INTERACTIVE_TAGS.has(tag)) return true;
  const role = el.getAttribute("role");
  if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;
  if (isContentEditable(el)) return true;
  const tabindex = el.getAttribute("tabindex");
  if (tabindex !== null && Number.parseInt(tabindex, 10) >= 0) return true;
  return tag === "a" && el.hasAttribute("href");
}

function classifyElement(
  el: Element,
  tag: string,
  style: StyleSignals | null,
  insideShadowDom: boolean,
  isInteractive: boolean,
): ElementClassification {
  if (tag === "iframe") return "iframe";
  if ((el as HTMLElement).shadowRoot) return "shadow-host";
  if (style?.hidden) return "hidden";
  if (isInteractive) return "interactive";
  if (
    style &&
    (style.position === "fixed" || style.position === "absolute") &&
    style.zIndex >= HIGH_Z_INDEX_THRESHOLD
  ) {
    return "overlay";
  }
  if (
    SEMANTIC_CONTAINER_TAGS.has(tag) ||
    SEMANTIC_CONTAINER_ROLES.has((el.getAttribute("role") ?? "").toLowerCase())
  ) {
    return "semantic-container";
  }
  if (insideShadowDom) return "shadow-descendant";
  if (el.children.length > 0) return "structural";
  return "decorative";
}

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
  elementReports: ElementSelectorReport[];
  universe: {
    meaningful: number;
    hidden: number;
    inaccessible: number;
    iframeElements: number;
    shadowDomElements: number;
  };
  iframeTotal: number;
  iframeAccessible: number;
  iframeCrossOrigin: number;
  shadowRoots: number;
  shadowElements: number;
  maxZIndex: number;
  highZIndexElementCount: number;
  styleChecksPerformed: number;
  selectorAnalysis: {
    directSuccess: number;
    recoveredByIgnore: number;
    recoveredByPartial: number;
    recoveredByContext: number;
    positionalOnly: number;
    ambiguous: number;
    wrongTarget: number;
    notResolved: number;
    inaccessible: number;
  };
  dynamicAttrs: {
    idsObserved: number;
    idsDynamicByHeuristic: number;
    idsChangedAcrossSnapshots: number;
    classesObserved: number;
    classesDynamicByHeuristic: number;
    classesChangedAcrossSnapshots: number;
  };
  stability: {
    trackedFromPrevious: number;
    stable: number;
    unstable: number;
    detached: number;
    unknown: number;
  };
  hitTesting: {
    tested: number;
    fullyTargetable: number;
    partiallyTargetable: number;
    mostlyOccluded: number;
    fullyOccluded: number;
    zeroSize: number;
    outsideViewport: number;
    hidden: number;
  };
  ancestorTraversal: {
    contextualRecoveryCount: number;
    deepTraversalCount: number;
    maxAncestorDepthObserved: number;
  };
  positional: {
    positionalCount: number;
    stableAcrossSnapshots: number;
    unstableAcrossSnapshots: number;
  };
  accessibility: {
    totalInteractive: number;
    missingAccessibleName: number;
  };
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
    elementReports: [],
    universe: {
      meaningful: 0,
      hidden: 0,
      inaccessible: 0,
      iframeElements: 0,
      shadowDomElements: 0,
    },
    iframeTotal: 0,
    iframeAccessible: 0,
    iframeCrossOrigin: 0,
    shadowRoots: 0,
    shadowElements: 0,
    maxZIndex: 0,
    highZIndexElementCount: 0,
    styleChecksPerformed: 0,
    selectorAnalysis: {
      directSuccess: 0,
      recoveredByIgnore: 0,
      recoveredByPartial: 0,
      recoveredByContext: 0,
      positionalOnly: 0,
      ambiguous: 0,
      wrongTarget: 0,
      notResolved: 0,
      inaccessible: 0,
    },
    dynamicAttrs: {
      idsObserved: 0,
      idsDynamicByHeuristic: 0,
      idsChangedAcrossSnapshots: 0,
      classesObserved: 0,
      classesDynamicByHeuristic: 0,
      classesChangedAcrossSnapshots: 0,
    },
    stability: {
      trackedFromPrevious: 0,
      stable: 0,
      unstable: 0,
      detached: 0,
      unknown: 0,
    },
    hitTesting: {
      tested: 0,
      fullyTargetable: 0,
      partiallyTargetable: 0,
      mostlyOccluded: 0,
      fullyOccluded: 0,
      zeroSize: 0,
      outsideViewport: 0,
      hidden: 0,
    },
    ancestorTraversal: {
      contextualRecoveryCount: 0,
      deepTraversalCount: 0,
      maxAncestorDepthObserved: 0,
    },
    positional: {
      positionalCount: 0,
      stableAcrossSnapshots: 0,
      unstableAcrossSnapshots: 0,
    },
    accessibility: { totalInteractive: 0, missingAccessibleName: 0 },
  };
}

function recordSelectorOutcome(
  state: CollectorState,
  outcome: ElementSelectorReport["outcome"],
): void {
  switch (outcome) {
    case "DIRECT_SUCCESS":
      state.selectorAnalysis.directSuccess++;
      break;
    case "RECOVERED_BY_IGNORE":
      state.selectorAnalysis.recoveredByIgnore++;
      break;
    case "RECOVERED_BY_PARTIAL":
      state.selectorAnalysis.recoveredByPartial++;
      break;
    case "RECOVERED_BY_CONTEXT":
      state.selectorAnalysis.recoveredByContext++;
      break;
    case "POSITIONAL_ONLY":
      state.selectorAnalysis.positionalOnly++;
      break;
    case "AMBIGUOUS":
      state.selectorAnalysis.ambiguous++;
      break;
    case "WRONG_TARGET":
      state.selectorAnalysis.wrongTarget++;
      break;
    case "NOT_RESOLVED":
      state.selectorAnalysis.notResolved++;
      break;
    case "INACCESSIBLE":
      state.selectorAnalysis.inaccessible++;
      break;
  }
}

function determineStability(
  el: Element,
  previous: RegistryEntry | undefined,
  root: ParentNode,
): StabilityVerdict {
  if (!previous) return "UNKNOWN";
  if (!el.isConnected) return "DETACHED";
  const result = testSelector(previous.root ?? root, previous.selector, el);
  return result.matchCount === 1 && result.matchesTarget
    ? "STABLE"
    : "UNSTABLE";
}

function analyzeInteractiveElement(
  el: Element,
  root: ParentNode,
  state: CollectorState,
  previousRegistry: Map<Element, RegistryEntry>,
  currentRegistry: Map<Element, RegistryEntry>,
): void {
  const attributes = extractElementAttributes(el);
  const resolution = resolveElement(root, el);
  const hitTest = hitTestElement(el);
  const accessibleName = hasAccessibleName(el);

  const previous = previousRegistry.get(el);
  const stability = determineStability(el, previous, root);

  if (previous) {
    state.stability.trackedFromPrevious++;
    if (stability === "STABLE") state.stability.stable++;
    else if (stability === "UNSTABLE") state.stability.unstable++;
    else if (stability === "DETACHED") state.stability.detached++;

    if (
      previous.id !== undefined &&
      attributes.id !== undefined &&
      previous.id !== attributes.id
    ) {
      state.dynamicAttrs.idsChangedAcrossSnapshots++;
    }
    if (
      previous.className !== undefined &&
      attributes.className !== undefined &&
      previous.className !== attributes.className
    ) {
      state.dynamicAttrs.classesChangedAcrossSnapshots++;
    }

    if (resolution.usesPositionalSelector) {
      if (stability === "STABLE") state.positional.stableAcrossSnapshots++;
      else if (stability === "UNSTABLE")
        state.positional.unstableAcrossSnapshots++;
    }
  } else {
    state.stability.unknown++;
  }

  currentRegistry.set(el, {
    selector: resolution.bestSelector ?? "",
    root,
    id: attributes.id,
    className: attributes.className,
  });

  if (attributes.id) {
    state.dynamicAttrs.idsObserved++;
    if (resolution.dynamicAttributeNames.includes("id")) {
      state.dynamicAttrs.idsDynamicByHeuristic++;
    }
  }
  if (attributes.className) {
    state.dynamicAttrs.classesObserved++;
    if (resolution.dynamicAttributeNames.includes("class")) {
      state.dynamicAttrs.classesDynamicByHeuristic++;
    }
  }

  recordSelectorOutcome(state, resolution.outcome);
  if (resolution.usesPositionalSelector) state.positional.positionalCount++;
  if (resolution.strategy === "context") {
    state.ancestorTraversal.contextualRecoveryCount++;
    if (resolution.ancestorDepthUsed >= 2) {
      state.ancestorTraversal.deepTraversalCount++;
    }
  }
  state.ancestorTraversal.maxAncestorDepthObserved = Math.max(
    state.ancestorTraversal.maxAncestorDepthObserved,
    resolution.ancestorDepthUsed,
  );

  if (hitTest) {
    state.hitTesting.tested++;
    switch (hitTest.classification) {
      case "fully-targetable":
        state.hitTesting.fullyTargetable++;
        break;
      case "partially-targetable":
        state.hitTesting.partiallyTargetable++;
        break;
      case "mostly-occluded":
        state.hitTesting.mostlyOccluded++;
        break;
      case "fully-occluded":
        state.hitTesting.fullyOccluded++;
        break;
      case "zero-size":
        state.hitTesting.zeroSize++;
        break;
      case "outside-viewport":
        state.hitTesting.outsideViewport++;
        break;
      case "hidden":
        state.hitTesting.hidden++;
        break;
    }
  }

  state.accessibility.totalInteractive++;
  if (!accessibleName) state.accessibility.missingAccessibleName++;

  state.elementReports.push({
    tagName: el.tagName.toLowerCase(),
    classification: "interactive",
    attributes,
    outcome: resolution.outcome,
    strategy: resolution.strategy,
    bestSelector: resolution.bestSelector,
    matchCount: resolution.matchCount,
    ancestorDepthUsed: resolution.ancestorDepthUsed,
    usesPositionalSelector: resolution.usesPositionalSelector,
    dynamicAttributeNames: resolution.dynamicAttributeNames,
    stableAttributeNames: resolution.stableAttributeNames,
    hasAccessibleName: accessibleName,
    hitTest,
    stability,
  });
}

/** Walks one root (a Document or an open ShadowRoot) — recurses into open shadow roots and accessible same-origin iframes. */
function collectFromRoot(
  root: ParentNode,
  state: CollectorState,
  options: Required<Omit<DomHealthCollectorOptions, "freshAudit">>,
  depth: number,
  insideShadowDom: boolean,
  previousRegistry: Map<Element, RegistryEntry>,
  currentRegistry: Map<Element, RegistryEntry>,
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

    const interactive = isInteractiveElement(el, tag);
    let style: StyleSignals | null = null;
    if (state.styleChecksPerformed < options.maxStyleChecks) {
      state.styleChecksPerformed++;
      style = readStyleSignals(el);
    }

    const classification = classifyElement(
      el,
      tag,
      style,
      insideShadowDom,
      interactive,
    );

    if (classification === "hidden") state.universe.hidden++;
    else state.universe.meaningful++;
    if (classification === "iframe") state.universe.iframeElements++;
    if (insideShadowDom) state.universe.shadowDomElements++;

    // z-index only has effect on a positioned element — jsdom returns ""
    // (not the spec default "static") for an unset `position`, so both are
    // treated as "not positioned".
    const isPositioned =
      Boolean(style?.position) && style?.position !== "static";
    if (isPositioned && style && style.zIndex > 0) {
      if (style.zIndex > state.maxZIndex) state.maxZIndex = style.zIndex;
      if (style.zIndex >= HIGH_Z_INDEX_THRESHOLD) {
        state.highZIndexElementCount++;
      }
    }

    if (interactive) {
      state.interactiveCount++;
      if (state.elementReports.length < options.maxInteractiveElements) {
        analyzeInteractiveElement(
          el,
          root,
          state,
          previousRegistry,
          currentRegistry,
        );
      }
    }

    const shadowRoot = (el as HTMLElement).shadowRoot;
    if (shadowRoot) {
      state.shadowRoots++;
      collectFromRoot(
        shadowRoot,
        state,
        options,
        depth,
        true,
        previousRegistry,
        currentRegistry,
      );
    }
  }

  const iframes = root.querySelectorAll("iframe");
  for (const iframe of Array.from(iframes)) {
    state.iframeTotal++;
    if (depth >= MAX_FRAME_DEPTH) {
      state.iframeCrossOrigin++;
      state.universe.inaccessible++;
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
        previousRegistry,
        currentRegistry,
      );
    } else {
      state.iframeCrossOrigin++;
      state.universe.inaccessible++;
    }
  }
}

/**
 * Collect a DOM Health snapshot from the given document. Synchronous and
 * single-pass. Safe to call 2-3 times across one audit run (see
 * `DomHealthCollectorOptions.freshAudit`) — cross-snapshot stability is
 * tracked internally via a short-lived element registry, not by the caller.
 */
export function collectDomHealthSnapshot(
  rootDocument: Document,
  options: DomHealthCollectorOptions = {},
): DomHealthSnapshot {
  const resolvedOptions = {
    maxInteractiveElements:
      options.maxInteractiveElements ?? DEFAULT_MAX_INTERACTIVE_ELEMENTS,
    maxStyleChecks: options.maxStyleChecks ?? DEFAULT_MAX_STYLE_CHECKS,
  };
  const freshAudit = options.freshAudit !== false;

  const previousRegistry = freshAudit
    ? new Map<Element, RegistryEntry>()
    : auditRegistry;
  const currentRegistry = new Map<Element, RegistryEntry>();
  const hasMultiSnapshotEvidence = previousRegistry.size > 0;

  const state = createState();
  collectFromRoot(
    rootDocument.body ?? rootDocument,
    state,
    resolvedOptions,
    0,
    false,
    previousRegistry,
    currentRegistry,
  );

  if (hasMultiSnapshotEvidence) {
    for (const [el] of previousRegistry) {
      if (!currentRegistry.has(el)) state.stability.detached++;
    }
  }

  auditRegistry = currentRegistry;

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
    elementUniverse: {
      totalElements: state.totalElements,
      meaningfulElements: state.universe.meaningful,
      interactiveElements: state.interactiveCount,
      hiddenElements: state.universe.hidden,
      inaccessibleElements: state.universe.inaccessible,
      iframeElements: state.universe.iframeElements,
      shadowDomElements: state.universe.shadowDomElements,
    },
    elementReports: state.elementReports,
    selectorAnalysis: {
      totalAnalyzed: state.elementReports.length,
      ...state.selectorAnalysis,
    },
    dynamicAttributes: {
      ...state.dynamicAttrs,
      hasMultiSnapshotEvidence,
    },
    stability: state.stability,
    hitTesting: state.hitTesting,
    ancestorTraversal: state.ancestorTraversal,
    positionalDependency: {
      positionalCount: state.positional.positionalCount,
      stableAcrossSnapshots: state.positional.stableAcrossSnapshots,
      unstableAcrossSnapshots: state.positional.unstableAcrossSnapshots,
    },
    accessibility: state.accessibility,
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

/** Test-only: clears the cross-snapshot element registry so tests don't leak state between cases. */
export function __resetDomHealthRegistryForTests(): void {
  auditRegistry = new Map();
}
