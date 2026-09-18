import type { DomHealthSnapshot } from "@apty/dom-snapshot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendMessage = vi.hoisted(() => vi.fn());
const mockTabsGet = vi.hoisted(() => vi.fn());
const mockGetAllFrames = vi.hoisted(() => vi.fn());

(global as any).chrome = {
  tabs: {
    get: mockTabsGet,
    sendMessage: mockSendMessage,
  },
  webNavigation: {
    getAllFrames: mockGetAllFrames,
  },
  runtime: { lastError: undefined as { message?: string } | undefined },
};

import { runDomHealthAudit } from "./dom-health";

const TAB_ID = 42;

function snapshotFixture(
  overrides: Partial<DomHealthSnapshot> = {},
): DomHealthSnapshot {
  return {
    collectedAt: Date.now(),
    url: "https://example.com/app",
    title: "Example",
    counts: {
      totalElements: 10,
      interactiveElements: 2,
      buttons: 1,
      inputs: 1,
      selects: 0,
      textareas: 0,
      links: 0,
      forms: 0,
      contentEditable: 0,
    },
    elementUniverse: {
      totalElements: 10,
      meaningfulElements: 10,
      interactiveElements: 2,
      hiddenElements: 0,
      inaccessibleElements: 0,
      iframeElements: 0,
      shadowDomElements: 0,
    },
    elementReports: [
      {
        tagName: "button",
        classification: "interactive",
        attributes: { dataAttributes: { testid: "go" } },
        outcome: "DIRECT_SUCCESS",
        strategy: "direct",
        bestSelector: '[data-testid="go"]',
        matchCount: 1,
        ancestorDepthUsed: 0,
        usesPositionalSelector: false,
        dynamicAttributeNames: [],
        stableAttributeNames: ["data-testid"],
        winningAttribute: "data-testid",
        hasAccessibleName: true,
        hitTest: { pointsPassed: 9, classification: "fully-targetable" },
        stability: "UNKNOWN",
      },
    ],
    analysisCoverage: {
      candidatesFound: 1,
      candidatesAnalyzed: 1,
      capped: false,
      capReason: null,
    },
    selectorAnalysis: {
      totalAnalyzed: 1,
      directSuccess: 1,
      recoveredByIgnore: 0,
      recoveredByPartial: 0,
      recoveredByContext: 0,
      positionalOnly: 0,
      ambiguous: 0,
      wrongTarget: 0,
      notResolved: 0,
      inaccessible: 0,
    },
    dynamicAttributes: {
      idsObserved: 0,
      idsDynamicByHeuristic: 0,
      idsChangedAcrossSnapshots: 0,
      classesObserved: 0,
      classesDynamicByHeuristic: 0,
      classesChangedAcrossSnapshots: 0,
      hasMultiSnapshotEvidence: false,
    },
    stability: {
      trackedFromPrevious: 0,
      stable: 0,
      changed: 0,
      detached: 0,
      new: 0,
      unknown: 1,
      nodeReplacedButLogicallyStable: 0,
      ambiguous: 0,
    },
    hitTesting: {
      tested: 1,
      fullyTargetable: 1,
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
    positionalDependency: {
      positionalCount: 0,
      stableAcrossSnapshots: 0,
      changedAcrossSnapshots: 0,
    },
    accessibility: { totalInteractive: 1, missingAccessibleName: 0 },
    iframes: {
      total: 0,
      accessible: 0,
      crossOrigin: 0,
      byTag: { iframe: 0, frame: 0 },
    },
    shadowDom: { roots: 0, elements: 0 },
    zIndex: { maxZIndex: 0, highZIndexElementCount: 0 },
    ...overrides,
  };
}

function frameBundle(snapshot: DomHealthSnapshot = snapshotFixture()) {
  return {
    success: true,
    data: {
      snapshot,
      stateSignature: {
        url: snapshot.url,
        title: snapshot.title,
        headingSample: [],
        activeNavItem: null,
        containerCounts: {},
      },
    },
  };
}

/** A single-frame tab — the common case, and the case that never triggered the old broadcast race either. */
function singleFrameTree() {
  return [
    {
      frameId: 0,
      parentFrameId: -1,
      url: "https://example.com/app",
      errorOccurred: false,
      processId: 1,
      documentId: "doc-1",
      documentLifecycle: "active",
      frameType: "outermost_frame",
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  (global as any).chrome.runtime.lastError = undefined;
  mockTabsGet.mockResolvedValue({ id: TAB_ID, url: "https://example.com/app" });
  mockGetAllFrames.mockResolvedValue(singleFrameTree());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runDomHealthAudit", () => {
  it("collects three rounds over the audit window and returns a scored result", async () => {
    mockSendMessage.mockImplementation(
      (_tabId: number, _msg: unknown, _options: unknown, callback: any) => {
        callback(frameBundle());
      },
    );

    const promise = runDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(typeof result.score).toBe("number");
      expect(result.metadata.snapshotsCompared).toBe(3);
      expect(result.evidenceState).toBe("HEALTHY_EVIDENCE");
    }
    expect(mockSendMessage).toHaveBeenCalledTimes(3);
  });

  it("addresses every message at the frame's explicit frameId — never an un-addressed broadcast", async () => {
    mockGetAllFrames.mockResolvedValue([
      {
        frameId: 0,
        parentFrameId: -1,
        url: "https://example.com/shell",
        errorOccurred: false,
      },
      {
        frameId: 7,
        parentFrameId: 0,
        url: "https://example.com/work-area",
        errorOccurred: false,
      },
    ]);
    const seenFrameIds: number[] = [];
    mockSendMessage.mockImplementation(
      (
        _tabId: number,
        _msg: unknown,
        options: { frameId: number },
        callback: any,
      ) => {
        seenFrameIds.push(options.frameId);
        callback(frameBundle());
      },
    );

    const promise = runDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    await promise;

    // 2 frames x 3 rounds — every call carries an explicit frameId, and
    // both real frames (0 and 7) were addressed, not just whichever
    // happened to answer first.
    expect(seenFrameIds).toHaveLength(6);
    expect(new Set(seenFrameIds)).toEqual(new Set([0, 7]));
  });

  it("passes an increasing sequenceIndex so each frame's collector knows which round starts a fresh audit", async () => {
    const seenSequenceIndexes: number[] = [];
    mockSendMessage.mockImplementation(
      (
        _tabId: number,
        msg: { sequenceIndex: number },
        _options: unknown,
        callback: any,
      ) => {
        seenSequenceIndexes.push(msg.sequenceIndex);
        callback(frameBundle());
      },
    );

    const promise = runDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    await promise;

    expect(seenSequenceIndexes).toEqual([0, 1, 2]);
  });

  it("rejects unsupported browser-internal pages without messaging any frame", async () => {
    mockTabsGet.mockResolvedValue({ id: TAB_ID, url: "chrome://extensions" });

    const result = await runDomHealthAudit(TAB_ID);

    expect(result.available).toBe(false);
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockGetAllFrames).not.toHaveBeenCalled();
  });

  it("reports an honest error when the tab no longer exists", async () => {
    mockTabsGet.mockRejectedValue(new Error("No tab with id"));

    const result = await runDomHealthAudit(TAB_ID);

    expect(result.available).toBe(false);
  });

  it("reports an honest error when the tab's frame tree itself cannot be enumerated", async () => {
    mockGetAllFrames.mockRejectedValue(new Error("Tab closed"));

    const result = await runDomHealthAudit(TAB_ID);

    expect(result.available).toBe(false);
  });

  it("reports FAILED evidence (never available:false, never a fabricated score) when the frame never responds", async () => {
    mockSendMessage.mockImplementation(
      (_tabId: number, _msg: unknown, _options: unknown, callback: any) => {
        callback({ success: false, error: "Failed to collect a DOM snapshot" });
      },
    );

    const promise = runDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.evidenceState).toBe("FAILED");
      expect(result.score).toBeNull();
      expect(result.grade).toBe("NOT_ASSESSED");
    }
  });

  it("reports FAILED evidence when chrome.runtime.lastError fires for the only frame", async () => {
    mockSendMessage.mockImplementation(
      (_tabId: number, _msg: unknown, _options: unknown, callback: any) => {
        (global as any).chrome.runtime.lastError = {
          message: "Could not establish connection",
        };
        callback(undefined);
        (global as any).chrome.runtime.lastError = undefined;
      },
    );

    const promise = runDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.evidenceState).toBe("FAILED");
    }
  });

  it("reports FAILED evidence if the content script never responds within the frame timeout", async () => {
    mockSendMessage.mockImplementation(() => {
      // Never invokes the callback.
    });

    const promise = runDomHealthAudit(TAB_ID);
    await vi.advanceTimersByTimeAsync(30000);
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.evidenceState).toBe("FAILED");
    }
  });
});
