import type { DomProfileV2 } from "@apty/dom-snapshot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildReportFromCapture,
  captureCurrentState,
  type DomConfigCaptureProgress,
  runDomConfigCapture,
} from "./crawl";

const TAB_ID = 9;
const ORIGIN = "https://app.example.test";
const MENU = {
  domPath: "nav > div:nth-of-type(1)",
  role: "menuitem",
  tagName: "div",
  text: "Reports",
  looksDestructive: false,
  destructiveReason: null,
};

interface FakeApp {
  url: string;
  menuOpen: boolean;
  loads: number;
  links: Record<string, string[]>;
  menuOn: string[];
  /** Pages whose second load shows another screen (a session redirect). */
  unstable: Set<string>;
  failingProfiles: Set<string>;
  visitsByPath: Map<string, number>;
}

let app: FakeApp;
let requests: string[];
const onUpdated: Array<(id: number, info: { status?: string }) => void> = [];
const tabsUpdate = vi.fn();
const tabsReload = vi.fn();

function path(url: string): string {
  return new URL(url).pathname;
}

function signature() {
  const p = path(app.url);
  const redirected = app.unstable.has(p) && (app.visitsByPath.get(p) ?? 0) > 1;
  return {
    url: app.url,
    navTrail: app.menuOpen ? ["Reports"] : [],
    primaryHeading: redirected ? "Sign in" : app.menuOpen ? "Reports" : p,
    structureHash: "s0",
  };
}

function profile(): DomProfileV2 {
  return {
    schema: 2,
    tags: { html: 1, head: 1, body: 1, div: 3 },
    attributes: {
      id: { [`ui-id-${app.loads}`]: 1, "main-panel": 1 },
      class: { RptTable: 2 },
    },
    maxZIndex: 10,
    zIndexSources: [],
    frames: [],
    shadow: [],
    meta: { elementCount: 6, urlShape: app.url, aptyPresent: false },
  };
}

function respond(message: { request: string }): unknown {
  switch (message.request) {
    case "collect-dom-health-frame-bundle":
      return {
        snapshot: {
          url: app.url,
          counts: {
            interactiveElements: 1,
            inputs: 0,
            selects: 0,
            textareas: 0,
          },
          elementUniverse: { totalElements: 6, meaningfulElements: 6 },
        },
        stateSignature: signature(),
      };
    case "wait-for-dom-stable":
      return { settled: true, elapsedMs: 0 };
    case "collect-dom-health-links":
      return app.menuOpen
        ? []
        : (app.links[path(app.url)] ?? []).map((target) => ({
            href: target,
            absoluteUrl: `${ORIGIN}${target}`,
            sameOrigin: true,
            text: target,
            looksDestructive: false,
            destructiveReason: null,
            frameId: 0,
            domPath: `a[href="${target}"]`,
          }));
    case "collect-dom-health-safe-navigation-candidates":
      return !app.menuOpen && app.menuOn.includes(path(app.url)) ? [MENU] : [];
    case "get-dom-health-navigation-model":
      return { usesHistoryApiRouting: false, historyApiCallCount: 0 };
    case "click-safe-navigation-candidate":
      app.menuOpen = true;
      return { clicked: true };
    case "collect-dom-health-frame-owners":
      return [];
    case "collect-dom-profile":
      return app.failingProfiles.has(path(app.url)) ? undefined : profile();
    case "dom-config-probe-arm":
    case "dom-config-probe-disarm":
      return { armed: true };
    case "dom-config-probe-capture":
      return {
        ran: true,
        windowMs: 3000,
        mutationBursts: [{ durationMs: 300, mutationCount: 5 }],
        burstGapsMs: [],
        eventRates: {},
        ranToCompletion: true,
      };
    default:
      return undefined;
  }
}

