import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendMessage = vi.hoisted(() => vi.fn());
const mockGetAllFrames = vi.hoisted(() => vi.fn());
const listeners = vi.hoisted(() => new Set<(...args: any[]) => void>());

(global as any).chrome = {
  tabs: { sendMessage: mockSendMessage },
  webNavigation: { getAllFrames: mockGetAllFrames },
  runtime: {
    lastError: undefined,
    getManifest: () => ({ content_scripts: [] }),
    onMessage: {
      addListener: (fn: any) => listeners.add(fn),
      removeListener: (fn: any) => listeners.delete(fn),
    },
  },
};

import {
  analyzeRouteProbe,
  captureRouteProbeStep,
  type RouteProbeFrameRecord,
  type RouteProbeStep,
  startRouteProbe,
  toShareableRouteProbeReport,
} from "./route-probe";

const TAB_ID = 5;
const LN_SRC =
  "https://eln.example.test/webui/servlet/fslogin?LogicalId=lid://infor.ln.ln01&inforTenantId=FAKETENANT000000_TRN&inforSessionId=FAKETENANT000000_TRN~00000000-0000-4000-8000-000000000000";

function lnFrames() {
  return [
    {
      frameId: 0,
      parentFrameId: -1,
      url: "https://portal.example.test/FAKETENANT000000_TRN/",
      errorOccurred: false,
    },
    { frameId: 7, parentFrameId: 0, url: LN_SRC, errorOccurred: false },
  ];
}

function captured(overrides: Record<string, unknown> = {}) {
  return {
    url: "https://portal.example.test/",
    title: "LN",
    firstHeading: null,
    activeNavItem: "LN",
    owners: [],
    historyApiCallCount: 0,
    pushStateCount: 0,
    firstRequest: null,
    ...overrides,
  };
}

type Answer = (msg: any, frameId: number) => unknown;
function answerWith(answer: Answer) {
  mockSendMessage.mockImplementation(
    (_tab: number, msg: any, options: { frameId: number }, callback: any) => {
      const data = answer(msg, options.frameId);
      callback(
        data === undefined
          ? { success: false, error: "No answer" }
          : { success: true, data },
      );
    },
  );
}

function frame(
  overrides: Partial<RouteProbeFrameRecord>,
): RouteProbeFrameRecord {
  return {
    frameId: 0,
    parentFrameId: -1,
    url: "https://app.example.test/",
    urlHash: "u0",
    status: "captured",
    title: { text: "App", hash: "t0" },
    heading: null,
    activeNav: null,
    owner: null,
    historyApiCallCount: 0,
    pushStateCount: 0,
    firstRequest: null,
    ...overrides,
  };
}

