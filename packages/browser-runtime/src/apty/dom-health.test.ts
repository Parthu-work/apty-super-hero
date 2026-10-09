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

function bundleRequests() {
  return mockSendMessage.mock.calls.filter(
    ([, msg]) => msg?.request === "collect-dom-health-frame-bundle",
  );
}

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
      directStable: 0,
      recoveredStable: 0,
      positionalStable: 0,
      wrongTarget: 0,
      notResolved: 0,
      detached: 0,
      new: 0,
      unknown: 1,
      nodeReplacedButLogicallyStable: 0,
      ambiguous: 0,
      inaccessible: 0,
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
        navTrail: [],
        primaryHeading: null,
        structureHash: "",
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
    expect(bundleRequests()).toHaveLength(3);
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
        msg: { request: string },
        options: { frameId: number },
        callback: any,
      ) => {
        if (msg.request === "collect-dom-health-frame-bundle") {
          seenFrameIds.push(options.frameId);
        }
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
        msg: { request: string; sequenceIndex: number },
        _options: unknown,
        callback: any,
      ) => {
        if (msg.request === "collect-dom-health-frame-bundle") {
          seenSequenceIndexes.push(msg.sequenceIndex);
        }
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
      // The actual chrome.runtime.lastError message must reach the
      // evidence text end to end (frame-tree -> frame-audit ->
      // dom-health-scoring), not just a bare "none responded" count.
      expect(result.risks[0]?.evidence).toContain(
        "Could not establish connection",
      );
    }
  });

  it("reports FAILED evidence if the content script never responds within the frame timeout", async () => {
    mockSendMessage.mockImplementation(() => {
      // Never invokes the callback.
    });

    const promise = runDomHealthAudit(TAB_ID);
    await vi.advanceTimersByTimeAsync(40000);
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.evidenceState).toBe("FAILED");
    }
  });

  it("never returns a page title, practice id, tenant, session or token-valued attribute unredacted", async () => {
    const leaky = snapshotFixture({
      url: "https://ehr.example.test/4242424/2/globalframeset.esp?inforTenantId=FAKETENANT000000_TRN&inforSessionId=FAKETENANT000000_TRN~00000000-0000-4000-8000-000000000000",
      title:
        "PREVIEW: exampleCollector v1.0 TX - Example Practice - Texas [4242424] | EXAMPLE CLINIC [1]",
      elementPathSamples: [
        {
          fingerprint: "button|data-auth-token",
          path: [
            {
              tag: "button",
              attributes: [
                { name: "data-auth-token", value: "fake-secret-0001" },
              ],
              classes: [],
              pseudo: [],
            },
          ],
          tagName: "button",
          selector: '[data-auth-token="fake-secret-0001"]',
          outcome: "DIRECT_SUCCESS",
        },
      ],
    });
    leaky.elementReports[0]!.attributes.dataAttributes = {
      "osp-id": "LN",
      token: "pubFAKE0000000000000000000000000000",
    };
    leaky.elementReports[0]!.bestSelector = '[data-session-id="sess-123456"]';
    mockTabsGet.mockResolvedValue({ id: TAB_ID, url: leaky.url });
    mockSendMessage.mockImplementation(
      (_tabId: number, _msg: unknown, _options: unknown, callback: any) => {
        callback(frameBundle(leaky));
      },
    );

    const promise = runDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (!result.available) return;
    const serialized = JSON.stringify(result);
    for (const leak of [
      "4242424",
      "FAKETENANT000000_TRN",
      "Example Practice",
      "fake-secret-0001",
      "pubFAKE",
      "sess-123456",
    ]) {
      expect(serialized).not.toContain(leak);
    }
    expect(result.pageTitle).toBe("<REDACTED-TITLE>");
    expect(result.elementSamples[0]?.attributes.dataAttributes["osp-id"]).toBe(
      "LN",
    );
    expect(typeof result.score).toBe("number");
  });
});