function navigate(url: string) {
  app.url = url;
  app.menuOpen = false;
  app.loads++;
  const p = path(url);
  app.visitsByPath.set(p, (app.visitsByPath.get(p) ?? 0) + 1);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  requests = [];
  onUpdated.length = 0;
  app = {
    url: `${ORIGIN}/home`,
    menuOpen: false,
    loads: 1,
    links: { "/home": ["/a", "/b"] },
    menuOn: [],
    unstable: new Set(),
    failingProfiles: new Set(),
    visitsByPath: new Map([["/home", 1]]),
  };
  tabsUpdate.mockImplementation(async (_id: number, info: { url?: string }) => {
    if (info.url) navigate(info.url);
    queueMicrotask(() => {
      for (const listener of [...onUpdated]) {
        listener(TAB_ID, { status: "complete" });
      }
    });
    return {};
  });
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      lastError: undefined,
      getManifest: () => ({ content_scripts: [] }),
    },
    webNavigation: {
      getAllFrames: vi.fn(async () => [
        { frameId: 0, parentFrameId: -1, url: app.url, errorOccurred: false },
      ]),
    },
    tabs: {
      get: vi.fn(async () => ({ id: TAB_ID, url: app.url })),
      update: tabsUpdate,
      reload: tabsReload,
      onUpdated: {
        addListener: (fn: (id: number, info: { status?: string }) => void) =>
          onUpdated.push(fn),
        removeListener: (
          fn: (id: number, info: { status?: string }) => void,
        ) => {
          const i = onUpdated.indexOf(fn);
          if (i >= 0) onUpdated.splice(i, 1);
        },
      },
      sendMessage: vi.fn(
        (
          _tabId: number,
          message: { request: string },
          _options: unknown,
          callback: (response: unknown) => void,
        ) => {
          requests.push(message.request);
          const data = respond(message);
          callback(
            data === undefined
              ? { success: false, error: "The frame did not answer." }
              : { success: true, data },
          );
        },
      ),
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.restoreAllMocks();
});

const noWait = async () => {};

async function run<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

function navigatedTo(): string[] {
  return tabsUpdate.mock.calls.map(([, info]) => path(info.url));
}

