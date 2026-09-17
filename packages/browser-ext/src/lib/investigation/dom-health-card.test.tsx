import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseChatContext = vi.hoisted(() => vi.fn());
const mockUseCurrentTarget = vi.hoisted(() => vi.fn());
const mockRunDomHealthAudit = vi.hoisted(() => vi.fn());
const mockRunApplicationDomHealthAudit = vi.hoisted(() => vi.fn());

vi.mock("@aipexstudio/aipex-react/components/chatbot", () => ({
  useChatContext: mockUseChatContext,
}));

vi.mock("./use-current-target", () => ({
  useCurrentTarget: mockUseCurrentTarget,
}));

vi.mock("@aipexstudio/browser-runtime", () => ({
  runDomHealthAudit: mockRunDomHealthAudit,
  runApplicationDomHealthAudit: mockRunApplicationDomHealthAudit,
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
        /Scanning DOM|Generating selector candidates|Testing selector uniqueness|Testing selector stability|Running hit tests|Building report/,
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
      confidence: "HIGH",
      scope: "page",
      coverage: {
        snapshotsCompared: 3,
        elementsAnalyzed: 20,
        interactiveElementsInPage: 20,
        analysis: {
          candidatesFound: 20,
          candidatesAnalyzed: 20,
          capped: false,
          capReason: null,
        },
      },
      manualSelectorDependency: 5,
      metrics: {
        automaticSelection: 90,
        selectorStability: 85,
        recoveryEfficacy: 90,
        selectorComplexity: 95,
        ambiguityRisk: 95,
        hitTestTargetability: 95,
        domVolatility: 100,
        accessibilitySignal: 90,
      },
      metricDetails: {} as any,
      summary:
        "The score is 88/100 because 18 of 20 analyzed elements were resolved to the intended element by a simulated automatic strategy.",
      strengths: ["90% of analyzed elements can be resolved automatically."],
      risks: [],
      recommendations: [],
      elementSamples: [],
      methodology: ["Collect a DOM snapshot in-page."],
      iframes: { total: 0, accessible: 0, crossOrigin: 0 },
      shadowDom: { roots: 0, elements: 0 },
      zIndex: { maxZIndex: 0, highZIndexElementCount: 0 },
      metadata: {
        elementsAnalyzed: 500,
        interactiveElementsAnalyzed: 20,
        iframeCount: 0,
        shadowRootCount: 0,
        snapshotsCompared: 3,
      },
    });

    await waitFor(() =>
      expect(screen.getByText("88/100 · GOOD")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(
        "The score is 88/100 because 18 of 20 analyzed elements were resolved to the intended element by a simulated automatic strategy.",
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

  it("renders manual selector dependency, strengths, and the element drill-down table", async () => {
    mockRunDomHealthAudit.mockResolvedValue({
      available: true,
      auditId: "a2",
      timestamp: Date.now(),
      url: "https://example.com",
      pageTitle: "Test App",
      score: 52,
      grade: "NEEDS_ATTENTION",
      confidence: "MEDIUM",
      scope: "page",
      coverage: {
        snapshotsCompared: 3,
        elementsAnalyzed: 10,
        interactiveElementsInPage: 10,
        analysis: {
          candidatesFound: 10,
          candidatesAnalyzed: 10,
          capped: false,
          capReason: null,
        },
      },
      manualSelectorDependency: 40,
      metrics: {
        automaticSelection: 60,
        selectorStability: 60,
        recoveryEfficacy: 50,
        selectorComplexity: 50,
        ambiguityRisk: 60,
        hitTestTargetability: 90,
        domVolatility: 90,
        accessibilitySignal: 80,
      },
      metricDetails: {} as any,
      summary: "The score is 52/100 because many elements needed recovery.",
      strengths: ["90% of visible controls passed hit testing."],
      risks: [
        {
          id: "manual-selector-dependency",
          severity: "high",
          title: "Meaningful manual selector dependency",
          evidence: "40% of analyzed elements were not reliably resolved.",
        },
      ],
      recommendations: [],
      elementSamples: [
        {
          tagName: "button",
          classification: "interactive",
          attributes: { dataAttributes: {} },
          outcome: "POSITIONAL_ONLY",
          strategy: "positional",
          bestSelector: "body > button:nth-of-type(3)",
          matchCount: 1,
          ancestorDepthUsed: 1,
          usesPositionalSelector: true,
          dynamicAttributeNames: [],
          stableAttributeNames: [],
          hasAccessibleName: false,
          hitTest: { pointsPassed: 9, classification: "fully-targetable" },
          stability: "CHANGED",
        },
      ],
      methodology: ["Collect a DOM snapshot in-page."],
      iframes: { total: 0, accessible: 0, crossOrigin: 0 },
      shadowDom: { roots: 0, elements: 0 },
      zIndex: { maxZIndex: 0, highZIndexElementCount: 0 },
      metadata: {
        elementsAnalyzed: 200,
        interactiveElementsAnalyzed: 10,
        iframeCount: 0,
        shadowRootCount: 0,
        snapshotsCompared: 3,
      },
    });

    render(<DomHealthCard />);
    fireEvent.click(screen.getByRole("button", { name: /check dom health/i }));

    expect(await screen.findByText("40%")).toBeInTheDocument();
    expect(
      screen.getByText("90% of visible controls passed hit testing."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Meaningful manual selector dependency"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("body > button:nth-of-type(3)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Manual likely (positional)")).toBeInTheDocument();
  });

  it("runs and renders an application-wide audit without touching the page-scope result", async () => {
    mockRunApplicationDomHealthAudit.mockResolvedValue({
      available: true,
      auditId: "app-1",
      timestamp: Date.now(),
      scope: "application",
      score: 65,
      grade: "FAIR",
      confidence: "MEDIUM",
      coverage: {
        pagesDiscovered: 3,
        pagesAudited: 2,
        pagesFailed: 1,
        pagesSkippedUnsafe: 0,
        pagesSkippedDuplicate: 0,
        coveragePercent: 67,
      },
      analysisCoverage: {
        candidatesFound: 20,
        candidatesAnalyzed: 20,
        capped: false,
        capReason: null,
      },
      manualSelectorDependency: 20,
      metrics: {
        automaticSelection: 80,
        selectorStability: 80,
        recoveryEfficacy: 80,
        selectorComplexity: 80,
        ambiguityRisk: 80,
        hitTestTargetability: 80,
        domVolatility: 80,
        accessibilitySignal: 80,
      },
      metricDetails: {} as any,
      summary: "The application score is 65/100.",
      strengths: [],
      risks: [
        {
          id: "incomplete-application-coverage",
          severity: "medium",
          title: "Application discovery/audit coverage is incomplete",
          evidence: "3 page(s) discovered, 2 audited, 1 failed.",
        },
      ],
      recommendations: [],
      pages: [
        {
          url: "https://example.com/",
          title: "Home",
          discoverySource: "seed",
          status: "completed",
          result: { score: 90 },
        },
        {
          url: "https://example.com/orders",
          title: "Orders",
          discoverySource: "same-origin-link",
          status: "completed",
          result: { score: 40 },
        },
        {
          url: "https://example.com/broken",
          title: null,
          discoverySource: "same-origin-link",
          status: "failed",
        },
      ],
      methodology: ["Discover same-origin pages via real <a href> elements."],
    });

    render(<DomHealthCard />);
    fireEvent.click(screen.getByRole("button", { name: /audit application/i }));

    expect(mockRunApplicationDomHealthAudit).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(await screen.findByText("65/100 · FAIR")).toBeInTheDocument();
    expect(
      screen.getByText("Application discovery/audit coverage is incomplete"),
    ).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Orders")).toBeInTheDocument();
    expect(mockRunDomHealthAudit).not.toHaveBeenCalled();
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
    expect(
      screen.getByRole("button", { name: /audit application/i }),
    ).toBeDisabled();
  });
});
