import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseChatContext = vi.hoisted(() => vi.fn());
const mockUseCurrentTarget = vi.hoisted(() => vi.fn());
const mockRunDomHealthAudit = vi.hoisted(() => vi.fn());
const mockRunApplicationDomHealthAudit = vi.hoisted(() => vi.fn());

vi.mock("@apty/ui/components/chatbot", () => ({
  useChatContext: mockUseChatContext,
}));

vi.mock("./use-current-target", () => ({
  useCurrentTarget: mockUseCurrentTarget,
}));

vi.mock("@apty/browser-runtime", () => ({
  runDomHealthAudit: mockRunDomHealthAudit,
  runApplicationDomHealthAudit: mockRunApplicationDomHealthAudit,
  startRouteProbe: vi.fn(),
  toShareableRouteProbeReport: vi.fn(),
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
  it("shows the route probe only with developer tools turned on", () => {
    const { rerender } = render(<DomHealthCard />);
    expect(screen.queryByRole("region", { name: "Route probe" })).toBeNull();

    rerender(<DomHealthCard developerTools />);
    expect(
      screen.getByRole("region", { name: "Route probe" }),
    ).toBeInTheDocument();
  });

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
      evidenceState: "HEALTHY_EVIDENCE",
      frameAccessibility: {
        framesTotal: 1,
        framesAccessible: 1,
        framesFailed: 0,
        framesInaccessible: 0,
      },
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
      iframes: {
        total: 0,
        accessible: 0,
        crossOrigin: 0,
        byTag: { iframe: 0, frame: 0 },
      },
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
      evidenceState: "HEALTHY_EVIDENCE",
      frameAccessibility: {
        framesTotal: 1,
        framesAccessible: 1,
        framesFailed: 0,
        framesInaccessible: 0,
      },
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
          stability: "WRONG_TARGET",
        },
      ],
      methodology: ["Collect a DOM snapshot in-page."],
      iframes: {
        total: 0,
        accessible: 0,
        crossOrigin: 0,
        byTag: { iframe: 0, frame: 0 },
      },
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

  it("never shows a healthy-looking score badge when evidence is NO_EVIDENCE — shows NOT ASSESSED instead", async () => {
    mockRunDomHealthAudit.mockResolvedValue({
      available: true,
      auditId: "a3",
      timestamp: Date.now(),
      url: "https://example.com",
      pageTitle: "Frameset shell",
      score: null,
      grade: "NOT_ASSESSED",
      confidence: "LOW",
      evidenceState: "NO_EVIDENCE",
      frameAccessibility: {
        framesTotal: 1,
        framesAccessible: 1,
        framesFailed: 0,
        framesInaccessible: 0,
      },
      scope: "page",
      coverage: {
        snapshotsCompared: 3,
        elementsAnalyzed: 0,
        interactiveElementsInPage: 0,
        analysis: {
          candidatesFound: 0,
          candidatesAnalyzed: 0,
          capped: false,
          capReason: null,
        },
      },
      manualSelectorDependency: 0,
      metrics: {
        automaticSelection: 100,
        selectorStability: 60,
        recoveryEfficacy: 100,
        selectorComplexity: 100,
        ambiguityRisk: 100,
        hitTestTargetability: 100,
        domVolatility: 100,
        accessibilitySignal: 100,
      },
      metricDetails: {} as any,
      summary: "No interactive elements were found to analyze on this page.",
      strengths: [],
      risks: [],
      recommendations: [],
      elementSamples: [],
      methodology: [],
      iframes: {
        total: 0,
        accessible: 0,
        crossOrigin: 0,
        byTag: { iframe: 0, frame: 0 },
      },
      shadowDom: { roots: 0, elements: 0 },
      zIndex: { maxZIndex: 0, highZIndexElementCount: 0 },
      metadata: {
        elementsAnalyzed: 3,
        interactiveElementsAnalyzed: 0,
        iframeCount: 0,
        shadowRootCount: 0,
        snapshotsCompared: 3,
      },
    });

    render(<DomHealthCard />);
    fireEvent.click(screen.getByRole("button", { name: /check dom health/i }));

    expect(await screen.findByText("NOT ASSESSED")).toBeInTheDocument();
    // Never a numeric score paired with this evidence state.
    expect(screen.queryByText(/\/100/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/No interactive elements were found/),
    ).toBeInTheDocument();
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
      evidenceState: "HEALTHY_EVIDENCE",
      frameAccessibility: {
        framesTotal: 2,
        framesAccessible: 2,
        framesFailed: 0,
        framesInaccessible: 0,
      },
      coverage: {
        pagesDiscovered: 3,
        pagesAudited: 2,
        pagesFailed: 1,
        pagesSkippedUnsafe: 0,
        pagesSkippedDuplicate: 0,
        pagesNotDiscovered: 0,
        coveragePercent: 67,
        coverageLabel: "OBSERVED_COVERAGE",
        discoveryMethod: "anchor-links",
        framesDiscovered: 2,
        framesInspected: 2,
        framesInaccessible: 0,
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
      traversal: {
        mode: "click-first",
        reason:
          "The seed state has 0 distinct link target(s) and 2 navigation control(s): navigation is by click.",
        clicksAllowed: true,
        evidence: {},
        history: [],
      },
    });

    render(<DomHealthCard />);
    fireEvent.click(screen.getByRole("button", { name: /audit application/i }));

    expect(mockRunApplicationDomHealthAudit).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(await screen.findByText("click-first")).toBeInTheDocument();
    expect(
      screen.getByText(/0 distinct link target\(s\) and 2 navigation control/),
    ).toBeInTheDocument();
    expect(await screen.findByText("65/100 · FAIR")).toBeInTheDocument();
    expect(
      screen.getByText("Application discovery/audit coverage is incomplete"),
    ).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Orders")).toBeInTheDocument();
    expect(mockRunDomHealthAudit).not.toHaveBeenCalled();
  });

  it("passes the selected discovery mode through to runApplicationDomHealthAudit, defaulting to safe link discovery", async () => {
    mockRunApplicationDomHealthAudit.mockResolvedValue({
      available: true,
      auditId: "app-2",
      timestamp: Date.now(),
      scope: "page",
      scopeLabel: "CURRENT_PAGE",
      score: 91,
      grade: "EXCELLENT",
      confidence: "LOW",
      evidenceState: "INCOMPLETE_EVIDENCE",
      frameAccessibility: {
        framesTotal: 1,
        framesAccessible: 1,
        framesFailed: 0,
        framesInaccessible: 0,
      },
      coverage: {
        pagesDiscovered: 1,
        pagesAudited: 1,
        pagesFailed: 0,
        pagesSkippedUnsafe: 0,
        pagesSkippedDuplicate: 0,
        pagesNotDiscovered: 0,
        coveragePercent: 100,
        coverageLabel: "OBSERVED_COVERAGE",
        discoveryMethod: "anchor-links",
        framesDiscovered: 1,
        framesInspected: 1,
        framesInaccessible: 0,
      },
      analysisCoverage: {
        candidatesFound: 7,
        candidatesAnalyzed: 7,
        capped: false,
        capReason: null,
      },
      manualSelectorDependency: 0,
      metrics: {
        automaticSelection: 100,
        selectorStability: 60,
        recoveryEfficacy: 100,
        selectorComplexity: 100,
        ambiguityRisk: 100,
        hitTestTargetability: 14,
        domVolatility: 100,
        accessibilitySignal: 0,
      },
      metricDetails: {
        automaticSelection: {
          totalAnalyzed: 7,
          directSuccess: 7,
          recoveredByIgnore: 0,
          recoveredByPartial: 0,
          recoveredByContext: 0,
          directSuccessRate: 100,
          recoveredSuccessRate: 0,
          manualDependencyRate: 0,
        },
        hitTestTargetability: {
          tested: 7,
          fullyTargetable: 1,
          partiallyTargetable: 0,
          occludedOrHidden: 6,
        },
        accessibilitySignal: { totalInteractive: 7, missingAccessibleName: 7 },
      } as any,
      selectorConfiguration: {
        source: "default",
        detail: "Default/reconstructed DES configuration.",
      },
      crossStateEvidence: {
        attempted: 0,
        directStable: 0,
        recoveredStable: 0,
        positionalStable: 0,
        wrongTarget: 0,
        notResolved: 0,
        statesTested: 0,
      },
      summary: "Evidence was incomplete.",
      strengths: [],
      risks: [],
      recommendations: [],
      pages: [
        {
          url: "https://example.com/",
          title: "Home",
          discoverySource: "seed",
          status: "completed",
          result: { score: 91, grade: "EXCELLENT", metricDetails: {} as any },
        },
      ],
      methodology: [],
    });

    render(<DomHealthCard />);

    fireEvent.change(
      screen.getByRole("combobox", { name: /application discovery mode/i }),
      { target: { value: "page" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /audit application/i }));

    expect(mockRunApplicationDomHealthAudit).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ discoveryMode: "page" }),
    );

    // Never presents an INCOMPLETE_EVIDENCE, single-page result as if it
    // were application-wide health (spec sections 1/18).
    expect(
      await screen.findByText(/Observed current-page DOM health: 91\/100/i),
    ).toBeInTheDocument();
    // Hit-test and accessibility failures stay visible even though the
    // headline score is high (spec sections 10-11).
    expect(screen.getByText("6/7")).toBeInTheDocument();
    expect(screen.getByText("7/7")).toBeInTheDocument();
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

  it("puts the title toggle and the action buttons on separate rows (not one unbreakable row that squeezes the title at narrow widths)", () => {
    render(<DomHealthCard />);

    const titleToggle = screen.getByRole("button", { name: /dom health:/i });
    const checkButton = screen.getByRole("button", {
      name: /check dom health/i,
    });

    // The title toggle and the action buttons must not be flex siblings in
    // the same row — that's exactly the layout that squeezed the title to
    // nothing at narrow widths. The title toggle sits directly in the
    // header container; the action buttons sit one level deeper, inside
    // their own wrapping row — so the title's parent is the action row's
    // grandparent, not its parent.
    expect(titleToggle.parentElement).not.toBe(checkButton.parentElement);
    expect(titleToggle.parentElement).toBe(
      checkButton.parentElement?.parentElement,
    );

    // The action row wraps instead of forcing everything onto one line.
    expect(checkButton.parentElement?.className).toContain("flex-wrap");
  });
});
