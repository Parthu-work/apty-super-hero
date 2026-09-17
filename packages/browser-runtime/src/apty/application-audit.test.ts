import type { DomHealthSnapshot } from "@aipexstudio/dom-snapshot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockTabsGet = vi.hoisted(() => vi.fn());
const mockTabsUpdate = vi.hoisted(() => vi.fn());
const mockSendMessage = vi.hoisted(() => vi.fn());
const onUpdatedListeners = vi.hoisted(
  () => [] as Array<(id: number, info: { status?: string }) => void>,
);

let currentUrl = "https://app.example.com/home";
const linksByUrl = new Map<string, unknown[]>();

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
  runtime: { lastError: undefined as { message?: string } | undefined },
};

import { runApplicationDomHealthAudit } from "./application-audit";

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
      stable: 0,
      changed: 0,
      detached: 0,
      new: 0,
      unknown: 1,
      nodeReplacedButLogicallyStable: 0,
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
    iframes: { total: 0, accessible: 0, crossOrigin: 0 },
    shadowDom: { roots: 0, elements: 0 },
    zIndex: { maxZIndex: 0, highZIndexElementCount: 0 },
  };
}

function setupSendMessageMock() {
  mockSendMessage.mockImplementation(
    (_tabId: number, msg: { request: string }, callback: any) => {
      if (msg.request === "collect-dom-health-snapshot") {
        callback({ success: true, data: snapshotFixture(currentUrl) });
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
