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
 * - This collector NEVER reaches into a child `<iframe>`/`<frame>`'s
 *   `contentDocument` from the parent's own script. Two reasons: (1) the
 *   browser's same-origin policy blocks that for cross-origin frames
 *   regardless, and (2) even for a same-origin frame, that isn't actually
 *   the right way to see it — a real `<frame>`/`<iframe>` is a separate
 *   browsing context with its OWN content-script instance (the extension's
 *   manifest injects with `all_frames: true`), which can see that frame's
 *   document natively, with no cross-origin restriction at all, as long as
 *   it is addressed directly. That addressing is a browser-extension
 *   concept this pure-DOM package deliberately has no access to — it's
 *   handled by `@apty/browser-runtime`'s `frame-tree.ts` (enumerates every
 *   frame via `chrome.webNavigation.getAllFrames`) and `frame-audit.ts`
 *   (messages each frame directly by `frameId` and combines the results).
 *   This collector only ever reports how many child frame-hosting elements
 *   (`<iframe>` AND legacy `<frame>`, see `iframes.byTag`) this ONE document
 *   owns — never their contents, and never a same-origin/cross-origin guess.
 * - Closed Shadow DOM roots (`{mode: "closed"}`) are traversed through
 *   `chrome.dom.openOrClosedShadowRoot` when running in an extension
 *   content script (see `shadow-roots.ts`); elsewhere only open roots are.
 * - Style-based checks (hidden/overlay classification, z-index) are bounded
 *   to `maxStyleChecks` elements (default 2000) to avoid forcing a full-page
 *   style recalculation on very large pages; elements beyond that bound are
 *   assumed visible/non-overlay rather than the audit becoming slow/blocking.
 * - A fingerprint collision (two distinct elements sharing tag/role/name/
 *   stable-attrs/text-sample) is detected explicitly: every element sharing
 *   a fingerprint with another element in THIS snapshot is reported
 *   `AMBIGUOUS`, never silently resolved by taking the first match.
 */
import { type ElementPath, resetDesPerformanceCaches } from "./des-engine.js";
import { hitTestElement } from "./health-hit-test.js";
import {
  isInPrivateContainer,
  sanitizeReportAttributes,
  sanitizeSelector,
} from "./health-privacy.js";
import {
  computeComposedFingerprint,
  type ElementResolution,
  extractElementAttributes,
  hasAccessibleName,
  hashFingerprint,
  resolveInComposedTree,
  verifyStoredElementPath,
} from "./health-selector-engine.js";
import type {
  DomHealthCollectorOptions,
  DomHealthSnapshot,
  DuplicateIdStats,
  ElementClassification,
  ElementPathSample,
  ElementSelectorReport,
  StabilityVerdict,
} from "./health-types.js";
import {
  findIgnoredRoots,
  type IgnoredRootMatcher,
  ignoredRootPolicy,
} from "./ignored-roots.js";
import { shadowRootOf } from "./shadow-roots.js";

/**
 * Runaway-safety ceiling on how many interactive elements get the full
 * selector-resolution + hit-test pipeline — NOT a target sample size. A
 * real page is expected to stay far below this; if it's ever hit, that
 * fact is reported via `analysisCoverage.capped`, never silently absorbed
 * into the score.
 */
const DEFAULT_ELEMENT_CEILING = 4000;
const DEFAULT_MAX_STYLE_CHECKS = 2000;
/**
 * Per-frame budget (DOM Health brief, section 4.11). The Infor LN top
 * document, the largest measured, has 3,788 elements and 251 shadow
 * roots; the element and root ceilings sit an order of magnitude above it
 * so they only stop a runaway page. The time budget stays below the
 * service worker's 8 s per-frame message timeout, so a slow frame returns
 * a partial, labelled result instead of nothing. The 16 ms slice is one
 * frame at 60 Hz: the collector yields to the page at least that often.
 * None of these was tuned on a live tenant.
 */
