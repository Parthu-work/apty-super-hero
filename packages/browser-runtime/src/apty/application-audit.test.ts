import type { DomHealthSnapshot } from "@apty/dom-snapshot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockTabsGet = vi.hoisted(() => vi.fn());
const mockTabsUpdate = vi.hoisted(() => vi.fn());
const mockSendMessage = vi.hoisted(() => vi.fn());
const mockGetAllFrames = vi.hoisted(() => vi.fn());
const onUpdatedListeners = vi.hoisted(
  () => [] as Array<(id: number, info: { status?: string }) => void>,
);

let currentUrl = "https://app.example.com/home";
const linksByUrl = new Map<string, unknown[]>();
const candidatesByUrl = new Map<string, unknown[]>();

(global as any).chrome = {
  tabs: {
    get: mockTabsGet,
    update: mockTabsUpdate,
    sendMessage: mockSendMessage,
    onUpdated: {
      addListener: (fn: (id: number, info: { status?: string }) => void) => {
        onUpdatedListeners.push(fn);
      },
      removeListener: (fn: (id: number, info: { status?: string }) => void) => {
        const i = onUpdatedListeners.indexOf(fn);
        if (i >= 0) onUpdatedListeners.splice(i, 1);
      },
    },
  },
  webNavigation: {
    getAllFrames: mockGetAllFrames,
  },
  runtime: { lastError: undefined as { message?: string } | undefined },
};

import { runApplicationDomHealthAudit } from "./application-audit";

const SEED_REF = {
  version: 1,
  hostChain: [],
  path: [],
  frameKey: "",
};

const TAB_ID = 7;

