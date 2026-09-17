/**
 * Apty DOM Health collector.
 *
 * Runs entirely in-page (content-script context), because the evidence the
 * DOM Health feature needs — real selector uniqueness, target identity,
 * cross-snapshot stability, and hit-testing — can only be produced against
 * a live DOM. This collector is where "measure" and "verify" happen (see
 * `health-selector-engine.ts` and `health-hit-test.ts`); the scoring engine
 * in `@apty/browser-runtime` only aggregates and weights numbers
 * that already exist on the snapshot it's given.
 *
 * Cross-snapshot stability (spec section 18/23) is tracked with a LOGICAL
 * fingerprint (`computeElementFingerprint` — tag/role/accessible-name/
 * stable-attributes/text sample), not raw DOM-node identity and not array
 * position: a framework can replace the underlying node on rerender while
 * the logical control persists, and a fingerprint match survives that. The
 * previously-chosen selector for a matched fingerprint is re-queried
 * against the live DOM right now — if it no longer resolves, or resolves
 * to a different element, that is real, verified instability.
 *
 * The full interactive-element universe is analyzed in yielding batches
 * (spec section 6) rather than silently truncated at a fixed sample size —
 * see `BATCH_SIZE`/`DEFAULT_ELEMENT_CEILING`. `analysisCoverage.capped`
 * is only ever true if the runaway-safety ceiling was actually hit, and
 * that fact is reported, never hidden.
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
 * - A fingerprint collision (two distinct elements sharing tag/role/name/
 *   stable-attrs/text-sample) is possible on a pathological DOM; correlation
 *   takes the first match. This is documented, probabilistic evidence, not
 *   a cryptographic identity guarantee.
 */
import { hitTestElement } from "./health-hit-test.js";
import {
  computeElementFingerprint,
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

/**
 * Runaway-safety ceiling on how many interactive elements get the full
 * selector-resolution + hit-test pipeline — NOT a target sample size. A
 * real page is expected to stay far below this; if it's ever hit, that
 * fact is reported via `analysisCoverage.capped`, never silently absorbed
 * into the score.
 */
const DEFAULT_ELEMENT_CEILING = 4000;
/** How many elements are analyzed per batch before yielding to the event loop, so a large page's audit never blocks the tab. */
const BATCH_SIZE = 150;
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
  el: Element;
  selector: string;
  root: ParentNode;
  id?: string;
  className?: string;
}

/**
 * Module-scoped, short-lived: holds the previous snapshot's chosen selector
 * per LOGICAL fingerprint (not per DOM-node object) for exactly as long as
 * one audit run's 2-3 calls take. Reset whenever a new audit starts
 * (`freshAudit !== false`). Never sent across the extension message
 * boundary — only plain data on `DomHealthSnapshot` is serialized.
 */
let auditRegistry = new Map<string, RegistryEntry>();

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
  /** Interactive elements found during traversal, queued for the batched analysis pass. */
  interactiveCandidates: Array<{ el: Element; root: ParentNode }>;
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
    changed: number;
    detached: number;
    new: number;
    unknown: number;
    nodeReplacedButLogicallyStable: number;
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
    changedAcrossSnapshots: number;
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
    interactiveCandidates: [],
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
      changed: 0,
      detached: 0,
      new: 0,
      unknown: 0,
      nodeReplacedButLogicallyStable: 0,
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
      changedAcrossSnapshots: 0,
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

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function analyzeInteractiveElement(
  el: Element,
  root: ParentNode,
  state: CollectorState,
  hasMultiSnapshotEvidence: boolean,
  previousRegistry: Map<string, RegistryEntry>,
  currentRegistry: Map<string, RegistryEntry>,
): void {
  const attributes = extractElementAttributes(el);
  const resolution = resolveElement(root, el);
  const hitTest = hitTestElement(el);
  const accessibleName = hasAccessibleName(el);
  const fingerprint = computeElementFingerprint(el);

  const previous = previousRegistry.get(fingerprint);
  let stability: StabilityVerdict;
  let nodeReplaced = false;

  if (!hasMultiSnapshotEvidence) {
    stability = "UNKNOWN";
  } else if (!previous) {
    stability = "NEW";
    state.stability.new++;
  } else {
    state.stability.trackedFromPrevious++;
    nodeReplaced = previous.el !== el;
    const result = testSelector(previous.root, previous.selector, el);
    stability =
      result.matchCount === 1 && result.matchesTarget ? "STABLE" : "CHANGED";
    if (stability === "STABLE") state.stability.stable++;
    else state.stability.changed++;
    if (nodeReplaced) state.stability.nodeReplacedButLogicallyStable++;

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
      else state.positional.changedAcrossSnapshots++;
    }
  }

  // First interactive element wins a given fingerprint slot for this pass —
  // a collision on a pathological DOM degrades to "not tracked", never to
  // a false stability claim.
  if (!currentRegistry.has(fingerprint)) {
    currentRegistry.set(fingerprint, {
      el,
      selector: resolution.bestSelector ?? "",
      root,
      id: attributes.id,
      className: attributes.className,
    });
  }

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
    winningAttribute: resolution.winningAttribute,
    hasAccessibleName: accessibleName,
    hitTest,
    stability,
  });
}

