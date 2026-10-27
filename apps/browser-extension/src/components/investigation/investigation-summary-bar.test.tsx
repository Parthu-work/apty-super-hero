import type { InvestigationSession } from "@apty/browser-runtime";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvestigationData } from "./use-investigation-data";

const mocks = vi.hoisted(() => ({ data: vi.fn(), sendMessage: vi.fn() }));

vi.mock("@apty/ui/components/chatbot", () => ({
  useChatContext: () => ({
    sessionId: "s1",
    status: "idle",
    sendMessage: mocks.sendMessage,
  }),
}));
vi.mock("./use-investigation-data", () => ({
  useInvestigationData: mocks.data,
}));

import { InvestigationSummaryBar } from "./investigation-summary-bar";

const INVESTIGATION: InvestigationSession = {
  id: "inv-1",
  conversationId: "s1",
  tabId: 1,
  startedAt: 0,
  updatedAt: 0,
  status: "analyzing",
  userProblem: "Widget not showing on Orders",
  suspectedComponents: [],
  hypotheses: [],
  verificationAttempts: [],
  plan: {
    category: "widget-not-loading",
    steps: [
      {
        id: "a",
        description: "Check the Client",
        suggestedTools: [],
        status: "done",
      },
      {
        id: "b",
        description: "Read the logs",
        suggestedTools: [],
        status: "pending",
      },
    ],
  },
  diagnosis: "The widget's init request returned HTTP 500",
  confidence: "possible",
};

function data(overrides: Partial<InvestigationData> = {}): InvestigationData {
  return {
    investigation: INVESTIGATION,
    evidence: [],
    clusters: [],
    componentHealth: [],
    likelyIncidentClusterCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("InvestigationSummaryBar", () => {
  it("renders nothing until there is an investigation or evidence", () => {
    mocks.data.mockReturnValue(data({ investigation: undefined }));
    const { container } = render(<InvestigationSummaryBar />);

    expect(container).toBeEmptyDOMElement();
  });

  it("sums up the status, the real plan count and the confidence in one row", () => {
    mocks.data.mockReturnValue(data());
    render(<InvestigationSummaryBar />);

    const bar = screen.getByRole("region", { name: "Investigation" });
    expect(bar).toHaveTextContent("Analyzing · 1 of 2 steps");
    expect(bar).toHaveTextContent("Possible");
    expect(screen.getByRole("button", { name: "Expand" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      screen.queryByRole("heading", { name: "Plan" }),
    ).not.toBeInTheDocument();
  });

  it("leaves out the step count when there is no plan", () => {
    mocks.data.mockReturnValue(
      data({ investigation: { ...INVESTIGATION, plan: undefined } }),
    );
    render(<InvestigationSummaryBar />);

    expect(
      screen.getByRole("region", { name: "Investigation" }),
    ).not.toHaveTextContent("steps");
  });

  it("stacks plan, components, timeline and diagnosis when expanded, and Esc collapses it back to the button", () => {
    mocks.data.mockReturnValue(data());
    render(<InvestigationSummaryBar />);

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));

    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual(["Plan", "Components", "Timeline", "Diagnosis"]);
    expect(
      screen.getByText("Widget not showing on Orders"),
    ).toBeInTheDocument();
    const collapse = screen.getByRole("button", { name: "Collapse" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(
      screen.getByRole("button", { name: "Verify diagnosis" }),
      {
        key: "Escape",
      },
    );

    expect(
      screen.queryByRole("heading", { name: "Plan" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand" })).toHaveFocus();
  });

  it("asks the agent to verify from the diagnosis", () => {
    mocks.data.mockReturnValue(data());
    render(<InvestigationSummaryBar />);

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    fireEvent.click(screen.getByRole("button", { name: "Verify diagnosis" }));

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      "Please verify the current diagnosis by re-checking the relevant evidence.",
    );
  });
});