export const DEFAULT_COLLECTOR_BUDGET = {
  maxTotalElements: 50_000,
  maxShadowRoots: 2_500,
  timeBudgetMs: 6_000,
  sliceMs: 16,
} as const;
/** Caps `elementPathSamples` (cross-application-state replay candidates) so the message payload never grows unbounded on a huge page — first-N-in-document-order, not a "most important" ranking. */
const MAX_ELEMENT_PATH_SAMPLES = 50;
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
  /** The real Apty-style path captured for this element at the PREVIOUS state — replayed (never regenerated) against the current live DOM by `verifyStoredElementPath`. Null only when the previous resolution was `INACCESSIBLE`. */
  path: ElementPath | null;
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
  if (tag === "iframe" || tag === "frame") return "iframe";
  if (shadowRootOf(el)) return "shadow-host";
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
  budget: CollectorBudget;
  /** Elements inside ignored roots (`ignored-roots.ts`): never counted or analyzed. */
  excluded: ReadonlySet<Element>;
  policy: readonly IgnoredRootMatcher[];
  /** Id value counts per root (a document or a shadow root). */
  idCounts: Map<Node, Map<string, number>>;
  /** Per root, the id values more than one element there uses. */
  duplicateIdsByRoot: Map<Node, Set<string>>;
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
  elementPathSamples: ElementPathSample[];
  universe: {
    meaningful: number;
    hidden: number;
    inaccessible: number;
    iframeElements: number;
    shadowDomElements: number;
  };
  iframeTotal: number;
  iframeByTag: { iframe: number; frame: number };
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
    directStable: number;
    recoveredStable: number;
    positionalStable: number;
    wrongTarget: number;
    notResolved: number;
    detached: number;
    new: number;
    unknown: number;
    nodeReplacedButLogicallyStable: number;
    ambiguous: number;
    inaccessible: number;
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