describe("runDomConfigCapture", () => {
  it("captures every linked page twice, the second time after a fresh visit, and ends on the seed", async () => {
    const outcome = await run(runDomConfigCapture(TAB_ID, { wait: noWait }));
    expect(outcome.available).toBe(true);
    if (!outcome.available) return;

    expect(outcome.capture.pages.map((p) => p.pageId)).toEqual([
      `${ORIGIN}/home`,
      `${ORIGIN}/a`,
      `${ORIGIN}/b`,
    ]);
    for (const page of outcome.capture.pages) {
      expect(page.runs.map((r) => r.meta.label)).toEqual([
        "initial",
        "after-reload",
      ]);
      expect(page.runs.some((r) => r.meta.stateMismatch)).toBe(false);
      expect(page.runs[0]!.profile.probe?.ran).toBe(true);
      expect(page.runs[1]!.profile.probe).toBeUndefined();
    }
    expect(navigatedTo()).toEqual(["/home", "/a", "/a", "/b", "/b", "/home"]);
    expect(outcome.returnedToSeed).toEqual({ success: true, reason: null });
    expect(tabsReload).not.toHaveBeenCalled();
    expect(outcome.report.pages.map((p) => p.status)).toEqual([
      "changing",
      "changing",
      "changing",
    ]);
    expect(outcome.markdown).toBe(
      buildReportFromCapture(outcome.capture).markdown,
    );
  });

  it("reports progress per run in the order the work happens", async () => {
    app.links = {};
    const events: DomConfigCaptureProgress[] = [];
    await run(
      runDomConfigCapture(TAB_ID, {
        wait: noWait,
        onProgress: (p) => events.push(p),
      }),
    );
    expect(
      events.map((e) =>
        e.phase === "capturing" ? `capturing:${e.runLabel}` : e.phase,
      ),
    ).toEqual([
      "capturing:initial",
      "probing",
      "revisiting",
      "capturing:after-reload",
      "discovering",
      "analyzing",
    ]);
  });

  it("labels a fresh visit that shows another state state-mismatch and keeps it out of observed changes", async () => {
    app.unstable.add("/a");
    app.menuOn = ["/a"];
    const outcome = await run(runDomConfigCapture(TAB_ID, { wait: noWait }));
    if (!outcome.available) throw new Error(outcome.error);
    const pageA = outcome.capture.pages.find((p) => p.pageId.endsWith("/a"))!;
    expect(pageA.runs.map((r) => Boolean(r.meta.stateMismatch))).toEqual([
      false,
      true,
    ]);
    expect(pageA.runs[1]!.meta.stateFingerprint).toBeUndefined();
    const row = outcome.inventory.find((r) => r.pageId === pageA.pageId)!;
    expect(row.reason).toMatch(/^state-mismatch \(different\)/);
    expect(outcome.inventory.filter((r) => r.control)).toEqual([]);
    expect(
      outcome.report.pages.find((p) => p.pageId === pageA.pageId)?.status,
    ).not.toBe("changing");
  });

  it("restores a state reached by a click by replaying its path from the seed, in deep mode only", async () => {
    app.links = {};
    app.menuOn = ["/home"];
    const outcome = await run(
      runDomConfigCapture(TAB_ID, {
        wait: noWait,
        discoveryMode: "application-deep",
      }),
    );
    if (!outcome.available) throw new Error(outcome.error);
    const clicked = outcome.capture.pages.find((p) =>
      p.pageId.includes("[state-1]"),
    )!;
    expect(clicked.runs.map((r) => r.meta.label)).toEqual([
      "initial",
      "after-reload",
    ]);
    expect(clicked.runs[1]!.meta.stateMismatch).toBeUndefined();
    expect(
      requests.filter((r) => r === "click-safe-navigation-candidate"),
    ).toHaveLength(2);
    expect(navigatedTo()).toEqual(["/home", "/home", "/home"]);
    expect(app.menuOpen).toBe(false);
  });

  it("only reports a menu control in safe mode and never clicks it", async () => {
    app.links = {};
    app.menuOn = ["/home"];
    const outcome = await run(runDomConfigCapture(TAB_ID, { wait: noWait }));
    if (!outcome.available) throw new Error(outcome.error);
    expect(requests).not.toContain("click-safe-navigation-candidate");
    expect(outcome.inventory).toContainEqual(
      expect.objectContaining({
        status: "not-discovered",
        control: true,
        urlShape: `${ORIGIN}/home`,
      }),
    );
    expect(outcome.capture.pages).toHaveLength(1);
  });

  it("takes the repeats without navigating", async () => {
    app.links = {};
    const outcome = await run(
      runDomConfigCapture(TAB_ID, { wait: noWait, runsPerState: 9 }),
    );
    if (!outcome.available) throw new Error(outcome.error);
    expect(outcome.capture.pages[0]!.runs.map((r) => r.meta.label)).toEqual([
      "initial",
      "after-reload",
      "repeat",
      "repeat",
    ]);
    expect(navigatedTo()).toEqual(["/home"]);
  });

  it("stops between steps when aborted and returns what it captured", async () => {
    const controller = new AbortController();
    const outcome = await run(
      runDomConfigCapture(TAB_ID, {
        wait: noWait,
        probe: false,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase === "capturing") controller.abort();
        },
      }),
    );
    if (!outcome.available) throw new Error(outcome.error);
    expect(outcome.aborted).toBe(true);
    expect(outcome.capture.pages).toHaveLength(1);
    expect(outcome.capture.pages[0]!.runs).toHaveLength(1);
    expect(outcome.report.unreadyPages.map((p) => p.pageId)).toEqual([
      `${ORIGIN}/home`,
    ]);
  });

  it("stops at the page limit and lists the pages it did not visit", async () => {
    const outcome = await run(
      runDomConfigCapture(TAB_ID, { wait: noWait, maxPages: 2 }),
    );
    if (!outcome.available) throw new Error(outcome.error);
    expect(outcome.limitsReached.maxPages).toBe(true);
    expect(outcome.capture.pages).toHaveLength(2);
    expect(
      outcome.inventory
        .filter((r) => r.status === "not-explored")
        .map((r) => r.urlShape),
    ).toEqual([`${ORIGIN}/b`]);
  });

  it("records a state that could not be profiled and carries on", async () => {
    app.failingProfiles.add("/a");
    const outcome = await run(runDomConfigCapture(TAB_ID, { wait: noWait }));
    if (!outcome.available) throw new Error(outcome.error);
    expect(
      outcome.inventory.map((r) => [r.urlShape.slice(ORIGIN.length), r.status]),
    ).toEqual([
      ["/home", "audited"],
      ["/a", "failed"],
      ["/b", "audited"],
    ]);
  });

  it("captures the start page once when the application links back to it with a cache-busting parameter, without spending a page on it", async () => {
    app.links = { "/home": ["/home?nocache=1700000000017", "/a"] };
    const outcome = await run(
      runDomConfigCapture(TAB_ID, { wait: noWait, maxPages: 2 }),
    );
    if (!outcome.available) throw new Error(outcome.error);
    expect(outcome.capture.pages.map((p) => p.pageId)).toEqual([
      `${ORIGIN}/home`,
      `${ORIGIN}/a`,
    ]);
    expect(outcome.inventory).toContainEqual(
      expect.objectContaining({
        urlShape: `${ORIGIN}/home?nocache`,
        status: "skipped",
        reason: `duplicate of ${ORIGIN}/home`,
        pageId: null,
      }),
    );
    expect(outcome.limitsReached.maxPages).toBe(true);
  });

  it("keeps a page whose query names another screen", async () => {
    app.links = { "/home": ["/home?view=visits"] };
    const outcome = await run(runDomConfigCapture(TAB_ID, { wait: noWait }));
    if (!outcome.available) throw new Error(outcome.error);
    expect(outcome.capture.pages.map((p) => p.pageId)).toEqual([
      `${ORIGIN}/home`,
      `${ORIGIN}/home?view`,
    ]);
  });

  it("refuses a browser page without touching it", async () => {
    app.url = "chrome://settings/";
    const outcome = await run(runDomConfigCapture(TAB_ID, { wait: noWait }));
    expect(outcome.available).toBe(false);
    expect(tabsUpdate).not.toHaveBeenCalled();
  });
});

