/**
 * Multi-frame capture and aggregation for one point-in-time "application
 * state" (forensic audit RC-1/RC-2/RC-11). This is the layer that replaces
 * the single, un-addressed `chrome.tabs.sendMessage` call the previous DOM
 * Health implementation used: it enumerates the tab's real frame tree
 * (`frame-tree.ts`), messages every accessible frame BY `frameId`
 * (never a broadcast), and combines the per-frame results into one
 * evidence-complete snapshot for the existing scoring pipeline.
 *
 * Correlation identity: because every frame is addressed explicitly and
 * runs its OWN content-script instance (a separate JS realm, so
 * `health-collector.ts`'s cross-snapshot registry is already scoped per
 * frame automatically), this module's aggregation step only ever combines
 * "frame N's snapshot at round 1" with "frame N's snapshot at round 2" —
 * never two different frames' data. That structurally rules out the
 * cross-frame correlation contamination the forensic audit flagged (RC-11):
 * there is no step anywhere in this file that compares one frame's
 * elements against a different frame's registry.
 */
import type {
  DomHealthSnapshot,
  ElementSelectorReport,
  FrameStateSignature,
} from "@apty/dom-snapshot";
import {
  type AuditFrame,
  type FrameAccessibilitySummary,
  getFrameTree,
  sendFrameMessage,
} from "./frame-tree.js";
import type { FrameSignatureEntry } from "./state-fingerprint.js";

export type FrameCaptureStatus =
  | "captured"
  | "failed"
  | "skipped-about-blank"
  | "skipped-navigation-error";

export interface FrameCaptureResult {
  frame: AuditFrame;
  status: FrameCaptureStatus;
  snapshot?: DomHealthSnapshot;
  stateSignature?: FrameStateSignature;
  error?: string;
}

export interface CaptureStateOptions {
  /** 0 starts a fresh audit (resets each frame's cross-snapshot registry); any later round in the same audit continues it. */
  sequenceIndex: number;
  timeoutMs?: number;
  /** Runaway-safety ceiling forwarded to each frame's collector. */
  maxInteractiveElements?: number;
}

export interface CaptureStateResult {
  frameTree: AuditFrame[];
  frames: FrameCaptureResult[];
  frameAccessibility: FrameAccessibilitySummary;
}

export type CaptureApplicationStateOutcome =
  | { available: true; result: CaptureStateResult }
  | { available: false; error: string };

interface FrameBundleResponse {
  snapshot: DomHealthSnapshot;
  stateSignature: FrameStateSignature;
}

/**
 * Capture one point-in-time snapshot of every reachable frame in the tab.
 * Never throws — a frame the browser reports as errored, a frame that
 * never answers, or a bare `about:blank` placeholder is recorded with an
 * explicit status rather than silently dropped or treated as empty.
 */
