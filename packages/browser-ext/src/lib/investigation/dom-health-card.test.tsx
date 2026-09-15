import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseChatContext = vi.hoisted(() => vi.fn());
const mockUseCurrentTarget = vi.hoisted(() => vi.fn());
const mockRunDomHealthAudit = vi.hoisted(() => vi.fn());

vi.mock("@aipexstudio/aipex-react/components/chatbot", () => ({
  useChatContext: mockUseChatContext,
}));

vi.mock("./use-current-target", () => ({
  useCurrentTarget: mockUseCurrentTarget,
}));

vi.mock("@aipexstudio/browser-runtime", () => ({
  runDomHealthAudit: mockRunDomHealthAudit,
}));

import { DomHealthCard } from "./dom-health-card";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseChatContext.mockReturnValue({ sessionId: "session-1" });
  mockUseCurrentTarget.mockReturnValue({
    tabId: 5,
    title: "Test App",
    hostname: "example.com",
  });
});

describe("DomHealthCard", () => {
  it("shows 'Not checked yet' and never runs an audit automatically", () => {
    render(<DomHealthCard />);

    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
    expect(mockRunDomHealthAudit).not.toHaveBeenCalled();
  });

  it("shows a loading state while the audit is running, then the result", async () => {
    const pending = deferred<any>();
    mockRunDomHealthAudit.mockReturnValue(pending.promise);

    render(<DomHealthCard />);
    fireEvent.click(screen.getByRole("button", { name: /check dom health/i }));

    expect(mockRunDomHealthAudit).toHaveBeenCalledWith(5);
    expect(
      await screen.findByText(
        /Inspecting DOM|Analyzing selectors|Comparing DOM stability|Calculating Apty readiness/,
      ),
    ).toBeInTheDocument();

    pending.resolve({
      available: true,
      auditId: "a1",
      timestamp: Date.now(),
      url: "https://example.com",
      pageTitle: "Test App",
      score: 88,
      grade: "GOOD",
      metrics: {
        selectorQuality: 90,
        selectorStability: 85,
        attributeQuality: 80,
        domStability: 95,
        iframeAccessibility: 100,
        shadowDomAccessibility: 100,
        domComplexity: 100,
        overlayRisk: 100,
      },
      metricDetails: {} as any,
      summary:
        "This page's DOM is generally reliable for Apty element selection, with minor risks.",
      risks: [],
      recommendations: [],
      metadata: {
        elementsAnalyzed: 500,
        interactiveElementsAnalyzed: 20,
        iframeCount: 0,
        shadowRootCount: 0,
        snapshotsCompared: 2,
      },
    });

    await waitFor(() =>
      expect(screen.getByText("88/100 · GOOD")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(
        "This page's DOM is generally reliable for Apty element selection, with minor risks.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /recheck/i }),
    ).toBeInTheDocument();
  });

  it("renders an honest error state without a score when the audit is unavailable", async () => {
    mockRunDomHealthAudit.mockResolvedValue({
      available: false,
      error: "This page does not allow DOM inspection.",
    });

    render(<DomHealthCard />);
    fireEvent.click(screen.getByRole("button", { name: /check dom health/i }));

    expect(
      await screen.findByText("Unable to audit this page."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This page does not allow DOM inspection."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\/100/)).not.toBeInTheDocument();
  });

  it("disables the check button when there is no target tab", () => {
    mockUseCurrentTarget.mockReturnValue({
      tabId: null,
      title: null,
      hostname: null,
    });

    render(<DomHealthCard />);

    expect(
      screen.getByRole("button", { name: /check dom health/i }),
    ).toBeDisabled();
  });
});