describe("scoring by frame role (WP-7)", () => {
  const PORTAL_URL = "https://portal.example.test/";
  const LN_URL =
    "https://eln.example.test/webui/servlet/fslogin?LogicalId=lid://infor.ln.ln01&inforTenantId=FAKETENANT000000_TRN";

  function frame(frameId: number, parentFrameId: number, url: string) {
    return {
      frameId,
      parentFrameId,
      url,
      errorOccurred: false,
      processId: 1,
      documentId: `doc-${frameId}`,
      documentLifecycle: "active",
      frameType: frameId === 0 ? "outermost_frame" : "sub_frame",
    };
  }

  /** The Infor OS Portal shape: a top document with only the portal's own controls (no form controls), holding the LN frame. */
  function portalSnapshot() {
    const masthead = snapshotFixture().elementReports[0]!;
    return snapshotFixture({
      url: PORTAL_URL,
      counts: {
        ...snapshotFixture().counts,
        inputs: 0,
        interactiveElements: 3,
      },
      elementReports: [masthead, masthead, masthead],
      selectorAnalysis: {
        ...snapshotFixture().selectorAnalysis,
        totalAnalyzed: 3,
        directSuccess: 3,
      },
    });
  }

  function serveFrames(
    frames: Array<ReturnType<typeof frame>>,
    bundles: Record<number, DomHealthSnapshot | null>,
  ) {
    mockTabsGet.mockResolvedValue({ id: TAB_ID, url: PORTAL_URL });
    mockGetAllFrames.mockResolvedValue(frames);
    mockSendMessage.mockImplementation(
      (
        _tabId: number,
        msg: { request: string },
        options: { frameId: number },
        callback: any,
      ) => {
        if (msg.request === "collect-dom-health-frame-owners") {
          callback({
            success: true,
            data:
              options.frameId === 0
                ? [
                    {
                      frameId: 5,
                      tagName: "iframe",
                      name: "LN_44_11111111-2222-4333-8444-555555555555",
                      id: null,
                      title: "LN",
                      ospId: "LN",
                      srcAttribute: LN_URL,
                      className: null,
                      rendered: true,
                      ignoredBy: null,
                    },
                  ]
                : [],
          });
          return;
        }
        const snapshot = bundles[options.frameId];
        if (!snapshot) {
          callback({ success: false, error: "frame did not respond" });
          return;
        }
        callback(frameBundle(snapshot));
      },
    );
  }

  async function audit() {
    const promise = runDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    const result = await promise;
    if (!result.available) throw new Error(result.error);
    return result;
  }

  it("scores the LN application frame, not the portal shell around it", async () => {
    serveFrames([frame(0, -1, PORTAL_URL), frame(5, 0, LN_URL)], {
      0: portalSnapshot(),
      5: snapshotFixture({ url: LN_URL }),
    });

    const result = await audit();

    expect(result.coverage.elementsAnalyzed).toBe(1);
    expect(result.frames).toEqual([
      expect.objectContaining({ key: "top", role: "chrome" }),
      expect.objectContaining({
        key: "LN",
        role: "application",
        score: expect.any(Number),
      }),
    ]);
    expect(result.frames[0]).not.toHaveProperty("score");
  });

  it("says so loudly, with no score, when the application frame could not be read and only the shell was", async () => {
    serveFrames([frame(0, -1, PORTAL_URL), frame(5, 0, LN_URL)], {
      0: portalSnapshot(),
      5: null,
    });

    const result = await audit();

    expect(result.score).toBeNull();
    expect(result.confidence).toBe("LOW");
    expect(result.risks[0]?.id).toBe("application-frame-not-inspected");
    expect(result.confidenceCaps).toContain(
      "No application frame could be inspected (LN); only the frames around it were.",
    );
  });

  it("caps confidence when most frames could not be inspected", async () => {
    serveFrames(
      [
        frame(0, -1, "https://example.com/app"),
        frame(1, 0, "https://widgets.example.test/a"),
        frame(2, 0, "https://widgets.example.test/b"),
      ],
      { 0: snapshotFixture(), 1: null, 2: null },
    );

    const result = await audit();

    expect(result.confidence).toBe("LOW");
    expect(result.confidenceCaps).toContain(
      "2 of 3 frames could not be inspected.",
    );
  });

  it("reports duplicated ids as a finding, with the counts", async () => {
    serveFrames([frame(0, -1, "https://example.com/app")], {
      0: snapshotFixture({
        duplicateIds: {
          valuesDuplicatedWithinARoot: 9,
          valuesDuplicatedPageWide: 15,
          elementsWithDuplicatedId: 19,
          sampleValues: ["icon-logo"],
        },
      }),
    });

    const result = await audit();

    const finding = result.risks.find((r) => r.id === "duplicate-ids");
    expect(finding?.evidence).toContain("9 id value(s)");
    expect(finding?.evidence).toContain("15 across the page");
    expect(result.duplicateIds.elementsWithDuplicatedId).toBe(19);
  });
});