export async function captureApplicationState(
  tabId: number,
  options: CaptureStateOptions,
): Promise<CaptureApplicationStateOutcome> {
  const frameTree = await getFrameTree(tabId);
  if (!frameTree) {
    return {
      available: false,
      error: "Could not enumerate this tab's frames — it may have been closed.",
    };
  }

  const frames: FrameCaptureResult[] = await Promise.all(
    frameTree.map(async (frame): Promise<FrameCaptureResult> => {
      if (frame.errorOccurred) {
        return { frame, status: "skipped-navigation-error" };
      }
      if (frame.isAboutBlank) {
        return { frame, status: "skipped-about-blank" };
      }

      // The content script cannot reliably determine its own frameId,
      // parentFrameId, or depth (`chrome.webNavigation` is not available
      // inside a content script's isolated world) — so THIS layer, which
      // already knows all of it from `getFrameTree`, hands it down in the
      // request rather than asking the content script to guess.
      const response = await sendFrameMessage<FrameBundleResponse>(
        tabId,
        frame.frameId,
        {
          request: "collect-dom-health-frame-bundle",
          sequenceIndex: options.sequenceIndex,
          maxInteractiveElements: options.maxInteractiveElements,
          frameContext: {
            frameId: frame.frameId,
            url: frame.url,
            parentFrameId: frame.parentFrameId,
            depth: frame.depth,
          },
        },
        options.timeoutMs,
      );

      if (!response.success || !response.data) {
        return {
          frame,
          status: "failed",
          error: response.error ?? "This frame did not respond.",
        };
      }

      return {
        frame,
        status: "captured",
        snapshot: response.data.snapshot,
        stateSignature: response.data.stateSignature,
      };
    }),
  );

  const framesAccessible = frames.filter((f) => f.status === "captured").length;
  const framesFailed = frames.filter(
    (f) => f.status === "failed" || f.status === "skipped-navigation-error",
  ).length;

  const frameAccessibility: FrameAccessibilitySummary = {
    framesTotal: frameTree.length,
    framesAccessible,
    framesFailed,
    // This layer has no additional "reached, but blocked inside" signal
    // beyond a captured/failed split — a frame either answered with a real
    // snapshot or it did not. Reserved for a future signal (e.g. "entirely
    // closed-shadow-DOM content"), never fabricated here.
    framesInaccessible: 0,
  };

  return { available: true, result: { frameTree, frames, frameAccessibility } };
}

function emptySelectorAnalysis() {
  return {
    totalAnalyzed: 0,
    directSuccess: 0,
    recoveredByIgnore: 0,
    recoveredByPartial: 0,
    recoveredByContext: 0,
    positionalOnly: 0,
    ambiguous: 0,
    wrongTarget: 0,
    notResolved: 0,
    inaccessible: 0,
  };
}

/**
 * Combine every captured frame's snapshot into one aggregated,
 * evidence-complete `DomHealthSnapshot` — a real sum across real frames,
 * never an average and never a re-run of correlation across frames (each
 * frame's `elementReports` already carry that frame's own, independently
 * correct stability verdicts; this only concatenates them, tagging each
 * with where it came from).
 */
