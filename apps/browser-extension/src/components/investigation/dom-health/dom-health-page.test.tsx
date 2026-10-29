import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseChatContext = vi.hoisted(() => vi.fn());
const mockUseCurrentTarget = vi.hoisted(() => vi.fn());
const mockRunDomHealthAudit = vi.hoisted(() => vi.fn());
const mockRunApplicationDomHealthAudit = vi.hoisted(() => vi.fn());

vi.mock("@apty/ui/components/chatbot", () => ({
  useChatContext: mockUseChatContext,
}));

vi.mock("../use-current-target", () => ({
  useCurrentTarget: mockUseCurrentTarget,
}));

// The shell's header and context bar are tested on their own.
vi.mock("../../shell/tool-page-shell", () => ({
  ToolPageShell: ({
    title,
    trailing,
    children,
    footer,
    hint,
  }: {
    title: string;
    trailing?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    hint?: string;
  }) => (
    <section aria-label={title}>
      {trailing}
      {children}
      {footer}
      {hint && <p>{hint}</p>}
    </section>
  ),
}));

vi.mock("@apty/browser-runtime", () => ({
  runDomHealthAudit: mockRunDomHealthAudit,
  runApplicationDomHealthAudit: mockRunApplicationDomHealthAudit,
  startRouteProbe: vi.fn(),
  toShareableRouteProbeReport: vi.fn(),
  // The bundle's own redaction is tested in ask-about-result.test.ts.
  buildValidationBundle: () => ({ schema: "apty-dom-health-validation/1" }),
  resolveThresholds: () => ({}),
  chromeVersionFrom: () => null,
}));

import type {
  ApplicationAuditOutcome,
  DomHealthAuditOutcome,
} from "@apty/browser-runtime";
import { I18nProvider } from "@apty/ui/i18n/context";
import { chatHandoff } from "../../../state/chat-handoff";
import { navigationStore } from "../../../state/navigation-store";
import { acquireTabLock, releaseTabLock } from "../dom-config/tab-lock";
import { createDomHealthStore, type DomHealthStore } from "../dom-health-store";
import { DomHealthPage } from "./dom-health-page";

let store: DomHealthStore;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The fields the result view reads; the breakdown's tests carry full results. */
function scoredPage(score: number): DomHealthAuditOutcome {
  return {
    available: true,
    auditId: "p",
    timestamp: Date.now(),
    score,
    grade: "GOOD",
    confidence: "HIGH",
    coverage: {
      analysis: {
        candidatesFound: 10,
        candidatesAnalyzed: 10,
        capped: false,
        capReason: null,
      },
    },
  } as unknown as DomHealthAuditOutcome;
}

function chooseWholeApplication() {
  fireEvent.click(screen.getByRole("radio", { name: /^Whole application/ }));
}

/** The result's "Full breakdown" view. */
async function openBreakdown() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Full breakdown" }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  store = createDomHealthStore();
  act(() => navigationStore.openPage("dom-health"));
  mockUseChatContext.mockReturnValue({ sessionId: "session-1" });
  mockUseCurrentTarget.mockReturnValue({
    tabId: 5,
    title: "Test App",
    hostname: "example.com",
    inspectable: true,
    detail: "Ready to inspect example.com.",
    checking: false,
  });
});