function snapshotFixture(url: string): DomHealthSnapshot {
  return {
    collectedAt: Date.now(),
    url,
    title: `Title for ${url}`,
    counts: {
      totalElements: 10,
      interactiveElements: 1,
      buttons: 1,
      inputs: 0,
      selects: 0,
      textareas: 0,
      links: 0,
      forms: 0,
      contentEditable: 0,
    },
    elementUniverse: {
      totalElements: 10,
      meaningfulElements: 10,
      interactiveElements: 1,
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
  };
}

function stateSignatureFixture(url: string) {
  return {
    url,
    title: `Title for ${url}`,
    headingSample: [],
    activeNavItem: null,
    containerCounts: {},
  };
}

function setupSendMessageMock() {
  mockSendMessage.mockImplementation(
    (
      _tabId: number,
      msg: { request: string },
      _options: unknown,
      callback: any,
    ) => {
      if (msg.request === "collect-dom-health-frame-bundle") {
        callback({
          success: true,
          data: {
            snapshot: snapshotFixture(currentUrl),
            stateSignature: stateSignatureFixture(currentUrl),
          },
        });
        return;
      }
      if (msg.request === "wait-for-dom-stable") {
        callback({ success: true, data: { settled: true, elapsedMs: 0 } });
        return;
      }
      if (msg.request === "collect-dom-health-links") {
        callback({ success: true, data: linksByUrl.get(currentUrl) ?? [] });
        return;
      }
      if (msg.request === "collect-dom-health-safe-navigation-candidates") {
        callback({
          success: true,
          data: candidatesByUrl.get(currentUrl) ?? [],
        });
        return;
      }
      if (msg.request === "get-dom-health-navigation-model") {
        callback({
          success: true,
          data: { usesHistoryApiRouting: false, historyApiCallCount: 0 },
        });
        return;
      }
      if (msg.request === "replay-dom-health-element-paths") {
        callback({ success: true, data: [] });
        return;
      }
      callback({ success: false, error: "unhandled message in test" });
    },
  );
}

function link(
  overrides: Partial<{
    href: string;
    absoluteUrl: string;
    sameOrigin: boolean;
    text: string;
    looksDestructive: boolean;
    destructiveReason: string | null;
  }>,
) {
  return {
    href: overrides.absoluteUrl ?? "/",
    absoluteUrl: "https://app.example.com/",
    sameOrigin: true,
    text: "",
    looksDestructive: false,
    destructiveReason: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  onUpdatedListeners.length = 0;
  linksByUrl.clear();
  candidatesByUrl.clear();
  currentUrl = "https://app.example.com/home";
  (global as any).chrome.runtime.lastError = undefined;
  mockTabsGet.mockImplementation(async () => ({ id: TAB_ID, url: currentUrl }));
  mockTabsUpdate.mockImplementation(
    async (_tabId: number, updateInfo: { url?: string }) => {
      if (updateInfo.url) currentUrl = updateInfo.url;
      queueMicrotask(() => {
        for (const listener of [...onUpdatedListeners]) {
          listener(TAB_ID, { status: "complete" });
        }
      });
      return {};
    },
  );
  mockGetAllFrames.mockImplementation(async () => [
    { frameId: 0, parentFrameId: -1, url: currentUrl, errorOccurred: false },
  ]);
  setupSendMessageMock();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runApplicationDomHealthAudit", () => {
  it("audits only the seed page and reports scope 'page' when it has no discoverable links", async () => {
    const promise = runApplicationDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.scope).toBe("page");
      expect(result.coverage.pagesDiscovered).toBe(1);
      expect(result.coverage.pagesAudited).toBe(1);
      expect(result.pages[0]?.status).toBe("completed");
      expect(result.coverage.coverageLabel).toBe("OBSERVED_COVERAGE");
    }
  });

  it("discovers and navigates to a same-origin link, reporting scope 'application'", async () => {
    linksByUrl.set("https://app.example.com/home", [
      link({ absoluteUrl: "https://app.example.com/orders" }),
    ]);

    const promise = runApplicationDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.scope).toBe("application");
      expect(result.coverage.pagesAudited).toBe(2);
      expect(mockTabsUpdate).toHaveBeenCalledWith(
        TAB_ID,
        expect.objectContaining({ url: "https://app.example.com/orders" }),
      );
    }
  });

  it.each([
    {
      name: "a recovered element",
      answer: { verdict: "RECOVERED_STABLE" },
      evidence: { recoveredStable: 1 },
    },
    {
      name: "a shadow host that broke on the way down",
      answer: {
        verdict: "HOST_NOT_RESOLVED",
        brokenAtHop: 1,
        hostSelector: 'ids-menu-button[id="ids-theme-switcher"]',
      },
      evidence: {
        notResolved: 1,
        hostChainBroken: 1,
        hostChainBreaks: [
          {
            frameId: 0,
            hop: 1,
            hostSelector: 'ids-menu-button[id="ids-theme-switcher"]',
          },
        ],
      },
    },
  ])("replays the seed state's ElementRef samples against every other discovered state (spec section 7) and aggregates $name as crossStateEvidence", async ({
    answer,
    evidence,
  }) => {
    linksByUrl.set("https://app.example.com/home", [
      link({ absoluteUrl: "https://app.example.com/orders" }),
    ]);

    let replayCallCount = 0;
    const replayedSamples: unknown[] = [];
    const originalImpl = mockSendMessage.getMockImplementation()!;
    mockSendMessage.mockImplementation((tabId, msg: any, options, callback) => {
      if (msg.request === "collect-dom-health-frame-bundle") {
        // Only the SEED snapshot carries a captured path sample — a
        // realistic shape, since only the seed's samples get replayed.
        const snapshot = {
          ...snapshotFixture(currentUrl),
          elementPathSamples:
            currentUrl === "https://app.example.com/home"
              ? [
                  {
                    fingerprint: "fp-save-button",
                    ref: SEED_REF,
                    tagName: "button",
                    selector: "#save",
                    outcome: "DIRECT_SUCCESS",
                  },
                ]
              : [],
        };
        callback({
          success: true,
          data: {
            snapshot,
            stateSignature: stateSignatureFixture(currentUrl),
          },
        });
        return;
      }
      if (msg.request === "replay-dom-health-element-paths") {
        replayCallCount++;
        replayedSamples.push(...msg.samples);
        callback({
          success: true,
          data: msg.samples.map((s: { fingerprint: string }) => ({
            fingerprint: s.fingerprint,
            ...answer,
          })),
        });
        return;
      }
      originalImpl(tabId, msg, options, callback);
    });

    const promise = runApplicationDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (!result.available) return;

    expect(result.coverage.pagesAudited).toBe(2);
    // Replayed once against the second (non-seed) state, never against the
    // seed state itself.
    expect(replayCallCount).toBe(1);
    expect(replayedSamples).toEqual([
      { fingerprint: "fp-save-button", ref: SEED_REF },
    ]);
    expect(result.crossStateEvidence).toEqual({
      attempted: 1,
      directStable: 0,
      recoveredStable: 0,
      positionalStable: 0,
      wrongTarget: 0,
      notResolved: 0,
      hostChainBroken: 0,
      hostChainBreaks: [],
      legacySamples: 0,
      statesTested: 1,
      ...evidence,
    });
  });

  it('discoveryMode "page" never navigates away or discovers further links/candidates, even when some exist', async () => {
    linksByUrl.set("https://app.example.com/home", [
      link({ absoluteUrl: "https://app.example.com/orders" }),
    ]);
    candidatesByUrl.set("https://app.example.com/home", [
      {
        domPath: "nav:nth-of-type(1) > div:nth-of-type(1)",
        role: "menuitem",
        tagName: "div",
        text: "Customers",
        looksDestructive: false,
        destructiveReason: null,
      },
    ]);

    const promise = runApplicationDomHealthAudit(TAB_ID, {
      discoveryMode: "page",
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.scope).toBe("page");
      expect(result.coverage.pagesDiscovered).toBe(1);
      expect(result.coverage.pagesAudited).toBe(1);
      expect(result.coverage.discoveryMethod).toBe("single-page-only");
    }
    expect(mockTabsUpdate).not.toHaveBeenCalled();
  });

  it("never navigates to a cross-origin link and records it as skipped", async () => {
    linksByUrl.set("https://app.example.com/home", [
      link({
        absoluteUrl: "https://evil.example.com/phish",
        sameOrigin: false,
      }),
    ]);

    const promise = runApplicationDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.coverage.pagesAudited).toBe(1);
      const skipped = result.pages.find(
        (p) => p.url === "https://evil.example.com/phish",
      );
      expect(skipped?.status).toBe("skipped-cross-origin");
    }
    expect(mockTabsUpdate).not.toHaveBeenCalledWith(
      TAB_ID,
      expect.objectContaining({ url: "https://evil.example.com/phish" }),
    );
  });

  it("never navigates to a link that looks destructive, even if same-origin", async () => {
    linksByUrl.set("https://app.example.com/home", [
      link({
        absoluteUrl: "https://app.example.com/orders/1/delete",
        looksDestructive: true,
        destructiveReason: "delete",
      }),
    ]);

    const promise = runApplicationDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      const skipped = result.pages.find((p) => p.url.includes("delete"));
      expect(skipped?.status).toBe("skipped-unsafe");
    }
    expect(mockTabsUpdate).not.toHaveBeenCalledWith(
      TAB_ID,
      expect.objectContaining({
        url: "https://app.example.com/orders/1/delete",
      }),
    );
  });

  it("does not re-visit the same URL twice when a page links back to itself", async () => {
    linksByUrl.set("https://app.example.com/home", [
      link({ absoluteUrl: "https://app.example.com/home" }),
    ]);

    const promise = runApplicationDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.coverage.pagesAudited).toBe(1);
      expect(result.pages).toHaveLength(1);
      expect(mockTabsUpdate).not.toHaveBeenCalled();
    }
  });

  it("respects the maxPages hard limit", async () => {
    linksByUrl.set("https://app.example.com/home", [
      link({ absoluteUrl: "https://app.example.com/a" }),
      link({ absoluteUrl: "https://app.example.com/b" }),
      link({ absoluteUrl: "https://app.example.com/c" }),
    ]);

    const promise = runApplicationDomHealthAudit(TAB_ID, { maxPages: 2 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.coverage.pagesAudited).toBe(2);
    }
  });

  it("rejects unsupported browser-internal pages without attempting to audit", async () => {
    currentUrl = "chrome://extensions";
    mockTabsGet.mockResolvedValue({ id: TAB_ID, url: "chrome://extensions" });

    const result = await runApplicationDomHealthAudit(TAB_ID);

    expect(result.available).toBe(false);
    expect(mockTabsUpdate).not.toHaveBeenCalled();
  });

  it("records a failed page without aborting the whole audit", async () => {
    linksByUrl.set("https://app.example.com/home", [
      link({ absoluteUrl: "https://app.example.com/broken" }),
    ]);
    mockTabsUpdate.mockImplementation(
      async (_tabId: number, updateInfo: { url?: string }) => {
        if (updateInfo.url === "https://app.example.com/broken") {
          throw new Error("Navigation failed");
        }
        if (updateInfo.url) currentUrl = updateInfo.url;
        queueMicrotask(() => {
          for (const listener of [...onUpdatedListeners]) {
            listener(TAB_ID, { status: "complete" });
          }
        });
        return {};
      },
    );

    const promise = runApplicationDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.coverage.pagesFailed).toBe(1);
      expect(result.coverage.pagesAudited).toBe(1);
    }
  });
});