function createState(
  budget: CollectorBudget,
  excluded: ReadonlySet<Element>,
  policy: readonly IgnoredRootMatcher[],
): CollectorState {
  return {
    budget,
    excluded,
    policy,
    idCounts: new Map(),
    duplicateIdsByRoot: new Map(),
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
    elementPathSamples: [],
    universe: {
      meaningful: 0,
      hidden: 0,
      inaccessible: 0,
      iframeElements: 0,
      shadowDomElements: 0,
    },
    iframeTotal: 0,
    iframeByTag: { iframe: 0, frame: 0 },
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
      directStable: 0,
      recoveredStable: 0,
      positionalStable: 0,
      wrongTarget: 0,
      notResolved: 0,
      detached: 0,
      new: 0,
      unknown: 0,
      nodeReplacedButLogicallyStable: 0,
      ambiguous: 0,
      inaccessible: 0,
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

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Ceilings, the time budget and the slice clock for one collection. */
interface CollectorBudget {
  maxTotalElements: number;
  maxShadowRoots: number;
  timeBudgetMs: number;
  startedAt: number;
  /** True once the time budget is spent: nothing further is traversed or analyzed. */
  expired: boolean;
  /** Why the result is partial, for the report. */
  reasons: string[];
  longestSliceMs: number;
  /** Longest single unit of work between two clock checks: the floor on how long a slice can be. */
  longestStepMs: number;
  yields: number;
  note(reason: string): void;
  /** Yield to the page once the current slice is used up; true once the time budget is spent. */
  tick(): Promise<boolean>;
  /** Close the last slice, so `longestSliceMs` covers the whole run. */
  finish(): void;
}

function createBudget(options: DomHealthCollectorOptions): CollectorBudget {
  const sliceMs = options.sliceMs ?? DEFAULT_COLLECTOR_BUDGET.sliceMs;
  const startedAt = now();
  let sliceStart = startedAt;
  let lastCheck = startedAt;
  const closeSlice = (at: number) => {
    budget.longestSliceMs = Math.max(budget.longestSliceMs, at - sliceStart);
  };
  const budget: CollectorBudget = {
    maxTotalElements:
      options.maxTotalElements ?? DEFAULT_COLLECTOR_BUDGET.maxTotalElements,
    maxShadowRoots:
      options.maxShadowRoots ?? DEFAULT_COLLECTOR_BUDGET.maxShadowRoots,
    timeBudgetMs: options.timeBudgetMs ?? DEFAULT_COLLECTOR_BUDGET.timeBudgetMs,
    startedAt,
    expired: false,
    reasons: [],
    longestSliceMs: 0,
    longestStepMs: 0,
    yields: 0,
    note(reason) {
      if (!budget.reasons.includes(reason)) budget.reasons.push(reason);
    },
    async tick() {
      if (budget.expired) return true;
      const t = now();
      budget.longestStepMs = Math.max(budget.longestStepMs, t - lastCheck);
      lastCheck = t;
      if (t - startedAt > budget.timeBudgetMs) {
        budget.expired = true;
        budget.note(
          `Time budget of ${budget.timeBudgetMs} ms reached; the rest of this frame was not analyzed.`,
        );
        return true;
      }
      if (t - sliceStart >= sliceMs) {
        closeSlice(t);
        budget.yields++;
        await yieldToEventLoop();
        sliceStart = now();
        lastCheck = sliceStart;
      }
      return false;
    },
    finish() {
      const t = now();
      budget.longestStepMs = Math.max(budget.longestStepMs, t - lastCheck);
      closeSlice(t);
    },
  };
  return budget;
}

function analyzeInteractiveElement(
  el: Element,
  root: ParentNode,
  state: CollectorState,
  hasMultiSnapshotEvidence: boolean,
  previousRegistry: Map<string, RegistryEntry>,
  currentRegistry: Map<string, RegistryEntry>,
  duplicateFingerprintsThisSnapshot: Set<string>,
  hostCache: Map<Element, ElementResolution>,
  frameKey: string,
): void {
  const attributes = extractElementAttributes(el);
  const resolution = resolveInComposedTree(
    el,
    { duplicateIdsFor: (owner) => state.duplicateIdsByRoot.get(owner) },
    hostCache,
    frameKey,
  );
  const hitTest = hitTestElement(el, state.policy);
  const accessibleName = hasAccessibleName(el);
  const fingerprint = computeComposedFingerprint(el);
  const fingerprintIsAmbiguous =
    duplicateFingerprintsThisSnapshot.has(fingerprint);

  const previous = previousRegistry.get(fingerprint);
  let stability: StabilityVerdict;
  let nodeReplaced = false;

  if (fingerprintIsAmbiguous) {
    // Two or more distinct elements in THIS snapshot share the fingerprint —
    // correlation cannot safely attribute a previous entry (or anchor a
    // future one) to any single one of them, so every element sharing it is
    // reported AMBIGUOUS rather than one silently winning "first match".
    stability = "AMBIGUOUS";
    state.stability.ambiguous++;
  } else if (!hasMultiSnapshotEvidence) {
    stability = "UNKNOWN";
  } else if (!previous) {
    stability = "NEW";
    state.stability.new++;
  } else {
    state.stability.trackedFromPrevious++;
    nodeReplaced = previous.el !== el;

    if (!previous.path) {
      // The previous state's resolution was INACCESSIBLE — there was never
      // a path to store, so there is nothing real to replay. Never
      // fabricate a stability verdict from nothing.
      stability = "INACCESSIBLE";
      state.stability.inaccessible++;
    } else {
      // The GOOD cross-state pattern: replay the path CAPTURED at the
      // previous state against THIS state's live DOM via the real,
      // unmodified DES `findElement` pipeline — never regenerate a fresh
      // path from the current DOM and compare it to the old one.
      const verification = verifyStoredElementPath(
        root,
        previous.path,
        fingerprint,
      );
      switch (verification.verdict) {
        case "DIRECT_STABLE":
          stability = "DIRECT_STABLE";
          state.stability.directStable++;
          break;
        case "RECOVERED_STABLE":
          stability = "RECOVERED_STABLE";
          state.stability.recoveredStable++;
          break;
        case "POSITIONAL_STABLE":
          stability = "POSITIONAL_STABLE";
          state.stability.positionalStable++;
          break;
        case "WRONG_TARGET":
          stability = "WRONG_TARGET";
          state.stability.wrongTarget++;
          break;
        case "NOT_RESOLVED":
        case "HOST_NOT_RESOLVED":
          stability = "NOT_RESOLVED";
          state.stability.notResolved++;
          break;
        case "AMBIGUOUS":
          stability = "AMBIGUOUS";
          state.stability.ambiguous++;
          break;
      }
    }

    const foundCorrectly =
      stability === "DIRECT_STABLE" ||
      stability === "RECOVERED_STABLE" ||
      stability === "POSITIONAL_STABLE";
    if (nodeReplaced && foundCorrectly) {
      state.stability.nodeReplacedButLogicallyStable++;
    }

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
      if (foundCorrectly) state.positional.stableAcrossSnapshots++;
      else state.positional.changedAcrossSnapshots++;
    }
  }

  // An ambiguous-fingerprint element is never trusted as a future "previous"
  // anchor either — degrade to "not tracked" for next time, never a false
  // stability claim built on an unreliable identity.
  if (!fingerprintIsAmbiguous && !currentRegistry.has(fingerprint)) {
    currentRegistry.set(fingerprint, {
      el,
      path: resolution.elementPath,
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
    attributes: sanitizeReportAttributes(attributes, el),
    outcome: resolution.outcome,
    strategy: resolution.strategy,
    bestSelector: sanitizeSelector(resolution.bestSelector, el),
    shadowDepth: resolution.shadowDepth,
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

  // A bounded sample of this element's real Apty-style path, for a caller
  // (application-audit.ts) to later REPLAY against a different discovered
  // application state — cross-STATE validation, never cross-snapshot-only.
  // Never sampled from an ambiguous-fingerprint or unresolved element: a
  // colliding or nonexistent anchor is useless as a later identity check.
  if (
    !fingerprintIsAmbiguous &&
    resolution.elementRef &&
    resolution.outcome !== "AMBIGUOUS" &&
    resolution.outcome !== "WRONG_TARGET" &&
    resolution.outcome !== "NOT_RESOLVED" &&
    resolution.outcome !== "INACCESSIBLE" &&
    state.elementPathSamples.length < MAX_ELEMENT_PATH_SAMPLES &&
    !isInPrivateContainer(el)
  ) {
    state.elementPathSamples.push({
      fingerprint: hashFingerprint(fingerprint),
      ref: resolution.elementRef,
      tagName: el.tagName.toLowerCase(),
      selector: sanitizeSelector(resolution.bestSelector, el),
      outcome: resolution.outcome,
    });
  }
}

/**
 * Walks one root (a Document or a ShadowRoot) — recurses into every shadow
 * root `shadowRootOf` can reach. Never reaches into a child `<iframe>`/`<frame>`'s
 * `contentDocument` — see the module doc comment for why; a child frame's
 * own document is a separate browsing context with its own content-script
 * instance, addressed directly by `@apty/browser-runtime`'s
 * `frame-audit.ts`, not read through this one. Only classifies/counts
 * elements and queues interactive candidates; the expensive per-element
 * pipeline runs afterward, in batches.
 */
function countId(state: CollectorState, el: Element): void {
  const owner = el.getRootNode();
  const counts = state.idCounts.get(owner) ?? new Map<string, number>();
  counts.set(el.id, (counts.get(el.id) ?? 0) + 1);
  state.idCounts.set(owner, counts);
}

/** Fills `state.duplicateIdsByRoot` (read by element analysis) and summarizes it. */
function findDuplicateIds(state: CollectorState): DuplicateIdStats {
  const pageWide = new Map<string, number>();
  const withinRoot = new Set<string>();
  let elementsWithDuplicatedId = 0;
  for (const [owner, counts] of state.idCounts) {
    const duplicated = new Set<string>();
    for (const [id, count] of counts) {
      pageWide.set(id, (pageWide.get(id) ?? 0) + count);
      if (count < 2) continue;
      duplicated.add(id);
      withinRoot.add(id);
      elementsWithDuplicatedId += count;
    }
    if (duplicated.size > 0) state.duplicateIdsByRoot.set(owner, duplicated);
  }
  return {
    valuesDuplicatedWithinARoot: withinRoot.size,
    valuesDuplicatedPageWide: [...pageWide.values()].filter((n) => n > 1)
      .length,
    elementsWithDuplicatedId,
    sampleValues: [...withinRoot].slice(0, 5),
  };
}

async function collectFromRoot(
  root: ParentNode,
  state: CollectorState,
  options: { maxStyleChecks: number },
  insideShadowDom: boolean,
): Promise<void> {
  if (state.budget.expired) return;
  let all = Array.from(root.querySelectorAll("*")).filter(
    (el) => !state.excluded.has(el),
  );
  const room = state.budget.maxTotalElements - state.totalElements;
  if (all.length > room) {
    all = all.slice(0, Math.max(0, room));
    state.budget.note(
      `Element ceiling of ${state.budget.maxTotalElements} reached; elements after it were not counted or analyzed.`,
    );
  }
  state.totalElements += all.length;
  if (insideShadowDom) state.shadowElements += all.length;
  if (await state.budget.tick()) return;

  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (el.id) countId(state, el);

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

    const shadowRoot = shadowRootOf(el);
    if (shadowRoot) {
      if (state.shadowRoots >= state.budget.maxShadowRoots) {
        state.budget.note(
          `Shadow-root ceiling of ${state.budget.maxShadowRoots} reached; roots after it were not entered.`,
        );
      } else {
        state.shadowRoots++;
        await collectFromRoot(shadowRoot, state, options, true);
      }
    }
    if (await state.budget.tick()) return;
  }

  // Tally child frame-hosting elements this document owns, by tag — never
  // attempt to read their content (see module/function doc comments). A
  // legacy `<frame>` counts exactly like an `<iframe>`: both are separate
  // browsing contexts, addressed independently by the frame-tree layer.
  const frameHosts = (selector: string) =>
    Array.from(root.querySelectorAll(selector)).filter(
      (el) => !state.excluded.has(el),
    ).length;
  const iframeCount = frameHosts("iframe");
  const frameCount = frameHosts("frame");
  state.iframeByTag.iframe += iframeCount;
  state.iframeByTag.frame += frameCount;
  state.iframeTotal += iframeCount + frameCount;
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

  // DES's per-parent sibling-order cache (a perf optimization — see
  // des-engine.ts's `getSiblingInfo`) is only ever valid for the DOM as it
  // exists RIGHT NOW; a later round of the same audit may have
  // legitimately inserted/removed/reordered a sibling, so it is reset at
  // the start of every collection, not just fresh audits.
  resetDesPerformanceCaches();

  const previousRegistry = freshAudit
    ? new Map<string, RegistryEntry>()
    : auditRegistry;
  const currentRegistry = new Map<string, RegistryEntry>();
  const hasMultiSnapshotEvidence = previousRegistry.size > 0;

  const budget = createBudget(options);
  const policy = ignoredRootPolicy(options.ignoredRoots);
  const ignored = findIgnoredRoots(rootDocument, policy);
  const ignoredRootsMs = now() - budget.startedAt;
  await budget.tick();
  const state = createState(budget, ignored.excluded, policy);
  await collectFromRoot(
    rootDocument.body ?? rootDocument,
    state,
    { maxStyleChecks },
    false,
  );
  const duplicateIds = findDuplicateIds(state);
  const classifiedAt = now();

  const capped = state.interactiveCandidates.length > elementCeiling;
  const candidatesToAnalyze = capped
    ? state.interactiveCandidates.slice(0, elementCeiling)
    : state.interactiveCandidates;

  // Pre-pass: find every fingerprint shared by 2+ elements in THIS
  // snapshot before doing any stability comparison, so a collision can be
  // reported AMBIGUOUS for every element that shares it — never resolved
  // by whichever one happens to be analyzed first.
  const fingerprintCounts = new Map<string, number>();
  for (const { el } of candidatesToAnalyze) {
    await budget.tick();
    const fingerprint = computeComposedFingerprint(el);
    fingerprintCounts.set(
      fingerprint,
      (fingerprintCounts.get(fingerprint) ?? 0) + 1,
    );
  }
  const duplicateFingerprintsThisSnapshot = new Set(
    Array.from(fingerprintCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([fingerprint]) => fingerprint),
  );

  const hostCache = new Map<Element, ElementResolution>();
  const frameKey = options.frameContext?.frameKey ?? "";
  let analyzed = 0;
  for (const { el, root } of candidatesToAnalyze) {
    if (await budget.tick()) break;
    analyzeInteractiveElement(
      el,
      root,
      state,
      hasMultiSnapshotEvidence,
      previousRegistry,
      currentRegistry,
      duplicateFingerprintsThisSnapshot,
      hostCache,
      frameKey,
    );
    analyzed++;
  }
  budget.finish();
  const finishedAt = now();

  // An element the budget never reached is not "detached": only a run that
  // looked at everything may say an element is gone.
  if (hasMultiSnapshotEvidence && !budget.expired) {
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
      candidatesAnalyzed: analyzed,
      capped: capped || budget.reasons.length > 0,
      capReason:
        [
          ...(capped
            ? [
                `Runaway-safety ceiling of ${elementCeiling} interactive elements reached — this page has more than that many; analysis covers the first ${elementCeiling} found in document order.`,
              ]
            : []),
          ...budget.reasons,
        ].join(" ") || null,
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
      accessible: 0,
      crossOrigin: 0,
      byTag: { ...state.iframeByTag },
    },
    shadowDom: {
      roots: state.shadowRoots,
      elements: state.shadowElements,
    },
    zIndex: {
      maxZIndex: state.maxZIndex,
      highZIndexElementCount: state.highZIndexElementCount,
    },
    frame: options.frameContext ?? null,
    elementPathSamples: state.elementPathSamples,
    excludedRoots: ignored.summary,
    duplicateIds,
    performance: {
      timings: {
        ignoredRootsMs: round(ignoredRootsMs),
        classifyMs: round(classifiedAt - budget.startedAt - ignoredRootsMs),
        analyzeMs: round(finishedAt - classifiedAt),
        totalMs: round(finishedAt - budget.startedAt),
      },
      longestSliceMs: round(budget.longestSliceMs),
      longestStepMs: round(budget.longestStepMs),
      yields: budget.yields,
      limits: {
        maxTotalElements: budget.maxTotalElements,
        maxShadowRoots: budget.maxShadowRoots,
        timeBudgetMs: budget.timeBudgetMs,
        sliceMs: options.sliceMs ?? DEFAULT_COLLECTOR_BUDGET.sliceMs,
      },
      partialReasons: budget.reasons,
    },
  };
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/** Test-only: clears the cross-snapshot element registry so tests don't leak state between cases. */
export function __resetDomHealthRegistryForTests(): void {
  auditRegistry = new Map();
}