describe("DomHealthPage", () => {
  it("shows the route probe only with developer tools turned on", () => {
    const { rerender } = render(<DomHealthPage store={store} />);
    expect(screen.queryByRole("region", { name: "Route probe" })).toBeNull();

    rerender(<DomHealthPage store={store} developerTools />);
    expect(
      screen.getByRole("region", { name: "Route probe" }),
    ).toBeInTheDocument();
  });

  it("shows 'Not checked yet' and never runs an audit automatically", () => {
    render(<DomHealthPage store={store} />);

    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
    expect(mockRunDomHealthAudit).not.toHaveBeenCalled();
  });

  it("shows a loading state while the audit is running, then the result", async () => {
    const pending = deferred<unknown>();
    mockRunDomHealthAudit.mockReturnValue(pending.promise);

    render(<DomHealthPage store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Check this page" }));

    expect(mockRunDomHealthAudit).toHaveBeenCalledWith(5, { ignoredRoots: [] });
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
      metricDetails: {} as never,
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

    expect(
      await screen.findByRole("img", { name: "Score 88 out of 100" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(screen.getByText("High confidence")).toBeInTheDocument();
    expect(screen.getByText("This page · Just now")).toBeInTheDocument();
    expect(screen.getByText("20 of 20 elements analyzed")).toBeInTheDocument();
    // Full coverage at high confidence: the score is not a first read.
    expect(screen.queryByText(/first read/)).toBeNull();
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Export validation bundle" }),
    ).toBeEnabled();

    await openBreakdown();
    expect(
      screen.getByText(
        "The score is 88/100 because 18 of 20 analyzed elements were resolved to the intended element by a simulated automatic strategy.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps a check running when its page is left, and shows the outcome on return", async () => {
    const pending = deferred<unknown>();
    mockRunDomHealthAudit.mockReturnValue(pending.promise);
    const { unmount } = render(<DomHealthPage store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Check this page" }));

    unmount();
    pending.resolve({ available: false, error: "The tab was closed." });
    await waitFor(() => expect(store.getState().running).toBeNull());

    render(<DomHealthPage store={store} />);
    expect(screen.getByText("Unable to audit this page.")).toBeInTheDocument();
    expect(screen.getByText("The tab was closed.")).toBeInTheDocument();
    expect(mockRunDomHealthAudit).toHaveBeenCalledTimes(1);
  });

  it("renders an honest error state without a score when the audit is unavailable", async () => {
    mockRunDomHealthAudit.mockResolvedValue({
      available: false,
      error: "This page does not allow DOM inspection.",
    });

    render(<DomHealthPage store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Check this page" }));

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
      metricDetails: {} as never,
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
          explanation: {
            howFound: "checkSimplifyNth: Only its position tells it apart.",
            notes: [
              "Across states, the stored path landed on a different element.",
            ],
            fix: "Give each repeated control an attribute that tells it apart.",
          },
        },
      ],
      desEvidence: {
        steps: [
          {
            outcome: "POSITIONAL_ONLY",
            step: "checkSimplifyNth",
            elements: 4,
            meaning: "Only its position among siblings tells it apart.",
          },
        ],
        dynamicValuesLeftOut: [{ attribute: "id", elements: 3 }],
        hitTestReasons: [],
      },
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

    render(<DomHealthPage store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Check this page" }));
    await openBreakdown();

    expect(screen.getByText("40%")).toBeInTheDocument();
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
    expect(
      screen.getByText("checkSimplifyNth: Only its position tells it apart."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Across states, the stored path landed on a different element.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Give each repeated control an attribute that tells it apart.",
      ),
    ).toBeInTheDocument();
    const steps = screen.getByRole("region", {
      name: "How Apty would find these elements",
    });
    expect(steps).toHaveTextContent(
      "4 checkSimplifyNth — Only its position among siblings tells it apart.",
    );
    expect(steps).toHaveTextContent(
      "Left out as dynamic (Ignore Selector): id on 3 element(s).",
    );
  });

  it("passes the Settings ignore list to the audit and shows capped confidence, frames and excluded content", async () => {
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
      metricDetails: {} as never,
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
      confidenceCaps: [
        "No application frame could be inspected (LN); only the frames around it were.",
      ],
      frames: [
        { frameId: 0, key: "top", role: "chrome", status: "captured" },
        { frameId: 5, key: "LN", role: "application", status: "failed" },
      ],
      excludedRoots: [
        {
          matcher: "id:_pendo-",
          owner: "Pendo",
          evidence: "measured",
          roots: 2,
          elementCount: 4,
        },
      ],
    });

    render(
      <DomHealthPage store={store} ignoredRoots={["tag:support-widget"]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Check this page" }));

    expect(mockRunDomHealthAudit).toHaveBeenCalledWith(5, {
      ignoredRoots: ["tag:support-widget"],
    });
    expect(
      await screen.findByText(
        "Medium confidence, so treat 52 as a first read.",
      ),
    ).toBeInTheDocument();

    await openBreakdown();
    expect(
      screen.getByText(
        "Confidence capped: No application frame could be inspected (LN); only the frames around it were.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Frames (2) and excluded content (1)"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Left out Pendo/)).toBeInTheDocument();
  });

  it("never shows a healthy-looking score badge when evidence is NO_EVIDENCE — shows Not assessed instead", async () => {
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
      metricDetails: {} as never,
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

    render(<DomHealthPage store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Check this page" }));

    expect(await screen.findByText("Not assessed")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "No score" })).toBeInTheDocument();
    // Never a numeric score paired with this evidence state.
    expect(screen.queryByText(/\/100|out of 100|first read/)).toBeNull();

    await openBreakdown();
    expect(screen.queryByText(/\/100/)).toBeNull();
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
      scopeLabel: "APPLICATION",
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
      metricDetails: {} as never,
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
          result: { score: 90, metadata: { elementsAnalyzed: 400 } },
        },
        {
          url: "https://example.com/orders",
          title: "Orders",
          discoverySource: "same-origin-link",
          status: "completed",
          result: { score: 40, metadata: { elementsAnalyzed: 654 } },
        },
        {
          url: "https://example.com/broken?favoriteContext=<REDACTED>&view=1",
          title: null,
          discoverySource: "same-origin-link",
          status: "failed",
          failureReason: "Navigation failed",
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

    render(<DomHealthPage store={store} />);
    chooseWholeApplication();
    fireEvent.click(screen.getByRole("button", { name: "Audit application" }));

    expect(mockRunApplicationDomHealthAudit).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        discoveryMode: "application-safe",
        onProgress: expect.any(Function),
      }),
    );
    expect(
      await screen.findByRole("img", { name: "Score 65 out of 100" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Fair")).toBeInTheDocument();
    expect(
      screen.getByText("Whole application · Just now"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("2 of 3 states reached · 1,054 elements"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "1 state was not reached, so the score may change. Treat 65 as a first read.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Whole application · Safe link discovery"),
    ).toBeInTheDocument();
    expect(store.getState().pageOutcome).toBeNull();

    await openBreakdown();
    expect(screen.getByText("click-first")).toBeInTheDocument();
    expect(
      screen.getByText(/0 distinct link target\(s\) and 2 navigation control/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Application DOM health: 65\/100/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Application discovery/audit coverage is incomplete"),
    ).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Orders")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/broken")).toBeInTheDocument();
    expect(screen.queryByText(/favoriteContext/)).toBeNull();
    expect(screen.getByText("Navigation failed")).toBeInTheDocument();
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
        pagesExploredNoNewState: 2,
        coveragePercent: 100,
        coverageLabel: "OBSERVED_COVERAGE",
        discoveryMethod: "anchor-links",
        framesDiscovered: 3,
        framesInspected: 1,
        framesInaccessible: 0,
        framesPlaceholder: 2,
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
          tested: 10,
          fullyTargetable: 1,
          partiallyTargetable: 0,
          hidden: 3,
          notTargetable: 6,
        },
        accessibilitySignal: { totalInteractive: 7, missingAccessibleName: 7 },
      } as never,
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
          result: {
            score: 91,
            grade: "EXCELLENT",
            metricDetails: {} as never,
            metadata: { elementsAnalyzed: 7 },
          },
        },
        {
          url: "https://example.com/#control:header>button",
          title: "Open tab menu",
          discoverySource: "safe-navigation-control",
          status: "explored-no-new-state",
          failureReason:
            "Clicking this control did not produce a new application state.",
        },
      ],
      methodology: [],
    });

    render(<DomHealthPage store={store} />);

    const discovery = screen.getByRole("combobox", { name: "Link discovery" });
    expect(discovery).toBeDisabled();
    chooseWholeApplication();
    fireEvent.change(discovery, { target: { value: "page" } });
    fireEvent.click(screen.getByRole("button", { name: "Audit application" }));

    expect(mockRunApplicationDomHealthAudit).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ discoveryMode: "page" }),
    );
    expect(
      await screen.findByText("Whole application · Current page only"),
    ).toBeInTheDocument();

    // Never presents an INCOMPLETE_EVIDENCE, single-page result as if it
    // were application-wide health (spec sections 1/18).
    await openBreakdown();
    expect(
      screen.getByText(/Observed current-page DOM health: 91\/100/i),
    ).toBeInTheDocument();
    // Hit-test and accessibility failures stay visible even though the
    // headline score is high (spec sections 10-11).
    expect(screen.getByText("6/7")).toBeInTheDocument();
    expect(
      screen.getByText(
        "3 hidden when sampled (closed menus, inactive tabs), not counted.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("7/7")).toBeInTheDocument();
    expect(
      screen.getByText(
        "1/1 frames with content reached, 2 empty placeholder(s) skipped",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Clicked, no new state")).toBeInTheDocument();
    expect(screen.getByText(/2 clicked with no new state/)).toBeInTheDocument();
  });

  it("runs both audits with the developer threshold overrides and offers the validation bundle only once there is evidence", async () => {
    const overrides = { sameUrlRatioForClickFirst: 0.4 };
    mockRunDomHealthAudit.mockResolvedValue({ available: false, error: "x" });
    mockRunApplicationDomHealthAudit.mockResolvedValue({
      available: false,
      error: "y",
    });

    render(<DomHealthPage store={store} thresholdOverrides={overrides} />);
    expect(
      screen.queryByRole("button", { name: "Export validation bundle" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Check this page" }));
    expect(mockRunDomHealthAudit).toHaveBeenCalledWith(5, {
      ignoredRoots: [],
      thresholdOverrides: overrides,
    });
    await waitFor(() => expect(store.getState().running).toBeNull());
    chooseWholeApplication();
    fireEvent.click(screen.getByRole("button", { name: "Audit application" }));
    expect(mockRunApplicationDomHealthAudit).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ thresholdOverrides: overrides }),
    );
    expect(
      await screen.findByText("Unable to run the application audit."),
    ).toBeInTheDocument();
    // Two failures are no evidence to export.
    expect(
      screen.queryByRole("button", { name: "Export validation bundle" }),
    ).toBeNull();

    act(() => navigationStore.openSubView("settings"));
    expect(
      screen.getByText("sameUrlRatioForClickFirst = 0.4"),
    ).toBeInTheDocument();
  });

  it("disables the check button when there is no target tab, and says why", () => {
    mockUseCurrentTarget.mockReturnValue({
      tabId: null,
      title: null,
      hostname: null,
      inspectable: false,
      detail: "No page is open in this window.",
      checking: false,
    });

    render(<DomHealthPage store={store} />);

    expect(
      screen.getByRole("button", { name: "Check this page" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Check this page" }),
    ).toHaveAccessibleDescription(
      "No page selected No page is open in this window.",
    );
    chooseWholeApplication();
    expect(
      screen.getByRole("button", { name: "Audit application" }),
    ).toBeDisabled();
  });

  it("names why Chrome won't let it inspect the page, with the fix, and never starts", () => {
    mockUseCurrentTarget.mockReturnValue({
      tabId: 5,
      title: "Extensions",
      hostname: "extensions",
      inspectable: false,
      detail:
        "Chrome doesn't let extensions inspect chrome: pages. Open the page you want to investigate.",
      checking: false,
    });

    render(<DomHealthPage store={store} />);

    expect(
      screen.getByText("Can't inspect").closest("[data-slot=notice]"),
    ).toHaveAttribute("data-tone", "warning");
    const check = screen.getByRole("button", { name: "Check this page" });
    expect(check).toBeDisabled();
    expect(check).toHaveAccessibleDescription(
      "Can't inspect Chrome doesn't let extensions inspect chrome: pages. Open the page you want to investigate.",
    );
    fireEvent.click(check);
    expect(mockRunDomHealthAudit).not.toHaveBeenCalled();
  });

  it("offers Stop for the whole-application audit only, and stops it between pages", async () => {
    const page = deferred<DomHealthAuditOutcome>();
    mockRunDomHealthAudit.mockReturnValue(page.promise);
    let signal: AbortSignal | undefined;
    mockRunApplicationDomHealthAudit.mockImplementation(
      (_tabId: number, options: { signal?: AbortSignal }) => {
        signal = options.signal;
        return new Promise(() => {});
      },
    );
    render(<DomHealthPage store={store} />);

    fireEvent.click(screen.getByRole("button", { name: "Check this page" }));
    expect(screen.getByText("Checking this page…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop check" })).toBeNull();
    await act(async () => page.resolve({ available: false, error: "x" }));

    chooseWholeApplication();
    fireEvent.click(screen.getByRole("button", { name: "Audit application" }));
    expect(screen.getByText("Auditing the application…")).toBeInTheDocument();
    expect(
      screen.getByText("Keep this tab open until the check ends."),
    ).toBeInTheDocument();
    // What the check covers stays in view, but cannot change mid-check.
    expect(
      screen.getByRole("radio", { name: /^Whole application/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Link discovery" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Stop check" }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Stopping" })).toBeDisabled();
  });

  it("says a stopped audit's score covers only the states it reached", async () => {
    mockRunApplicationDomHealthAudit.mockResolvedValue({
      available: true,
      auditId: "app",
      timestamp: Date.now(),
      score: 70,
      grade: "GOOD",
      confidence: "LOW",
      stopped: true,
      coverage: { pagesAudited: 4, pagesDiscovered: 9, coveragePercent: 44 },
      pages: [],
    } as unknown as ApplicationAuditOutcome);
    store.setScope("application");
    render(<DomHealthPage store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Audit application" }));

    expect(
      await screen.findByText(
        "Stopped before the audit finished. The score covers the 4 states it reached.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "5 states were not reached, so the score may change. Treat 70 as a first read.",
      ),
    ).toBeInTheDocument();
  });

  it("asks about the result in a new chat: a draft beside the evidence chip, nothing sent", async () => {
    mockRunDomHealthAudit.mockResolvedValue(scoredPage(72));
    const requested = vi.fn();
    const unsubscribe = chatHandoff.subscribe(requested);
    render(<DomHealthPage store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Check this page" }));

    expect(
      await screen.findByText("Adds this result to a new chat as evidence."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Ask about this result" }),
    );
    unsubscribe();

    expect(requested).toHaveBeenCalledTimes(1);
    expect(chatHandoff.take()).toEqual({
      text: "What does this DOM health result mean, and what should we fix first?",
      contexts: [
        expect.objectContaining({
          type: "custom",
          label: "DOM health result",
          value: JSON.stringify(
            { schema: "apty-dom-health-validation/1" },
            null,
            2,
          ),
        }),
      ],
    });
    expect(chatHandoff.take()).toBeNull();
  });

  it("says why Check again is unavailable while DOM config crawls the tab", async () => {
    mockRunDomHealthAudit.mockResolvedValue(scoredPage(72));
    render(<DomHealthPage store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Check this page" }));
    const again = await screen.findByRole("button", { name: "Check again" });

    act(() => {
      acquireTabLock(5, "dom-config");
    });
    expect(again).toBeDisabled();
    expect(again).toHaveAccessibleDescription(
      "DOM Config is crawling this tab. Wait for it to finish, or stop it.",
    );
    act(() => releaseTabLock(5, "dom-config"));
    expect(again).toBeEnabled();
  });

  it("switches between the page and application results from Settings, as the card's tabs did", async () => {
    mockRunDomHealthAudit.mockResolvedValue(scoredPage(72));
    render(<DomHealthPage store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Check this page" }));

    fireEvent.click(await screen.findByRole("button", { name: /^Settings/ }));
    chooseWholeApplication();
    act(() => navigationStore.back());
    expect(
      screen.getByRole("button", { name: "Audit application" }),
    ).toBeEnabled();
    expect(screen.getByText("Not checked yet")).toBeInTheDocument();

    act(() => navigationStore.openSubView("settings"));
    fireEvent.click(screen.getByRole("radio", { name: /^This page/ }));
    act(() => navigationStore.back());
    expect(
      screen.getByRole("img", { name: "Score 72 out of 100" }),
    ).toBeInTheDocument();
  });

  it("shows the page in Chinese when the language is set to zh", async () => {
    const languageStorage = {
      load: vi.fn().mockResolvedValue("zh"),
      save: vi.fn(),
      watch: vi.fn(() => () => {}),
    };
    render(
      <I18nProvider storageAdapter={languageStorage as never}>
        <DomHealthPage store={store} />
      </I18nProvider>,
    );

    expect(await screen.findByText("尚未检查")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "检查此页面" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Not checked yet")).toBeNull();
  });
});