describe("runApplicationDomHealthAudit — frame-addressed discovery (RC-1/RC-4)", () => {
  it("discovers same-origin links from a NON-top frame (a menu frame separate from the content frame)", async () => {
    mockGetAllFrames.mockResolvedValue([
      {
        frameId: 0,
        parentFrameId: -1,
        url: "https://app.example.com/home",
        errorOccurred: false,
      },
      {
        frameId: 3,
        parentFrameId: 0,
        url: "https://app.example.com/menu",
        errorOccurred: false,
      },
    ]);
    mockSendMessage.mockImplementation(
      (
        _tabId: number,
        msg: { request: string },
        options: { frameId: number },
        callback: any,
      ) => {
        if (msg.request === "collect-dom-health-frame-bundle") {
          callback({
            success: true,
            data: {
              snapshot: snapshotFixture(currentUrl),
              stateSignature: stateSignatureFixture(currentUrl),
            },
          });
          return;
        }
        if (msg.request === "wait-for-dom-stable") {
          callback({ success: true, data: { settled: true, elapsedMs: 0 } });
          return;
        }
        if (msg.request === "collect-dom-health-links") {
          // Only the MENU frame (3) has the navigation link — the top
          // frame (0) is a bare shell with none, exactly the shape that
          // defeated top-frame-only discovery before this fix.
          if (options.frameId === 3) {
            callback({
              success: true,
              data: [link({ absoluteUrl: "https://app.example.com/orders" })],
            });
          } else {
            callback({ success: true, data: [] });
          }
          return;
        }
        if (msg.request === "collect-dom-health-safe-navigation-candidates") {
          callback({ success: true, data: [] });
          return;
        }
        if (msg.request === "get-dom-health-navigation-model") {
          callback({
            success: true,
            data: { usesHistoryApiRouting: false, historyApiCallCount: 0 },
          });
          return;
        }
        callback({ success: false, error: "unhandled message in test" });
      },
    );

    const promise = runApplicationDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.scope).toBe("application");
      expect(mockTabsUpdate).toHaveBeenCalledWith(
        TAB_ID,
        expect.objectContaining({ url: "https://app.example.com/orders" }),
      );
    }
  });
});