export function aggregateFrameSnapshots(
  frames: FrameCaptureResult[],
): DomHealthSnapshot {
  const captured = frames.filter(
    (f): f is FrameCaptureResult & { snapshot: DomHealthSnapshot } =>
      f.status === "captured" && f.snapshot !== undefined,
  );

  const topFrame =
    captured.find((f) => f.frame.frameType === "top") ?? captured[0];

  const elementReports: ElementSelectorReport[] = [];
  const selectorAnalysis = emptySelectorAnalysis();
  let totalElements = 0;
  let interactiveElements = 0;
  let buttons = 0;
  let inputs = 0;
  let selects = 0;
  let textareas = 0;
  let links = 0;
  let forms = 0;
  let contentEditable = 0;
  let meaningfulElements = 0;
  let hiddenElements = 0;
  let inaccessibleElements = 0;
  let iframeUniverseElements = 0;
  let shadowDomElements = 0;
  let candidatesFound = 0;
  let candidatesAnalyzed = 0;
  let capped = false;
  const capReasons: string[] = [];
  const dynamicAttrs = {
    idsObserved: 0,
    idsDynamicByHeuristic: 0,
    idsChangedAcrossSnapshots: 0,
    classesObserved: 0,
    classesDynamicByHeuristic: 0,
    classesChangedAcrossSnapshots: 0,
  };
  let hasMultiSnapshotEvidence = false;
  const stability = {
    trackedFromPrevious: 0,
    stable: 0,
    changed: 0,
    detached: 0,
    new: 0,
    unknown: 0,
    nodeReplacedButLogicallyStable: 0,
    ambiguous: 0,
  };
  const hitTesting = {
    tested: 0,
    fullyTargetable: 0,
    partiallyTargetable: 0,
    mostlyOccluded: 0,
    fullyOccluded: 0,
    zeroSize: 0,
    outsideViewport: 0,
    hidden: 0,
  };
  const ancestorTraversal = {
    contextualRecoveryCount: 0,
    deepTraversalCount: 0,
    maxAncestorDepthObserved: 0,
  };
  const positional = {
    positionalCount: 0,
    stableAcrossSnapshots: 0,
    changedAcrossSnapshots: 0,
  };
  const accessibility = { totalInteractive: 0, missingAccessibleName: 0 };
  let iframeTotal = 0;
  const iframeByTag = { iframe: 0, frame: 0 };
  let shadowRoots = 0;
  let shadowElements = 0;
  let maxZIndex = 0;
  let highZIndexElementCount = 0;

  for (const entry of captured) {
    const s = entry.snapshot;
    for (const report of s.elementReports) {
      elementReports.push({
        ...report,
        frameId: entry.frame.frameId,
        frameUrl: s.url,
      });
    }
    selectorAnalysis.totalAnalyzed += s.selectorAnalysis.totalAnalyzed;
    selectorAnalysis.directSuccess += s.selectorAnalysis.directSuccess;
    selectorAnalysis.recoveredByIgnore += s.selectorAnalysis.recoveredByIgnore;
    selectorAnalysis.recoveredByPartial +=
      s.selectorAnalysis.recoveredByPartial;
    selectorAnalysis.recoveredByContext +=
      s.selectorAnalysis.recoveredByContext;
    selectorAnalysis.positionalOnly += s.selectorAnalysis.positionalOnly;
    selectorAnalysis.ambiguous += s.selectorAnalysis.ambiguous;
    selectorAnalysis.wrongTarget += s.selectorAnalysis.wrongTarget;
    selectorAnalysis.notResolved += s.selectorAnalysis.notResolved;
    selectorAnalysis.inaccessible += s.selectorAnalysis.inaccessible;

    totalElements += s.counts.totalElements;
    interactiveElements += s.counts.interactiveElements;
    buttons += s.counts.buttons;
    inputs += s.counts.inputs;
    selects += s.counts.selects;
    textareas += s.counts.textareas;
    links += s.counts.links;
    forms += s.counts.forms;
    contentEditable += s.counts.contentEditable;

    meaningfulElements += s.elementUniverse.meaningfulElements;
    hiddenElements += s.elementUniverse.hiddenElements;
    inaccessibleElements += s.elementUniverse.inaccessibleElements;
    iframeUniverseElements += s.elementUniverse.iframeElements;
    shadowDomElements += s.elementUniverse.shadowDomElements;

    candidatesFound += s.analysisCoverage.candidatesFound;
    candidatesAnalyzed += s.analysisCoverage.candidatesAnalyzed;
    if (s.analysisCoverage.capped) {
      capped = true;
      if (s.analysisCoverage.capReason)
        capReasons.push(s.analysisCoverage.capReason);
    }

    dynamicAttrs.idsObserved += s.dynamicAttributes.idsObserved;
    dynamicAttrs.idsDynamicByHeuristic +=
      s.dynamicAttributes.idsDynamicByHeuristic;
    dynamicAttrs.idsChangedAcrossSnapshots +=
      s.dynamicAttributes.idsChangedAcrossSnapshots;
    dynamicAttrs.classesObserved += s.dynamicAttributes.classesObserved;
    dynamicAttrs.classesDynamicByHeuristic +=
      s.dynamicAttributes.classesDynamicByHeuristic;
    dynamicAttrs.classesChangedAcrossSnapshots +=
      s.dynamicAttributes.classesChangedAcrossSnapshots;
    hasMultiSnapshotEvidence =
      hasMultiSnapshotEvidence || s.dynamicAttributes.hasMultiSnapshotEvidence;

    stability.trackedFromPrevious += s.stability.trackedFromPrevious;
    stability.stable += s.stability.stable;
    stability.changed += s.stability.changed;
    stability.detached += s.stability.detached;
    stability.new += s.stability.new;
    stability.unknown += s.stability.unknown;
    stability.nodeReplacedButLogicallyStable +=
      s.stability.nodeReplacedButLogicallyStable;
    stability.ambiguous += s.stability.ambiguous;

    hitTesting.tested += s.hitTesting.tested;
    hitTesting.fullyTargetable += s.hitTesting.fullyTargetable;
    hitTesting.partiallyTargetable += s.hitTesting.partiallyTargetable;
    hitTesting.mostlyOccluded += s.hitTesting.mostlyOccluded;
    hitTesting.fullyOccluded += s.hitTesting.fullyOccluded;
    hitTesting.zeroSize += s.hitTesting.zeroSize;
    hitTesting.outsideViewport += s.hitTesting.outsideViewport;
    hitTesting.hidden += s.hitTesting.hidden;

    ancestorTraversal.contextualRecoveryCount +=
      s.ancestorTraversal.contextualRecoveryCount;
    ancestorTraversal.deepTraversalCount +=
      s.ancestorTraversal.deepTraversalCount;
    ancestorTraversal.maxAncestorDepthObserved = Math.max(
      ancestorTraversal.maxAncestorDepthObserved,
      s.ancestorTraversal.maxAncestorDepthObserved,
    );

    positional.positionalCount += s.positionalDependency.positionalCount;
    positional.stableAcrossSnapshots +=
      s.positionalDependency.stableAcrossSnapshots;
    positional.changedAcrossSnapshots +=
      s.positionalDependency.changedAcrossSnapshots;

    accessibility.totalInteractive += s.accessibility.totalInteractive;
    accessibility.missingAccessibleName +=
      s.accessibility.missingAccessibleName;

    iframeTotal += s.iframes.total;
    iframeByTag.iframe += s.iframes.byTag.iframe;
    iframeByTag.frame += s.iframes.byTag.frame;
    shadowRoots += s.shadowDom.roots;
    shadowElements += s.shadowDom.elements;
    maxZIndex = Math.max(maxZIndex, s.zIndex.maxZIndex);
    highZIndexElementCount += s.zIndex.highZIndexElementCount;
  }

  return {
    collectedAt:
      captured.reduce((max, f) => Math.max(max, f.snapshot.collectedAt), 0) ||
      Date.now(),
    url: topFrame?.snapshot.url ?? "",
    title: topFrame?.snapshot.title ?? "",
    counts: {
      totalElements,
      interactiveElements,
      buttons,
      inputs,
      selects,
      textareas,
      links,
      forms,
      contentEditable,
    },
    elementUniverse: {
      totalElements,
      meaningfulElements,
      interactiveElements,
      hiddenElements,
      inaccessibleElements,
      iframeElements: iframeUniverseElements,
      shadowDomElements,
    },
    elementReports,
    analysisCoverage: {
      candidatesFound,
      candidatesAnalyzed,
      capped,
      capReason: capReasons.length > 0 ? capReasons.join(" ") : null,
    },
    selectorAnalysis,
    dynamicAttributes: { ...dynamicAttrs, hasMultiSnapshotEvidence },
    stability,
    hitTesting,
    ancestorTraversal,
    positionalDependency: positional,
    accessibility,
    iframes: {
      total: iframeTotal,
      accessible: 0,
      crossOrigin: 0,
      byTag: iframeByTag,
    },
    shadowDom: { roots: shadowRoots, elements: shadowElements },
    zIndex: { maxZIndex, highZIndexElementCount },
    frame: null,
  };
}

/** Build the per-frame signature list a state-fingerprint comparison needs, straight from a capture result. */
export function toFrameSignatureEntries(
  frames: FrameCaptureResult[],
): FrameSignatureEntry[] {
  return frames.map((f) => ({
    frameId: f.frame.frameId,
    signature: f.stateSignature ?? null,
  }));
}