describe("captureCurrentState", () => {
  const options = { runLabel: "initial" as const, wait: noWait };

  it("adds a run of the tab as it is without navigating, clicking or reloading", async () => {
    app.menuOpen = true;
    const first = await run(
      captureCurrentState(TAB_ID, { ...options, pageName: " Reports modal " }),
    );
    if (!first.available) throw new Error(first.error);
    const second = await run(
      captureCurrentState(TAB_ID, {
        ...options,
        capture: first.capture,
        pageName: "Reports modal",
        runLabel: "repeat",
      }),
    );
    if (!second.available) throw new Error(second.error);

    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(tabsReload).not.toHaveBeenCalled();
    expect(requests).not.toContain("click-safe-navigation-candidate");
    expect(app.menuOpen).toBe(true);
    expect(first.capture.pages[0]!.runs).toHaveLength(1);
    expect(second.capture.pages).toEqual([
      expect.objectContaining({
        pageId: "Reports modal",
        origin: "manual",
        runs: [
          expect.objectContaining({
            meta: expect.objectContaining({ label: "initial" }),
          }),
          expect.objectContaining({
            meta: expect.objectContaining({ label: "repeat" }),
          }),
        ],
      }),
    ]);
    expect(second.warnings).toEqual([]);
  });

  it("warns when the same state is captured under another name", async () => {
    const crawled = await run(
      runDomConfigCapture(TAB_ID, { wait: noWait, discoveryMode: "page" }),
    );
    if (!crawled.available) throw new Error(crawled.error);
    tabsUpdate.mockClear();
    const manual = await run(
      captureCurrentState(TAB_ID, {
        ...options,
        capture: crawled.capture,
        pageName: "Home again",
      }),
    );
    if (!manual.available) throw new Error(manual.error);
    expect(manual.warnings).toEqual([
      { code: "duplicate-state", pageIds: [`${ORIGIN}/home`] },
    ]);
    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(
      buildReportFromCapture(manual.capture).report.pages.map((p) => p.pageId),
    ).toEqual(expect.arrayContaining([`${ORIGIN}/home`, "Home again"]));
  });

  it("needs a page name", async () => {
    const outcome = await captureCurrentState(TAB_ID, {
      ...options,
      pageName: "  ",
    });
    expect(outcome).toEqual({
      available: false,
      error: "A page name is needed.",
    });
  });
});