function step(index: number, frames: RouteProbeFrameRecord[]): RouteProbeStep {
  return {
    index,
    trigger: index === 0 ? "start" : "click",
    clickLabel: null,
    capturedAt: index,
    frames,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  mockGetAllFrames.mockResolvedValue(lnFrames());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("captureRouteProbeStep", () => {
  it("joins each frame to the owner attributes its parent reported, redacted", async () => {
    answerWith((msg, frameId) => {
      if (msg.request !== "dom-health-probe-capture") return {};
      if (frameId === 0) {
        return captured({
          owners: [
            {
              frameId: 7,
              tagName: "iframe",
              name: "LN_44_11111111-2222-4333-8444-555555555555",
              id: null,
              title: "LN",
              ospId: "LN",
              srcAttribute: LN_SRC,
              rendered: true,
            },
          ],
        });
      }
      return captured({
        url: LN_SRC,
        title: "Sales Orders [4242424]",
        firstHeading: "Sales Order 4242424",
        firstRequest: {
          origin: "https://eln.example.test",
          path: "/webui/servlet/4242424/orders",
          initiatorType: "fetch",
          msAfterClick: 12,
        },
      });
    });

    const result = await captureRouteProbeStep(TAB_ID, 1, "click", "Orders");
    const app = result.frames.find((f) => f.frameId === 7)!;

    expect(app.owner).toMatchObject({
      ospId: "LN",
      name: { text: "LN_44_:id" },
      title: { text: "LN" },
      hasSrcAttribute: true,
    });
    expect(app.url).not.toContain("FAKETENANT000000_TRN");
    expect(app.title?.text).toBe("Sales Orders [:id]");
    expect(app.title?.hash).toMatch(/^[0-9a-f]+$/);
    expect(app.firstRequest?.path).toBe("/webui/servlet/:id/orders");
    expect(result.clickLabel?.text).toBe("Orders");
    expect(JSON.stringify(result)).not.toContain("4242424");
  });

  it("records a frame that does not answer as failed, with the reason", async () => {
    answerWith((_msg, frameId) => (frameId === 0 ? captured() : undefined));

    const result = await captureRouteProbeStep(TAB_ID, 0, "start", null);

    expect(result.frames).toHaveLength(2);
    expect(result.frames[1]).toMatchObject({
      frameId: 7,
      status: "failed",
      error: "No answer",
      title: null,
    });
  });
});

describe("analyzeRouteProbe", () => {
  it("hints click-first when headings change but URLs never do (LN, athenaOne shape)", () => {
    const steps = [0, 1, 2, 3].map((i) =>
      step(i, [frame({ heading: { text: `Screen ${i}`, hash: `h${i}` } })]),
    );

    const analysis = analyzeRouteProbe(steps);

    expect(analysis.clicks).toBe(3);
    expect(analysis.hint).toBe("click-first");
    expect(analysis.signals.find((s) => s.signal === "heading")).toMatchObject({
      changedOnClicks: 3,
      distinctValues: 4,
    });
    expect(
      analysis.signals.find((s) => s.signal === "topUrl")?.changedOnClicks,
    ).toBe(0);
  });

  it("hints url-first when the URL changes on most clicks, and reports pushState", () => {
    const steps = [0, 1, 2].map((i) =>
      step(i, [frame({ urlHash: `u${i}`, pushStateCount: i })]),
    );

    const analysis = analyzeRouteProbe(steps);

    expect(analysis.hint).toBe("url-first");
    expect(analysis.reasons.join(" ")).toContain(
      "pushState after 2 of 2 clicks",
    );
  });

  it("stays undetermined when nothing identifying changes, or nothing was clicked", () => {
    expect(
      analyzeRouteProbe([0, 1, 2].map((i) => step(i, [frame({})]))).hint,
    ).toBe("undetermined");
    const none = analyzeRouteProbe([step(0, [frame({})])]);
    expect(none.hint).toBe("undetermined");
    expect(none.reasons[0]).toContain("No clicks");
  });

  it("ignores frames that failed to answer when comparing steps", () => {
    const steps = [
      step(0, [
        frame({}),
        frame({ frameId: 3, urlHash: "x", status: "failed" }),
      ]),
      step(1, [frame({})]),
    ];

    expect(
      analyzeRouteProbe(steps).signals.find((s) => s.signal === "frameUrls")
        ?.changedOnClicks,
    ).toBe(0);
  });
});

describe("toShareableRouteProbeReport", () => {
  it("keeps hashes and URLs but drops page text", () => {
    const report = {
      startedAt: 1,
      steps: [
        {
          ...step(0, [
            frame({
              heading: { text: "Patient Chart", hash: "h1" },
              owner: {
                tagName: "iframe" as const,
                name: { text: "LN_44_:id", hash: "n1" },
                id: null,
                title: { text: "LN", hash: "t1" },
                ospId: "LN",
                hasSrcAttribute: true,
                rendered: true,
              },
            }),
          ]),
          clickLabel: { text: "Patients", hash: "c1" },
        },
      ],
      analysis: analyzeRouteProbe([]),
    };

    const shared = toShareableRouteProbeReport(report);
    const serialized = JSON.stringify(shared);

    expect(serialized).not.toContain("Patient Chart");
    expect(serialized).not.toContain("Patients");
    expect(shared.steps[0]!.frames[0]!.heading).toEqual({
      text: "",
      hash: "h1",
    });
    expect(shared.steps[0]!.frames[0]!.owner?.ospId).toBe("LN");
    expect(shared.steps[0]!.frames[0]!.url).toBe("https://app.example.test/");
  });
});

describe("startRouteProbe", () => {
  it("arms every frame, records a step per click in the probed tab only, and disarms on stop", async () => {
    const requests: string[] = [];
    let heading = 0;
    answerWith((msg) => {
      requests.push(msg.request);
      if (msg.request === "dom-health-probe-capture") {
        return captured({ firstHeading: `Screen ${heading}` });
      }
      if (msg.request === "wait-for-dom-stable")
        return { settled: true, elapsedMs: 1 };
      return {};
    });
    const onStep = vi.fn();

    const session = await startRouteProbe(TAB_ID, onStep);
    expect(onStep).toHaveBeenCalledTimes(1);

    heading = 1;
    for (const listener of listeners) {
      listener(
        { request: "dom-health-probe-click", label: "Orders" },
        { tab: { id: TAB_ID } },
      );
      listener(
        { request: "dom-health-probe-click", label: "Other tab" },
        { tab: { id: 99 } },
      );
    }
    const report = await session.stop();

    expect(report.steps.map((s) => s.trigger)).toEqual(["start", "click"]);
    expect(report.steps[1]!.clickLabel?.text).toBe("Orders");
    expect(
      report.analysis.signals.find((s) => s.signal === "heading")
        ?.changedOnClicks,
    ).toBe(1);
    expect(requests).toContain("dom-health-probe-arm");
    expect(requests.at(-1)).toBe("dom-health-probe-disarm");
    expect(listeners.size).toBe(0);
  });
});
