import type { DomProfileV2 } from "@apty/dom-snapshot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capture, page, run } from "./__tests__/fixtures";
import { buildDomConfigReport } from "./build-report";
import {
  captureBehaviorProbe,
  collectStateProfile,
} from "./collect-state-profile";

const TOP = "https://ehr.example.test/patients/1234567/chart?tab=notes";
const SAME = "https://ehr.example.test/frames/notes";
const CROSS = "https://docs.example.test/viewer";
const DEAD = "https://reports.example.test/print";
const EXTENSION = "chrome-extension://abcdefghijklmnop/login.html";

const FRAMES = [
  { frameId: 0, parentFrameId: -1, url: TOP, errorOccurred: false },
  { frameId: 1, parentFrameId: 0, url: SAME, errorOccurred: false },
  { frameId: 2, parentFrameId: 0, url: CROSS, errorOccurred: false },
  { frameId: 3, parentFrameId: 0, url: DEAD, errorOccurred: false },
  { frameId: 4, parentFrameId: 0, url: EXTENSION, errorOccurred: false },
  { frameId: 5, parentFrameId: 2, url: "about:blank", errorOccurred: false },
];

const OWNERS = [
  { frameId: 1, srcAttribute: "/frames/notes" },
  { frameId: 2, srcAttribute: "https://docs.example.test/viewer?doc=884213" },
  { frameId: 3, srcAttribute: "https://reports.example.test/print" },
  { frameId: 4, srcAttribute: EXTENSION },
].map((o) => ({
  tagName: "iframe",
  name: null,
  id: null,
  title: null,
  ospId: null,
  className: null,
  rendered: true,
  ignoredBy: null,
  ...o,
}));

function profileOf(
  attributes: DomProfileV2["attributes"],
  meta: DomProfileV2["meta"] = {},
): DomProfileV2 {
  return {
    schema: 2,
    tags: { html: 1, head: 1, body: 1, div: 2 },
    attributes,
    maxZIndex: 10,
    zIndexSources: [],
    frames: [],
    shadow: [],
    meta: {
      elementCount: 5,
      durationMs: 40,
      partial: false,
      truncatedAttributes: [],
      cutValues: 0,
      closedShadowRootsVisible: true,
      excludedRoots: [],
      ...meta,
    },
  };
}

const PROFILES: Record<number, DomProfileV2> = {
  0: profileOf(
    { id: { "home-table": 1 } },
    {
      urlShape: "https://ehr.example.test/patients/:id/chart?tab",
      aptyPresent: true,
      excludedRoots: [
        {
          matcher: "tag:apty-widget",
          owner: "Apty Widget",
          evidence: "measured",
          roots: 1,
          elementCount: 4,
        },
      ],
    },
  ),
  1: profileOf({ id: { "notes-editor": 1 }, class: { "ui-id-1": 1 } }),
  2: profileOf({ id: { "viewer-page": 1 } }),
  5: {
    ...profileOf({}),
    tags: { html: 1, head: 1, body: 1 },
    meta: { elementCount: 3 },
  },
};

let messages: Array<{ frameId: number; request: string }>;
let probeRequests: Array<{ frameId: number; request: string }>;

beforeEach(() => {
  messages = [];
  probeRequests = [];
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      lastError: undefined,
      getManifest: () => ({ content_scripts: [] }),
    },
    webNavigation: { getAllFrames: vi.fn(async () => FRAMES) },
    tabs: {
      sendMessage: vi.fn(
        (
          _tabId: number,
          message: { request: string },
          { frameId }: { frameId: number },
          respond: (response: unknown) => void,
        ) => {
          messages.push({ frameId, request: message.request });
          switch (message.request) {
            case "collect-dom-health-frame-owners":
              respond({ success: true, data: frameId === 0 ? OWNERS : [] });
              return;
            case "collect-dom-profile":
              respond(
                PROFILES[frameId]
                  ? { success: true, data: PROFILES[frameId] }
                  : {
                      success: false,
                      error: "Timed out waiting for this frame to respond.",
                    },
              );
              return;
            case "dom-config-probe-arm":
            case "dom-config-probe-disarm":
              probeRequests.push({ frameId, request: message.request });
              respond(
                frameId === 3
                  ? { success: false, error: "no receiver" }
                  : {
                      success: true,
                      data: { armed: message.request.endsWith("arm") },
                    },
              );
              return;
            case "dom-config-probe-capture":
              probeRequests.push({ frameId, request: message.request });
              respond({
                success: true,
                data: {
                  ran: true,
                  windowMs: 3000,
                  mutationBursts: [
                    { durationMs: 120 * (frameId + 1), mutationCount: 4 },
                  ],
                  burstGapsMs: [],
                  eventRates:
                    frameId === 0
                      ? { scroll: 2 }
                      : { scroll: 1, mousemove: 30 },
                  ranToCompletion: true,
                },
              });
              return;
            default:
              respond({ success: false, error: "not handled" });
          }
        },
      ),
    },
  };
});

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.restoreAllMocks();
});