describe("runApplicationDomHealthAudit — non-anchor navigation controls (RC-4/RC-5)", () => {
  it("reports a detected menu/tab control as not-discovered by default — never clicks it", async () => {
    candidatesByUrl.set("https://app.example.com/home", [
      {
        domPath: "nav:nth-of-type(1) > div:nth-of-type(1)",
        role: "menuitem",
        tagName: "div",
        text: "Customers",
        looksDestructive: false,
        destructiveReason: null,
      },
    ]);

    const promise = runApplicationDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.coverage.pagesNotDiscovered).toBe(1);
      expect(result.pages.some((p) => p.status === "not-discovered")).toBe(
        true,
      );
      expect(result.coverage.discoveryMethod).toBe("anchor-links");
    }
    // The click-dispatch message is never sent unless discoveryMode "application-deep" is set.
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      TAB_ID,
      expect.objectContaining({ request: "click-safe-navigation-candidate" }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('discovers a same-URL state via a click when discoveryMode "application-deep" is explicitly requested', async () => {
    candidatesByUrl.set("https://app.example.com/home", [
      {
        domPath: "nav:nth-of-type(1) > div:nth-of-type(1)",
        role: "menuitem",
        tagName: "div",
        text: "Customers",
        looksDestructive: false,
        destructiveReason: null,
      },
    ]);
    let clicked = false;
    mockSendMessage.mockImplementation(
      (
        _tabId: number,
        msg: { request: string },
        _options: unknown,
        callback: any,
      ) => {
        if (msg.request === "click-safe-navigation-candidate") {
          clicked = true;
          callback({ success: true, data: { clicked: true } });
          return;
        }
        if (msg.request === "collect-dom-health-frame-bundle") {
          // After the click, the "page" (menu item selected + heading)
          // changes even though the URL never does.
          const snapshot = snapshotFixture(currentUrl);
          const signature = clicked
            ? {
                ...stateSignatureFixture(currentUrl),
                activeNavItem: "Customers",
                headingSample: ["Customer Overview"],
              }
            : stateSignatureFixture(currentUrl);
          callback({
            success: true,
            data: { snapshot, stateSignature: signature },
          });
          return;
        }
        if (msg.request === "wait-for-dom-stable") {
          callback({ success: true, data: { settled: true, elapsedMs: 0 } });
          return;
        }
        if (msg.request === "collect-dom-health-links") {
          callback({ success: true, data: [] });
          return;
        }
        if (msg.request === "collect-dom-health-safe-navigation-candidates") {
          callback({
            success: true,
            data: clicked ? [] : (candidatesByUrl.get(currentUrl) ?? []),
          });
          return;
        }
        if (msg.request === "get-dom-health-navigation-model") {
          callback({
            success: true,
            data: { usesHistoryApiRouting: false, historyApiCallCount: 0 },
          });
          return;
        }
        callback({ success: false, error: "unhandled message in test" });
      },
    );

    const promise = runApplicationDomHealthAudit(TAB_ID, {
      discoveryMode: "application-deep",
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.coverage.pagesAudited).toBe(2);
      expect(result.coverage.discoveryMethod).toBe(
        "anchor-links+navigation-controls",
      );
      const clickState = result.pages.find(
        (p) =>
          p.discoverySource === "safe-navigation-control" &&
          p.status === "completed",
      );
      expect(clickState).toBeDefined();
      expect(clickState?.transitionReason).toContain("Customers");
      // The URL never changed — this state was only distinguishable by its
      // structural fingerprint, exactly the LN-shaped case RC-5 targets.
      expect(clickState?.url).toBe("https://app.example.com/home");
    }
  });

  it("reports not-discovered (never a fabricated state) when a click produces no real change", async () => {
    candidatesByUrl.set("https://app.example.com/home", [
      {
        domPath: "nav:nth-of-type(1) > div:nth-of-type(1)",
        role: "menuitem",
        tagName: "div",
        text: "Dead End",
        looksDestructive: false,
        destructiveReason: null,
      },
    ]);
    mockSendMessage.mockImplementation(
      (
        _tabId: number,
        msg: { request: string },
        _options: unknown,
        callback: any,
      ) => {
        if (msg.request === "click-safe-navigation-candidate") {
          callback({ success: true, data: { clicked: true } });
          return;
        }
        if (msg.request === "collect-dom-health-frame-bundle") {
          callback({
            success: true,
            data: {
              snapshot: snapshotFixture(currentUrl),
              stateSignature: stateSignatureFixture(currentUrl),
            },
          });
          return;
        }
        if (msg.request === "wait-for-dom-stable") {
          callback({ success: true, data: { settled: true, elapsedMs: 0 } });
          return;
        }
        if (msg.request === "collect-dom-health-links") {
          callback({ success: true, data: [] });
          return;
        }
        if (msg.request === "collect-dom-health-safe-navigation-candidates") {
          callback({
            success: true,
            data: candidatesByUrl.get(currentUrl) ?? [],
          });
          return;
        }
        if (msg.request === "get-dom-health-navigation-model") {
          callback({
            success: true,
            data: { usesHistoryApiRouting: false, historyApiCallCount: 0 },
          });
          return;
        }
        callback({ success: false, error: "unhandled message in test" });
      },
    );

    const promise = runApplicationDomHealthAudit(TAB_ID, {
      discoveryMode: "application-deep",
      maxPages: 3,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      // Only the seed page audited — the click never produced a different
      // fingerprint, so it must be reported not-discovered, never audited
      // as if it were a real second state.
      expect(result.coverage.pagesAudited).toBe(1);
      expect(
        result.pages.some(
          (p) =>
            p.status === "not-discovered" &&
            p.discoverySource === "safe-navigation-control",
        ),
      ).toBe(true);
    }
  });

  it('never sends a click message for a candidate flagged destructive, even with discoveryMode "application-deep"', async () => {
    candidatesByUrl.set("https://app.example.com/home", [
      {
        domPath: "nav:nth-of-type(1) > div:nth-of-type(1)",
        role: "menuitem",
        tagName: "div",
        text: "Delete account",
        looksDestructive: true,
        destructiveReason: "delete",
      },
    ]);

    const promise = runApplicationDomHealthAudit(TAB_ID, {
      discoveryMode: "application-deep",
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      TAB_ID,
      expect.objectContaining({ request: "click-safe-navigation-candidate" }),
      expect.anything(),
      expect.anything(),
    );
    if (result.available) {
      const skipped = result.pages.find((p) => p.title === "Delete account");
      expect(skipped?.status).toBe("skipped-unsafe");
    }
  });
});

describe("runApplicationDomHealthAudit — state graph + backtracking (RC-6, the Infor-LN-shaped critical fixture)", () => {
  /**
   * A same-URL, menu-driven application: the URL NEVER changes, but four
   * distinct application states exist, reachable only via clicks:
   *
   *   A (seed)
   *    +-- click "Menu 1" --> B
   *    |                       +-- click "Submenu 1" --> D
   *    +-- click "Menu 2" --> C
   *
   * Exploring B (and D beneath it) must not lose C — the exact failure
   * mode a flat FIFO queue with no backtracking produces (by the time
   * "Menu 2" is dequeued, the live tab would already be sitting in B or D's
   * DOM, so clicking "menu-2" there must fail rather than silently
   * clicking the wrong element or fabricating state C).
   */
  type AppState = "A" | "B" | "C" | "D";
  const TRANSITIONS: Record<string, AppState> = {
    "A:menu-1": "B",
    "A:menu-2": "C",
    "B:submenu-1": "D",
  };
  const CANDIDATES_BY_STATE: Record<
    AppState,
    Array<{ domPath: string; text: string }>
  > = {
    A: [
      { domPath: "menu-1", text: "Menu 1" },
      { domPath: "menu-2", text: "Menu 2" },
    ],
    B: [{ domPath: "submenu-1", text: "Submenu 1" }],
    C: [],
    D: [],
  };

  function setupLnLikeMock() {
    let appState: AppState = "A";
    const visitCounts: Record<AppState, number> = { A: 0, B: 0, C: 0, D: 0 };

    mockTabsUpdate.mockImplementation(
      async (_tabId: number, updateInfo: { url?: string }) => {
        if (updateInfo.url) {
          currentUrl = updateInfo.url;
          // A real navigation reloads the SPA back to its initial state —
          // this is exactly why restoring a same-URL click-driven state
          // requires a full reset-then-replay, not just re-navigating.
          appState = "A";
        }
        queueMicrotask(() => {
          for (const listener of [...onUpdatedListeners]) {
            listener(TAB_ID, { status: "complete" });
          }
        });
        return {};
      },
    );

    mockSendMessage.mockImplementation(
      (
        _tabId: number,
        msg: { request: string; domPath?: string },
        _options: unknown,
        callback: any,
      ) => {
        if (msg.request === "click-safe-navigation-candidate") {
          const key = `${appState}:${msg.domPath}`;
          const target = TRANSITIONS[key];
          if (!target) {
            callback({
              success: true,
              data: {
                clicked: false,
                reason: `no element matches "${msg.domPath}" in the current state`,
              },
            });
            return;
          }
          appState = target;
          callback({ success: true, data: { clicked: true } });
          return;
        }
        if (msg.request === "collect-dom-health-frame-bundle") {
          visitCounts[appState]++;
          callback({
            success: true,
            data: {
              snapshot: snapshotFixture(currentUrl),
              stateSignature: {
                ...stateSignatureFixture(currentUrl),
                activeNavItem: appState,
                headingSample: [`Screen ${appState}`],
              },
            },
          });
          return;
        }
        if (msg.request === "wait-for-dom-stable") {
          callback({ success: true, data: { settled: true, elapsedMs: 0 } });
          return;
        }
        if (msg.request === "collect-dom-health-links") {
          callback({ success: true, data: [] });
          return;
        }
        if (msg.request === "collect-dom-health-safe-navigation-candidates") {
          callback({
            success: true,
            data: CANDIDATES_BY_STATE[appState].map((c) => ({
              domPath: c.domPath,
              role: "menuitem",
              tagName: "div",
              text: c.text,
              looksDestructive: false,
              destructiveReason: null,
            })),
          });
          return;
        }
        if (msg.request === "get-dom-health-navigation-model") {
          callback({
            success: true,
            data: { usesHistoryApiRouting: false, historyApiCallCount: 0 },
          });
          return;
        }
        callback({ success: false, error: "unhandled message in test" });
      },
    );

    return { visitCounts, getAppState: () => appState };
  }

  it("discovers all four same-URL states (A, B, C, D) and does not lose sibling C after descending into B", async () => {
    const { visitCounts } = setupLnLikeMock();

    const promise = runApplicationDomHealthAudit(TAB_ID, {
      discoveryMode: "application-deep",
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (!result.available) return;

    expect(result.coverage.pagesAudited).toBe(4);
    const completedHeadings = result.pages
      .filter((p) => p.status === "completed")
      .map((p) => p.transitionReason);
    // All four states were genuinely visited and audited — not merely
    // discovered as candidates.
    expect(visitCounts.A).toBeGreaterThan(0);
    expect(visitCounts.B).toBeGreaterThan(0);
    expect(visitCounts.C).toBeGreaterThan(0);
    expect(visitCounts.D).toBeGreaterThan(0);
    expect(completedHeadings.some((r) => r?.includes("Menu 2"))).toBe(true);
    expect(completedHeadings.some((r) => r?.includes("Submenu 1"))).toBe(true);

    // The state graph reflects a real tree: 4 nodes, 3 edges (A->B, A->C, B->D).
    expect(result.stateGraph?.nodes).toHaveLength(4);
    expect(result.stateGraph?.edges).toHaveLength(3);
    expect(result.stateGraph?.edges.every((e) => e.sameUrl)).toBe(true);

    // Backtracking evidence: restoring to A (before Menu 2) and to B
    // (before Submenu 1) were both attempted and both succeeded.
    expect(result.restorations.length).toBeGreaterThanOrEqual(2);
    expect(result.restorations.every((r) => r.success)).toBe(true);
  });

  it("records restoration failure honestly rather than fabricating a state when replay diverges", async () => {
    setupLnLikeMock();
    // Sabotage the replay: once the FIRST click into B has happened once
    // (state B reached and audited), any FURTHER click on "menu-1" fails —
    // simulating an application whose same-URL state is not deterministically
    // re-enterable via the same click sequence.
    let menu1ClickCount = 0;
    const originalImpl = mockSendMessage.getMockImplementation()!;
    mockSendMessage.mockImplementation((tabId, msg: any, options, callback) => {
      if (
        msg.request === "click-safe-navigation-candidate" &&
        msg.domPath === "menu-1"
      ) {
        menu1ClickCount++;
        if (menu1ClickCount > 1) {
          callback({
            success: true,
            data: { clicked: false, reason: "element became stale" },
          });
          return;
        }
      }
      originalImpl(tabId, msg, options, callback);
    });

    const promise = runApplicationDomHealthAudit(TAB_ID, {
      discoveryMode: "application-deep",
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (!result.available) return;

    // Restoring to B (to explore Submenu 1) requires replaying "menu-1" a
    // second time — which this sabotage makes fail. The branch must be
    // reported as failed, never silently skipped or fabricated as success.
    expect(result.restorations.some((r) => !r.success)).toBe(true);
    const failedSubmenu = result.pages.find(
      (p) => p.title === "Submenu 1" && p.status === "not-discovered",
    );
    expect(failedSubmenu).toBeDefined();
    expect(failedSubmenu?.failureReason).toMatch(/restor/i);
  });
});