/** Walks one root (a Document or an open ShadowRoot) — recurses into open shadow roots and accessible same-origin iframes. Only classifies/counts elements and queues interactive candidates; the expensive per-element pipeline runs afterward, in batches. */
function collectFromRoot(
  root: ParentNode,
  state: CollectorState,
  options: { maxStyleChecks: number },
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
      state.interactiveCandidates.push({ el, root });
    }

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
      );
    } else {
      state.iframeCrossOrigin++;
      state.universe.inaccessible++;
    }
  }
}

/**
 * Collect a DOM Health snapshot from the given document. Safe to call 2-3
 * times across one audit run (see `DomHealthCollectorOptions.freshAudit`) —
 * cross-snapshot stability is tracked internally via a short-lived logical
 * registry, not by the caller. Async: the full interactive-element universe
 * is processed in yielding batches so a large page's audit never blocks the
 * tab (spec section 6/36).
 */
export async function collectDomHealthSnapshot(
  rootDocument: Document,
  options: DomHealthCollectorOptions = {},
): Promise<DomHealthSnapshot> {
  const elementCeiling =
    options.maxInteractiveElements ?? DEFAULT_ELEMENT_CEILING;
  const maxStyleChecks = options.maxStyleChecks ?? DEFAULT_MAX_STYLE_CHECKS;
  const freshAudit = options.freshAudit !== false;

  const previousRegistry = freshAudit
    ? new Map<string, RegistryEntry>()
    : auditRegistry;
  const currentRegistry = new Map<string, RegistryEntry>();
  const hasMultiSnapshotEvidence = previousRegistry.size > 0;

  const state = createState();
  collectFromRoot(
    rootDocument.body ?? rootDocument,
    state,
    { maxStyleChecks },
    0,
    false,
  );

  const capped = state.interactiveCandidates.length > elementCeiling;
  const candidatesToAnalyze = capped
    ? state.interactiveCandidates.slice(0, elementCeiling)
    : state.interactiveCandidates;

  for (let i = 0; i < candidatesToAnalyze.length; i += BATCH_SIZE) {
    const batch = candidatesToAnalyze.slice(i, i + BATCH_SIZE);
    for (const { el, root } of batch) {
      analyzeInteractiveElement(
        el,
        root,
        state,
        hasMultiSnapshotEvidence,
        previousRegistry,
        currentRegistry,
      );
    }
    if (i + BATCH_SIZE < candidatesToAnalyze.length) {
      await yieldToEventLoop();
    }
  }

  if (hasMultiSnapshotEvidence) {
    for (const [fingerprint] of previousRegistry) {
      if (!currentRegistry.has(fingerprint)) state.stability.detached++;
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
    analysisCoverage: {
      candidatesFound: state.interactiveCandidates.length,
      candidatesAnalyzed: candidatesToAnalyze.length,
      capped,
      capReason: capped
        ? `Runaway-safety ceiling of ${elementCeiling} interactive elements reached — this page has more than that many; analysis covers the first ${elementCeiling} found in document order.`
        : null,
    },
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
      changedAcrossSnapshots: state.positional.changedAcrossSnapshots,
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
