import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigationStore } from "../../state/navigation-store";

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  config: vi.fn(),
  reveal: vi.fn(),
}));

vi.mock("@apty/browser-runtime", () => ({}));
vi.mock("../investigation/dom-health-store", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../investigation/dom-health-store")
  >()),
  useDomHealthState: mocks.health,
}));
vi.mock(
  "../investigation/dom-config/dom-config-store",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../investigation/dom-config/dom-config-store")
    >()),
    useDomConfigState: mocks.config,
    revealDomConfigCard: mocks.reveal,
  }),
);

import { createDomConfigStore } from "../investigation/dom-config/dom-config-store";
import { createDomHealthStore } from "../investigation/dom-health-store";
import { JobBar } from "./job-bar";

const NOW = 1_000_000;
const idleHealth = createDomHealthStore().getState();
const idleConfig = createDomConfigStore().getState();

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.health.mockReturnValue(idleHealth);
  mocks.config.mockReturnValue(idleConfig);
  act(() => navigationStore.back());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("JobBar", () => {
  it("shows nothing while no job runs", () => {
    const { container } = render(<JobBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a running crawl's page, elapsed time and a way back to its page", () => {
    mocks.config.mockReturnValue({
      ...idleConfig,
      phase: "running",
      startedAt: NOW - 192_000,
      current: {
        phase: "capturing",
        stateIndex: 3,
        maxStates: 20,
        urlShape: "/orders",
        runIndex: 1,
        runCount: 2,
        runLabel: "after-reload",
      },
    });
    render(<JobBar />);

    const jobs = screen.getByRole("region", { name: "Running jobs" });
    expect(jobs).toHaveTextContent("DOM config · Page 4 of 20 · 3:12");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(jobs).toHaveTextContent("3:13");

    fireEvent.click(screen.getByRole("button", { name: "View: DOM config" }));
    expect(mocks.reveal).toHaveBeenCalled();
  });

  it("shows the application audit's page and opens DOM health from View", () => {
    mocks.health.mockReturnValue({
      ...idleHealth,
      running: "application",
      scope: "application",
      startedAt: NOW - 5_000,
      progress: {
        phase: "auditing",
        url: "https://app.example.com/b",
        pageIndex: 2,
        pagesQueued: 1,
      },
    });
    render(<JobBar />);

    expect(
      screen.getByRole("region", { name: "Running jobs" }),
    ).toHaveTextContent("DOM health · Page 3 · 0:05");
    fireEvent.click(screen.getByRole("button", { name: "View: DOM health" }));
    expect(navigationStore.getState().page).toBe("dom-health");
  });
});
