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
  ElementPathSample,
  ElementSelectorReport,
  FrameStateSignature,
} from "@apty/dom-snapshot";
import {
  type FrameKey,
  type FrameOwnerAttributes,
  type FrameRoleDecision,
  frameKey,
  frameRole,
  urlTemplate,
} from "./frame-identity.js";
import {
  type AuditFrame,
  type FrameAccessibilitySummary,
  getFrameTree,
  sampleFailureReasons,
  sendFrameMessage,
} from "./frame-tree.js";
import type { FrameSignatureEntry } from "./state-fingerprint.js";

export type FrameCaptureStatus =
  | "captured"
  | "failed"
  | "skipped-about-blank"
  | "skipped-navigation-error";

/** Who a frame is, independent of this page load (`frame-identity.ts`). */
export interface FrameIdentity {
  key: FrameKey;
  role: FrameRoleDecision;
  urlTemplate: string;
  owner: FrameOwnerAttributes | null;
}

export interface FrameCaptureResult {
  frame: AuditFrame;
  status: FrameCaptureStatus;
  identity: FrameIdentity;
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
  /** Rendered about:blank frames looked at again after `PLACEHOLDER_RECHECK_MS`, in case the page was about to navigate them. */
  placeholdersRechecked: number;
}

export type CaptureApplicationStateOutcome =
  | { available: true; result: CaptureStateResult }
  | { available: false; error: string };

interface FrameBundleResponse {
  snapshot: DomHealthSnapshot;
  stateSignature: FrameStateSignature;
}

/** How long a capture waits, once, for a rendered about:blank frame the page may be about to navigate (athenaOne navigates `GlobalNav` and `Status` from script after load). */
export const PLACEHOLDER_RECHECK_MS = 500;
/** About:blank frames usually answer at once, or are not worth the full timeout. */
const ABOUT_BLANK_TIMEOUT_MS = 2000;
const OWNER_TIMEOUT_MS = 2000;

type OwnerWithFrameId = FrameOwnerAttributes & { frameId: number | null };

/** Each frame's position among its siblings, from the top (`"0/2/1"`), for the positional last-resort key. */
function framePositions(frameTree: AuditFrame[]): Map<number, string> {
  const positions = new Map<number, string>([[0, "0"]]);
  const byParent = new Map<number, AuditFrame[]>();
  for (const frame of frameTree) {
    const siblings = byParent.get(frame.parentFrameId) ?? [];
    siblings.push(frame);
    byParent.set(frame.parentFrameId, siblings);
  }
  const visit = (frameId: number) => {
    const children = (byParent.get(frameId) ?? []).sort(
      (a, b) => a.frameId - b.frameId,
    );
    children.forEach((child, index) => {
      positions.set(child.frameId, `${positions.get(frameId)}/${index}`);
      visit(child.frameId);
    });
  };
  visit(0);
  return positions;
}

/**
 * Ask every frame which frame elements it owns. Only a parent can see a
 * frame element's `name`, `title` and `data-osp-id`; the responder joins
 * each element to the `frameId` it hosts.
 */
async function collectFrameOwnersByFrameId(
  tabId: number,
  frameTree: AuditFrame[],
): Promise<Map<number, FrameOwnerAttributes>> {
  const owners = new Map<number, FrameOwnerAttributes>();
  const responses = await Promise.all(
    frameTree
      .filter((frame) => !frame.errorOccurred)
      .map((frame) =>
        sendFrameMessage<OwnerWithFrameId[]>(
          tabId,
          frame.frameId,
          { request: "collect-dom-health-frame-owners" },
          OWNER_TIMEOUT_MS,
        ),
      ),
  );
  for (const response of responses) {
    if (!Array.isArray(response.data)) continue;
    for (const { frameId, ...owner } of response.data) {
      if (typeof frameId === "number") owners.set(frameId, owner);
    }
  }
  return owners;
}

function identify(
  frame: AuditFrame,
  owner: FrameOwnerAttributes | null,
  position: string,
  snapshot: DomHealthSnapshot | null,
): FrameIdentity {
  return {
    key: frameKey({ frameId: frame.frameId, url: frame.url, owner, position }),
    role: frameRole({
      frameId: frame.frameId,
      url: frame.url,
      owner,
      elementCount: snapshot ? snapshot.counts.totalElements : null,
      interactiveCount: snapshot ? snapshot.counts.interactiveElements : null,
    }),
    urlTemplate: urlTemplate(frame.url).template,
    owner,
  };
}

