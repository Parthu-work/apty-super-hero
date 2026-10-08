import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStartRouteProbe = vi.hoisted(() => vi.fn());

vi.mock("@apty/browser-runtime", () => ({
  startRouteProbe: mockStartRouteProbe,
  toShareableRouteProbeReport: vi.fn(),
}));

import { RouteProbePanel } from "./route-probe-panel";

function step(index: number, heading: string) {
  return {
    index,
    trigger: index === 0 ? "start" : "click",
    clickLabel: index === 0 ? null : { text: "Orders", hash: "c" },
    capturedAt: index,
    frames: [
      {
        frameId: 0,
        parentFrameId: -1,
        url: "https://portal.example.test/",
        urlHash: "u",
        status: "captured",
        title: { text: "LN", hash: "t" },
        heading: { text: heading, hash: heading },
        activeNav: null,
        owner: null,
        historyApiCallCount: 0,
        pushStateCount: 0,
        firstRequest: null,
      },
      {
        frameId: 7,
        parentFrameId: 0,
        url: "https://eln.example.test/",
        urlHash: "v",
        status: "failed",
        error: "Timed out",
        title: null,
        heading: null,
        activeNav: null,
        owner: {
          tagName: "iframe",
          name: null,
          id: null,
          title: null,
          ospId: "LN",
          hasSrcAttribute: true,
          rendered: true,
        },
        historyApiCallCount: null,
        pushStateCount: null,
        firstRequest: null,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RouteProbePanel", () => {
  it("shows each recorded step, then the analysis when stopped", async () => {
    const stop = vi.fn().mockResolvedValue({
      startedAt: 1,
      steps: [step(0, "Home"), step(1, "Sales Orders")],
      analysis: {
        clicks: 1,
        signals: [{ signal: "heading", changedOnClicks: 1, distinctValues: 2 }],
        hint: "click-first",
        reasons: [
          "URLs changed on 0 of 1 clicks, but the heading changed on 1.",
        ],
      },
    });
    mockStartRouteProbe.mockImplementation(async (_tabId, onStep) => {
      onStep(step(0, "Home"));
      onStep(step(1, "Sales Orders"));
      return { stop };
    });

    render(<RouteProbePanel tabId={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Start probe" }));

    expect(await screen.findByText("Click 1: Orders")).toBeInTheDocument();
    expect(screen.getByText("Sales Orders")).toBeInTheDocument();
    expect(screen.getAllByText("LN").length).toBeGreaterThan(0);
    expect(screen.getAllByText("not read: Timed out")).toHaveLength(2);
    expect(mockStartRouteProbe).toHaveBeenCalledWith(5, expect.any(Function));

    fireEvent.click(screen.getByRole("button", { name: "Stop probe" }));

    expect(
      await screen.findByText("Click-first traversal needed (1 clicks)"),
    ).toBeInTheDocument();
    expect(screen.getByText(/heading changed on 1/)).toBeInTheDocument();
  });
});