describe("collectStateProfile", () => {
  it("profiles each frame by frameId and nests them the way the console script does", async () => {
    const outcome = await collectStateProfile(42, { ignoredRoots: [] });
    expect(outcome.available).toBe(true);
    if (!outcome.available) return;
    const { profile, inventory } = outcome.result;

    expect(Object.keys(profile.iframes ?? {})).toEqual([
      "https://ehr.example.test/frames/notes",
      "https://docs.example.test/viewer",
      "Cross Origin 1 (src: https://reports.example.test/print)",
      "Cross Origin 2 (src: chrome-extension://abcdefghijklmnop/login.html)",
    ]);
    expect(
      profile.iframes?.["https://ehr.example.test/frames/notes"],
    ).toMatchObject({
      isCrossOrigin: false,
      attributes: { id: { "notes-editor": 1 } },
    });
    expect(
      profile.iframes?.["https://docs.example.test/viewer"]?.iframes?.[
        "about:blank"
      ],
    ).toMatchObject({ isCrossOrigin: true, tags: { html: 1 } });
    expect(
      profile.frames?.map((f) => [f.frameId, f.src, f.readable, f.reason]),
    ).toEqual([
      [1, "/frames/notes", true, undefined],
      [2, "https://docs.example.test/viewer?doc", true, undefined],
      [3, "https://reports.example.test/print", false, "unreachable"],
      [4, "chrome-extension://abcdefghijklmnop/login.html", false, "noise"],
      [5, "about:blank", true, "about:blank"],
    ]);
    expect(
      messages
        .filter((m) => m.request === "collect-dom-profile")
        .map((m) => m.frameId),
    ).toEqual([0, 1, 2, 3, 5]);
    expect(profile.meta).toMatchObject({
      urlShape: "https://ehr.example.test/patients/:id/chart?tab",
      aptyPresent: true,
      extensionNoisePresent: true,
      elementCount: 18,
      partial: true,
      partialReasons: [
        "Frame 3 did not answer: Timed out waiting for this frame to respond.",
      ],
    });
    expect(inventory.map((i) => [i.frameId, i.role, i.analyzed])).toEqual([
      [0, "application", true],
      [1, "application", true],
      [2, "application", true],
      [3, "application", false],
      [4, "application", false],
      [5, "placeholder", true],
    ]);
    expect(inventory[3]!.reason).toBe(
      "Its content script did not answer: Timed out waiting for this frame to respond.",
    );
    expect(inventory[4]!.reason).toBe(
      "Extension or overlay content, left out on purpose.",
    );
  });

  it("feeds the engine: frame content, frames to handle and noise left out by the collector", async () => {
    const outcome = await collectStateProfile(42);
    if (!outcome.available) throw new Error(outcome.error);
    const { profile } = outcome.result;
    const runs = [run("initial", profile), run("after-reload", profile)];

    const report = buildDomConfigReport(capture([page("chart", runs)]));

    expect(
      report.iframes.map((f) => [f.src, f.kind, f.needsHandling, f.analyzed]),
    ).toEqual([
      ["/frames/notes", "application", true, true],
      ["about:blank", "application", true, true],
      ["https://docs.example.test/viewer?doc", "application", true, true],
      ["https://reports.example.test/print", "application", true, false],
      [
        "chrome-extension://abcdefghijklmnop/login.html",
        "extension",
        false,
        false,
      ],
    ]);
    expect(report.noise).toContainEqual(
      expect.objectContaining({
        matcher: "tag:apty-widget",
        source: "apty",
        count: 1,
      }),
    );
    expect(report.unreadyPages).toEqual([
      { pageId: "chart", label: "chart", reason: "unreliable" },
    ]);
  });

  it("says so when the page itself cannot be read", async () => {
    delete PROFILES[0];
    try {
      await expect(collectStateProfile(42)).resolves.toEqual({
        available: false,
        error:
          "The page itself could not be read: Timed out waiting for this frame to respond.",
      });
    } finally {
      PROFILES[0] = profileOf({ id: { "home-table": 1 } });
    }
  });
});

describe("captureBehaviorProbe", () => {
  it("arms every reachable frame, waits the window, then captures and disarms", async () => {
    const wait = vi.fn(async () => {});

    const probe = await captureBehaviorProbe(42, { windowMs: 3000, wait });

    expect(wait).toHaveBeenCalledWith(3000);
    expect(probe).toEqual({
      ran: true,
      windowMs: 3000,
      mutationBursts: [
        { durationMs: 120, mutationCount: 4 },
        { durationMs: 240, mutationCount: 4 },
        { durationMs: 360, mutationCount: 4 },
        { durationMs: 720, mutationCount: 4 },
      ],
      burstGapsMs: [],
      eventRates: { mousemove: 90, scroll: 5 },
      ranToCompletion: true,
      mutationSources: [],
    });
    expect(
      probeRequests
        .filter((r) => r.request === "dom-config-probe-disarm")
        .map((r) => r.frameId),
    ).toEqual([0, 1, 2, 5]);
    expect(probeRequests.some((r) => r.frameId === 4)).toBe(false);
  });
});