async function captureFrame(
  tabId: number,
  frame: AuditFrame,
  owner: FrameOwnerAttributes | null,
  position: string,
  options: CaptureStateOptions,
): Promise<FrameCaptureResult> {
  if (frame.errorOccurred) {
    return {
      frame,
      status: "skipped-navigation-error",
      identity: identify(frame, owner, position, null),
    };
  }
  const key = frameKey({
    frameId: frame.frameId,
    url: frame.url,
    owner,
    position,
  });

  // The content script cannot reliably determine its own frameId,
  // parentFrameId, depth or frame key (`chrome.webNavigation` is not
  // available inside a content script's isolated world, and only the parent
  // sees the frame element) — so THIS layer hands them down in the request.
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
        frameKey: key.key,
      },
    },
    frame.isAboutBlank
      ? Math.min(
          options.timeoutMs ?? ABOUT_BLANK_TIMEOUT_MS,
          ABOUT_BLANK_TIMEOUT_MS,
        )
      : options.timeoutMs,
  );

  const snapshot = response.success ? response.data?.snapshot : undefined;
  const identity = identify(frame, owner, position, snapshot ?? null);

  if (identity.role.role === "placeholder") {
    return { frame, status: "skipped-about-blank", identity };
  }
  if (!response.success || !response.data) {
    return {
      frame,
      status: "failed",
      identity,
      error: response.error ?? "This frame did not respond.",
    };
  }
  return {
    frame,
    status: "captured",
    identity,
    snapshot: response.data.snapshot,
    stateSignature: response.data.stateSignature,
  };
}

/**
 * A document with no form controls that holds an application frame is the
 * application's shell, not the application: the Infor OS Portal top
 * document has 0 form controls and loads LN in an iframe; athenaOne's top
 * document holds the `GlobalWrapper` frame. Scoring such a frame as the
 * application produced "no form controls" findings on a page full of them
 * (defect D-7).
 */
export function classifyShellFrames(
  frames: FrameCaptureResult[],
): FrameCaptureResult[] {
  return frames.map((entry) => {
    if (
      entry.status !== "captured" ||
      entry.identity.role.role !== "application"
    ) {
      return entry;
    }
    const counts = entry.snapshot?.counts;
    const formControls = counts
      ? counts.inputs + counts.selects + counts.textareas
      : 0;
    if (formControls > 0) return entry;
    const appChild = frames.find(
      (child) =>
        child.frame.parentFrameId === entry.frame.frameId &&
        child.identity.role.role === "application" &&
        child.identity.owner?.rendered !== false,
    );
    if (!appChild) return entry;
    return {
      ...entry,
      identity: {
        ...entry.identity,
        role: {
          role: "chrome",
          reason: `Shell document: no form controls, and the application is in child frame "${appChild.identity.key.key}".`,
        },
      },
    };
  });
}

/**
 * Capture one point-in-time snapshot of every reachable frame in the tab.
 * Never throws — a frame the browser reports as errored, a frame that
 * never answers, or an empty about:blank placeholder is recorded with an
 * explicit status and role rather than silently dropped or treated as an
 * empty application. An about:blank frame is still read (a page can write
 * into one from script); only when it is empty is it a placeholder, and a
 * rendered placeholder is looked at again once, after
 * `PLACEHOLDER_RECHECK_MS`, in case the page was about to navigate it.
 */
export async function captureApplicationState(
  tabId: number,
  options: CaptureStateOptions,
): Promise<CaptureApplicationStateOutcome> {
  let frameTree = await getFrameTree(tabId);
  if (!frameTree) {
    return {
      available: false,
      error: "Could not enumerate this tab's frames — it may have been closed.",
    };
  }

  let owners = await collectFrameOwnersByFrameId(tabId, frameTree);
  let positions = framePositions(frameTree);
  let frames: FrameCaptureResult[] = await Promise.all(
    frameTree.map((frame) =>
      captureFrame(
        tabId,
        frame,
        owners.get(frame.frameId) ?? null,
        positions.get(frame.frameId) ?? String(frame.frameId),
        options,
      ),
    ),
  );

  const waiting = frames.filter(
    (f) =>
      f.identity.role.role === "placeholder" &&
      f.identity.owner?.rendered !== false,
  );
  if (waiting.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, PLACEHOLDER_RECHECK_MS));
    const refreshed = await getFrameTree(tabId);
    if (refreshed) {
      frameTree = refreshed;
      owners = await collectFrameOwnersByFrameId(tabId, frameTree);
      positions = framePositions(frameTree);
      const byId = new Map(refreshed.map((frame) => [frame.frameId, frame]));
      frames = await Promise.all(
        frames.map(async (entry) => {
          const now = byId.get(entry.frame.frameId);
          if (!waiting.includes(entry) || !now || now.isAboutBlank)
            return entry;
          return captureFrame(
            tabId,
            now,
            owners.get(now.frameId) ?? null,
            positions.get(now.frameId) ?? String(now.frameId),
            options,
          );
        }),
      );
    }
  }
  frames = classifyShellFrames(frames);

  const framesAccessible = frames.filter((f) => f.status === "captured").length;
  const failedFrames = frames.filter(
    (f) => f.status === "failed" || f.status === "skipped-navigation-error",
  );

  const frameAccessibility: FrameAccessibilitySummary = {
    framesTotal: frameTree.length,
    framesAccessible,
    framesFailed: failedFrames.length,
    // This layer has no additional "reached, but blocked inside" signal
    // beyond a captured/failed split — a frame either answered with a real
    // snapshot or it did not. Reserved for a future signal (e.g. "entirely
    // closed-shadow-DOM content"), never fabricated here.
    framesInaccessible: 0,
    sampleFailureReasons: sampleFailureReasons(
      failedFrames.map((f) => f.error),
    ),
  };

  return {
    available: true,
    result: {
      frameTree,
      frames,
      frameAccessibility,
      placeholdersRechecked: waiting.length,
    },
  };
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
/** Overall cap on `elementPathSamples` after merging across every frame — bounds the cross-application-state replay payload size regardless of how many frames a page has. */
const MAX_AGGREGATED_ELEMENT_PATH_SAMPLES = 50;

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
  const elementPathSamples: ElementPathSample[] = [];
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
        frameKey: entry.identity.key.key,
        frameRole: entry.identity.role.role,
      });
    }
    for (const sample of s.elementPathSamples ?? []) {
      if (elementPathSamples.length >= MAX_AGGREGATED_ELEMENT_PATH_SAMPLES) {
        break;
      }
      elementPathSamples.push({ ...sample, frameId: entry.frame.frameId });
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
    stability.directStable += s.stability.directStable;
    stability.recoveredStable += s.stability.recoveredStable;
    stability.positionalStable += s.stability.positionalStable;
    stability.wrongTarget += s.stability.wrongTarget;
    stability.notResolved += s.stability.notResolved;
    stability.detached += s.stability.detached;
    stability.new += s.stability.new;
    stability.unknown += s.stability.unknown;
    stability.nodeReplacedButLogicallyStable +=
      s.stability.nodeReplacedButLogicallyStable;
    stability.ambiguous += s.stability.ambiguous;
    stability.inaccessible += s.stability.inaccessible;

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
    elementPathSamples,
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

/** One frame as the report lists it: identity, role and capture status, never silently dropped. */
export interface FrameInventoryEntry {
  frameId: number;
  parentFrameId: number;
  key: string;
  keySource: FrameKey["source"];
  keyStable: boolean;
  role: FrameRoleDecision["role"];
  roleReason: string;
  urlTemplate: string;
  status: FrameCaptureStatus;
  error?: string;
}

export function toFrameInventory(
  frames: FrameCaptureResult[],
): FrameInventoryEntry[] {
  return frames.map((f) => ({
    frameId: f.frame.frameId,
    parentFrameId: f.frame.parentFrameId,
    key: f.identity.key.key,
    keySource: f.identity.key.source,
    keyStable: f.identity.key.stable,
    role: f.identity.role.role,
    roleReason: f.identity.role.reason,
    urlTemplate: f.identity.urlTemplate,
    status: f.status,
    ...(f.error ? { error: f.error } : {}),
  }));
}

/** Build the per-frame signature list a state-fingerprint comparison needs, straight from a capture result. */
export function toFrameSignatureEntries(
  frames: FrameCaptureResult[],
): FrameSignatureEntry[] {
  return frames.map((f) => ({
    frameId: f.frame.frameId,
    frameKey: f.identity.key.key,
    signature: f.stateSignature ?? null,
  }));
}
