import type {
  DomConfigCaptureOptions,
  DomConfigCaptureOutcome,
  DomConfigReport,
} from "@apty/browser-runtime/apty/dom-config/index";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUseChatContext = vi.hoisted(() => vi.fn());
const mockUseCurrentTarget = vi.hoisted(() => vi.fn());
const mockRunDomConfigCapture = vi.hoisted(() => vi.fn());
const mockBuildReportFromCapture = vi.hoisted(() => vi.fn());
const mockRunApplicationDomHealthAudit = vi.hoisted(() => vi.fn());

vi.mock("@apty/ui/components/chatbot", () => ({
  useChatContext: mockUseChatContext,
}));

vi.mock("../use-current-target", () => ({
  useCurrentTarget: mockUseCurrentTarget,
}));

vi.mock(
  "@apty/browser-runtime/apty/dom-config/index",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@apty/browser-runtime/apty/dom-config/index")
      >();
    mockBuildReportFromCapture.mockImplementation(
      actual.buildReportFromCapture,
    );
    return {
      ...actual,
      runDomConfigCapture: mockRunDomConfigCapture,
      buildReportFromCapture: mockBuildReportFromCapture,
    };
  },
);

vi.mock("@apty/browser-runtime", () => ({
  runDomHealthAudit: vi.fn(),
  runApplicationDomHealthAudit: mockRunApplicationDomHealthAudit,
  startRouteProbe: vi.fn(),
  toShareableRouteProbeReport: vi.fn(),
}));

// The page frame (header, context bar) is tested on its own.
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
      <h2>{title}</h2>
      {trailing}
      {children}
      {footer}
      {hint && <p>{hint}</p>}
    </section>
  ),
}));

import { chatHandoff } from "../../../state/chat-handoff";
import { navigationStore } from "../../../state/navigation-store";
import { DomHealthPage } from "../dom-health/dom-health-page";
import { createDomHealthStore } from "../dom-health-store";
import { DomConfigPage } from "./dom-config-page";
import { createDomConfigStore } from "./dom-config-store";
import {
  CAPTURE,
  deferred,
  ORIGIN,
  outcome,
  TAB_ID,
} from "./dom-config-test-fixtures";

let clipboard: string[];
let downloads: Blob[];
let tabUrl: string;
let store: ReturnType<typeof createDomConfigStore>;

beforeEach(() => {
  vi.clearAllMocks();
  store = createDomConfigStore();
  act(() => navigationStore.openPage("dom-config"));
  clipboard = [];
  downloads = [];
  tabUrl = `${ORIGIN}/home`;
  mockUseChatContext.mockReturnValue({ sessionId: "session-1" });
  mockUseCurrentTarget.mockReturnValue({
    tabId: TAB_ID,
    title: "App",
    hostname: "app.example.test",
  });
  Object.assign(chrome.tabs, {
    get: vi.fn(async () => ({ id: TAB_ID, url: tabUrl })),
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async (text: string) => {
        clipboard.push(text);
      }),
    },
  });
  vi.mocked(URL.createObjectURL).mockImplementation((blob) => {
    downloads.push(blob as Blob);
    return "blob:mock-url";
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage() {
  return render(<DomConfigPage store={store} />);
}

const startButton = () => screen.getByRole("button", { name: "Start capture" });

async function openStartPanel() {
  renderPage();
  await waitFor(() => expect(startButton()).toBeEnabled());
}

async function showReport(result: DomConfigCaptureOutcome = outcome()) {
  mockRunDomConfigCapture.mockResolvedValue(result);
  await openStartPanel();
  fireEvent.click(startButton());
  await screen.findByText("Capture complete");
}

/** Opens a row of the results page: a proposed setting or a detail. */
function openRow(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function back() {
  act(() => navigationStore.back());
}

/** "Export results" opens a menu; Radix opens it from the keyboard in jsdom. */
function exportAs(name: "Markdown" | "JSON" | "Copy all") {
  fireEvent.keyDown(screen.getByRole("button", { name: "Export results" }), {
    key: "Enter",
  });
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

function report(): DomConfigReport {
  return store.getState().report!;
}

describe("DomConfigPage", () => {
  it("waits for Start, and never captures on its own", () => {
    renderPage();
    expect(startButton()).toBeEnabled();
    expect(mockRunDomConfigCapture).not.toHaveBeenCalled();
  });

  it("says what it proposes, and summarizes the advanced options it will use", async () => {
    await openStartPanel();
    fireEvent.click(screen.getByRole("button", { name: "What it proposes" }));
    expect(
      screen.getByText(
        "Ignore conditions, attribute priority, DOM change debounce, max z-index, Shadow DOM and ignored DOM events.",
      ),
    ).toBeInTheDocument();
    const advanced = screen.getByRole("button", { name: /^Advanced options/ });
    expect(advanced).toHaveTextContent(
      "2 runs per page · 20 pages · 10 min · probe on",
    );
    expect(advanced).toHaveAttribute("aria-expanded", "false");
  });

  it("runs 'This page only' as one page in safe mode with the chosen options", async () => {
    mockRunDomConfigCapture.mockResolvedValue(outcome());
    await openStartPanel();
    fireEvent.click(screen.getByLabelText(/^This page only/));
    openRow(/^Advanced options/);
    fireEvent.change(screen.getByLabelText("Runs per page"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByLabelText(/^Measure page behavior/));
    expect(screen.getByLabelText("Page limit")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^Advanced options/ }),
    ).toHaveTextContent("3 runs per page · 1 page · 10 min · probe off");
    expect(
      screen.getByText(
        "This tab will load this page again for the second run. Unsaved input on it can be lost.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(startButton());
    await screen.findByText("Capture complete");
    expect(mockRunDomConfigCapture).toHaveBeenCalledWith(
      TAB_ID,
      expect.objectContaining({
        discoveryMode: "application-safe",
        maxPages: 1,
        runsPerState: 3,
        probe: false,
        maxTotalMs: 600_000,
      }),
    );
  });

  it("starts deep mode only after the clicking is confirmed", async () => {
    mockRunDomConfigCapture.mockResolvedValue(outcome());
    await openStartPanel();
    expect(
      screen.getByText(
        "This tab will navigate through several pages and load each of them more than once. Unsaved input on those pages can be lost.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/^Whole application: deep/));
    expect(startButton()).toBeDisabled();
    fireEvent.click(
      screen.getByLabelText(
        "I understand that deep mode clicks menus, tabs and tree items on the live application.",
      ),
    );
    fireEvent.click(startButton());
    await screen.findByText("Capture complete");
    expect(mockRunDomConfigCapture).toHaveBeenCalledWith(
      TAB_ID,
      expect.objectContaining({
        discoveryMode: "application-deep",
        maxPages: 20,
      }),
    );
  });

  it("shows the crawl's page, run and time while it runs, then the outcome's chips under Pages", async () => {
    const pending = deferred<DomConfigCaptureOutcome>();
    let options: DomConfigCaptureOptions = {};
    mockRunDomConfigCapture.mockImplementation((_tab, o) => {
      options = o;
      return pending.promise;
    });
    await openStartPanel();
    fireEvent.click(startButton());
    expect(
      await screen.findByText("Starting on the current page"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This tab is navigating through your application."),
    ).toBeInTheDocument();
    expect(screen.getByText(/^0:0\d of 10:00 min$/)).toBeInTheDocument();

    act(() =>
      options.onProgress?.({
        phase: "capturing",
        stateIndex: 1,
        maxStates: 20,
        urlShape: `${ORIGIN}/calendar`,
        runIndex: 1,
        runCount: 2,
        runLabel: "initial",
      }),
    );
    expect(screen.getByText("Capturing page 1 of 20")).toBeInTheDocument();
    act(() =>
      options.onProgress?.({
        phase: "revisiting",
        stateIndex: 1,
        urlShape: `${ORIGIN}/calendar`,
      }),
    );
    // Between runs the page and its number stay.
    expect(screen.getByText("Capturing page 1 of 20")).toBeInTheDocument();
    expect(
      screen.getByText("Loading /calendar again for a fresh visit"),
    ).toBeInTheDocument();
    act(() =>
      options.onProgress?.({
        phase: "capturing",
        stateIndex: 1,
        maxStates: 20,
        urlShape: `${ORIGIN}/calendar`,
        runIndex: 2,
        runCount: 2,
        runLabel: "after-reload",
      }),
    );
    expect(
      screen.getByText("Capturing run 2 of 2 on /calendar after a fresh visit"),
    ).toHaveAttribute("aria-live", "polite");
    const captured = screen.getByRole("region", { name: "Captured so far" });
    expect(captured).toHaveTextContent("/calendar");
    expect(captured).toHaveTextContent("Run 2 of 2");

    await act(async () =>
      pending.resolve(
        outcome({
          states: [
            {
              pageId: `${ORIGIN}/home`,
              runs: [
                CAPTURE.pages[0]!.runs[0]!,
                {
                  ...CAPTURE.pages[0]!.runs[1]!,
                  meta: {
                    ...CAPTURE.pages[0]!.runs[1]!.meta,
                    stateMismatch: true,
                  },
                },
              ],
              frames: [],
              revisitIssue: "state-mismatch (different): heading changed",
              failedRuns: [{ runLabel: "repeat", error: "no answer" }],
            },
          ],
        }),
      ),
    );
    openRow(/^Pages/);
    expect(
      screen.getByText("Run 2, after reload: different state"),
    ).toBeInTheDocument();
    expect(screen.getByText("Run 3, repeat: failed")).toBeInTheDocument();
    expect(screen.getByText("7 elements")).toBeInTheDocument();
  });

  it("stops through the abort signal and flags the results as partial", async () => {
    const pending = deferred<DomConfigCaptureOutcome>();
    let signal: AbortSignal | undefined;
    mockRunDomConfigCapture.mockImplementation((_tab, o) => {
      signal = o.signal;
      return pending.promise;
    });
    await openStartPanel();
    fireEvent.click(startButton());
    fireEvent.click(
      await screen.findByRole("button", { name: "Stop capture" }),
    );
    expect(signal?.aborted).toBe(true);
    expect(
      screen.getByText("Stopping after the current step"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stopping" })).toBeDisabled();
    await act(async () => pending.resolve(outcome({ aborted: true })));
    expect(
      screen.getByText(
        "Partial report: the run was stopped before every page was captured.",
      ),
    ).toBeInTheDocument();
  });

  it("sums up the capture and lists the six proposed settings and the details", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mockRunDomConfigCapture.mockImplementation(async () => {
      now += 521_000;
      return outcome();
    });
    await openStartPanel();
    fireEvent.click(startButton());
    await screen.findByText("Capture complete");

    expect(
      screen.getByText("1 page · 2 runs each · 8 min 41 s"),
    ).toBeInTheDocument();
    expect(screen.getByText("Whole application: safe")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
    const proposed = screen.getByRole("region", { name: "Proposed settings" });
    const rows = within(proposed)
      .getAllByRole("button")
      .map((row) => row.textContent);
    expect(rows).toEqual([
      expect.stringMatching(/^Ignore conditions\d+ of \d+ rules included$/),
      `Attribute priority${report().attributePriority.value}`,
      `DOM change debounce${report().debounce.value} ms`,
      `Max z-index${report().maxZIndex.value}`,
      expect.stringMatching(/^Shadow DOM(On|Off)$/),
      expect.stringMatching(/^Ignore DOM events/),
    ]);
    const details = screen.getByRole("region", { name: "Details" });
    expect(
      within(details)
        .getAllByRole("button")
        .map((row) => row.textContent?.split(/\d/)[0]),
    ).toEqual(["Pages", "Iframes", "Coverage", "Warnings"]);

    openRow(/^Attribute priority/);
    expect(
      screen.getByRole("region", { name: "Proposed settings" }),
    ).toBeInTheDocument();
    back();
    openRow(/^Coverage/);
    expect(
      screen.getByRole("heading", { name: "Coverage" }),
    ).toBeInTheDocument();
  });

  it("re-runs the analysis on the held capture without capturing again", async () => {
    await showReport();
    mockBuildReportFromCapture.mockClear();
    openRow(/^Re-run analysis/);
    expect(mockBuildReportFromCapture).toHaveBeenCalledWith(CAPTURE, {
      ignoredRoots: [],
      coverage: {},
    });
    expect(mockRunDomConfigCapture).toHaveBeenCalledTimes(1);
  });

  it("clears the results and returns to setup", async () => {
    await showReport();
    openRow(/^Clear results/);
    expect(store.getState().report).toBeNull();
    expect(startButton()).toBeInTheDocument();
  });

  it("says when there is no tab, and never starts", async () => {
    mockUseCurrentTarget.mockReturnValue({
      tabId: null,
      title: null,
      hostname: null,
    });
    renderPage();
    expect(startButton()).toBeDisabled();
    expect(startButton()).toHaveAccessibleDescription(
      "Open a web page in this window to generate its DOM config.",
    );
  });

  it("names why a browser page cannot be analyzed", async () => {
    tabUrl = "chrome://settings/";
    renderPage();
    await waitFor(() =>
      expect(startButton()).toHaveAccessibleDescription(
        "This page cannot be analyzed: browser and extension pages do not allow content scripts.",
      ),
    );
    expect(startButton()).toBeDisabled();
  });

  it("shows the engine's error when the capture is unavailable, and offers Run again", async () => {
    mockRunDomConfigCapture.mockResolvedValue({
      available: false,
      error: "The target tab could not be found — it may have been closed.",
    });
    await openStartPanel();
    fireEvent.click(startButton());
    expect(
      await screen.findByText("The DOM config could not be generated."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The target tab could not be found — it may have been closed.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Couldn't finish")).toBeInTheDocument();

    mockRunDomConfigCapture.mockResolvedValue(outcome());
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect(await screen.findByText("Capture complete")).toBeInTheDocument();
    expect(mockRunDomConfigCapture).toHaveBeenCalledTimes(2);
  });

  it("runs again from setup, asking before it replaces pages captured by hand", async () => {
    await showReport();
    act(() => {
      store.importPage({
        pageName: "Allergies modal",
        runs: [
          {
            text: JSON.stringify(CAPTURE.pages[0]!.runs[0]!.profile),
            label: "initial",
          },
        ],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    fireEvent.click(startButton());
    expect(
      screen.getByText(
        "Starting replaces the 2 pages already captured, including the ones you captured by hand or imported. Export the report first to keep them.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep the capture" }));
    expect(mockRunDomConfigCapture).toHaveBeenCalledTimes(1);

    fireEvent.click(startButton());
    fireEvent.click(
      screen.getByRole("button", { name: "Replace them and start" }),
    );
    await waitFor(() =>
      expect(mockRunDomConfigCapture).toHaveBeenCalledTimes(2),
    );
    expect(await screen.findByText("Capture complete")).toBeInTheDocument();
    expect(store.getState().capture?.pages).toHaveLength(1);
  });

  it("exports exactly the rules ticked on screen, review and record-specific ones only when chosen", async () => {
    await showReport();
    const rules = report().rules;
    const main = rules.find((r) => r.group === "main")!;
    const reviewRule = rules.find((r) => r.group === "review")!;
    const record = rules.find((r) => r.group === "record-specific")!;
    expect([main, reviewRule, record].every(Boolean)).toBe(true);

    openRow(/^Ignore conditions/);
    fireEvent.click(screen.getByText(/^Need review/, { selector: "summary" }));
    const reviewBox = screen.getByLabelText(
      `Include the rule ${reviewRule.conditions.map((c) => `${c.category} ${c.operator} ${c.value}`).join(" AND ")}`,
    );
    expect(reviewBox).not.toBeChecked();
    fireEvent.click(reviewBox);
    fireEvent.click(
      screen.getByRole("switch", { name: "Guides target a specific record" }),
    );
    fireEvent.click(
      screen.getByLabelText(
        `Include the rule ${main.conditions.map((c) => `${c.category} ${c.operator} ${c.value}`).join(" AND ")}`,
      ),
    );
    const ticked = new Set(
      screen
        .getAllByRole("checkbox", { name: /^Include the rule / })
        .filter((box) => (box as HTMLInputElement).checked)
        .map((box) => box.getAttribute("aria-label")),
    );
    back();

    exportAs("Markdown");
    const markdown = await downloads.at(-1)!.text();
    for (const rule of rules) {
      const shown = `Include the rule ${rule.conditions.map((c) => `${c.category} ${c.operator} ${c.value}`).join(" AND ")}`;
      const inMarkdown = markdown.includes(
        rule.conditions
          .map((c) => `${c.category} · ${c.operator} · \`${c.value}\``)
          .join(" AND "),
      );
      expect(inMarkdown, shown).toBe(ticked.has(shown));
    }
    expect(
      ticked.has(
        `Include the rule ${main.conditions.map((c) => `${c.category} ${c.operator} ${c.value}`).join(" AND ")}`,
      ),
    ).toBe(false);
    expect(
      screen.getByRole("button", { name: /^Ignore conditions/ }),
    ).toHaveTextContent(
      `${rules.length - 1} of ${rules.length} rules included`,
    );

    exportAs("JSON");
    const json = JSON.parse(await downloads.at(-1)!.text()) as DomConfigReport;
    expect(json.rules.map((r) => r.id).sort()).toEqual(
      [
        reviewRule.id,
        record.id,
        ...rules
          .filter((r) => r.group === "main" && r.id !== main.id)
          .map((r) => r.id),
      ].sort(),
    );
  });

  it("copies a setting's value, a section as a table and every section without excluded rules", async () => {
    await showReport();
    openRow(/^Attribute priority/);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy Attribute priority" }),
    );
    await waitFor(() =>
      expect(clipboard.at(-1)).toBe(report().attributePriority.value),
    );
    expect(
      await screen.findByText("Copied Attribute priority"),
    ).toBeInTheDocument();
    back();

    openRow(/^Ignore conditions/);
    const ids = screen.getByRole("region", { name: "IDs" });
    fireEvent.click(
      within(ids).getByRole("button", { name: "Copy as table: IDs" }),
    );
    await waitFor(() => expect(clipboard).toHaveLength(2));
    const [header, ...rows] = clipboard.at(-1)!.split("\n");
    expect(header).toBe(
      "Conditions\tEvidence\tReason\tPages\tValues covered\tExamples",
    );
    expect(rows).toHaveLength(
      report().rules.filter((r) => r.group === "main" && r.target === "id")
        .length,
    );
    expect(rows[0]!.split("\t")[0]).toMatch(
      /^Attribute Name Equals id AND Attribute Value Regex /,
    );
    expect(rows[0]!.split("\t")[3]).toBe("/home");
    back();

    exportAs("Copy all");
    await waitFor(() => expect(clipboard).toHaveLength(3));
    const record = report().rules.find((r) => r.group === "record-specific")!;
    expect(clipboard.at(-1)).not.toContain(record.conditions.at(-1)!.value);
    expect(clipboard.at(-1)).toContain("Setting\tValue\tBasis\tReason");
    expect(
      await screen.findByText("Copied every section as tables"),
    ).toBeInTheDocument();
  });

  it("reads as exported only after Copy all or an export, until new results arrive", async () => {
    await showReport();
    expect(store.getState().exportedAt).toBeNull();
    expect(
      screen.getByText(
        "Not exported yet. Results are kept in this panel only. Closing the panel loses them unless you export them.",
      ),
    ).toBeInTheDocument();

    openRow(/^Attribute priority/);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy Attribute priority" }),
    );
    await waitFor(() => expect(clipboard).toHaveLength(1));
    expect(store.getState().exportedAt).toBeNull();
    back();

    exportAs("Copy all");
    await waitFor(() => expect(store.getState().exportedAt).not.toBeNull());
    expect(
      screen.getByText(
        "Exported. The results stay in this panel until you close it.",
      ),
    ).toBeInTheDocument();

    await act(async () => {
      await store.start(TAB_ID, [], { replace: true });
    });
    expect(store.getState().exportedAt).toBeNull();

    exportAs("JSON");
    expect(store.getState().exportedAt).not.toBeNull();
  });

  it("asks about the results in a new chat: a draft beside the Markdown export as a chip, nothing sent", async () => {
    await showReport();
    const requested = vi.fn();
    const unsubscribe = chatHandoff.subscribe(requested);
    fireEvent.click(screen.getByRole("button", { name: "Ask about these" }));
    unsubscribe();

    expect(requested).toHaveBeenCalledTimes(1);
    const draft = chatHandoff.take();
    expect(draft?.text).toBe(
      "What do these proposed DOM settings mean, and which should we apply first?",
    );
    expect(draft?.contexts).toEqual([
      expect.objectContaining({
        type: "custom",
        label: "DOM config results",
        value: expect.stringMatching(/^# DOM configuration: /),
      }),
    ]);
    expect(store.getState().exportedAt).toBeNull();
  });

  it("shows both container score threshold values, the basis of every setting and what was not measured", async () => {
    await showReport();
    openRow(/^DOM change debounce/);
    expect(
      screen.getAllByText(
        "75 in the reference configurations, 0.5 in the reconstructed model. The units may differ (open question).",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/^What was not measured: /)).toBeInTheDocument();
  });
});

/** A DOM health store set to audit the whole application. */
function applicationHealthStore() {
  const health = createDomHealthStore();
  health.setScope("application");
  return health;
}

describe("tab lock", () => {
  it("disables DOM Health while DOM Config crawls the tab", async () => {
    const pending = deferred<DomConfigCaptureOutcome>();
    mockRunDomConfigCapture.mockReturnValue(pending.promise);
    render(
      <>
        <DomHealthPage store={applicationHealthStore()} />
        <DomConfigPage store={store} />
      </>,
    );
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    expect(
      await screen.findByText(
        "DOM Config is crawling this tab. Wait for it to finish, or stop it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Audit application" }),
    ).toBeDisabled();
    await act(async () => pending.resolve(outcome()));
    expect(
      screen.getByRole("button", { name: "Audit application" }),
    ).toBeEnabled();
  });

  it("disables DOM Config while DOM Health audits the tab", async () => {
    const pending = deferred<unknown>();
    mockRunApplicationDomHealthAudit.mockReturnValue(pending.promise);
    render(
      <>
        <DomHealthPage store={applicationHealthStore()} />
        <DomConfigPage store={store} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Audit application" }));
    expect(
      await screen.findByText(
        "DOM Health is auditing this tab. Wait for it to finish.",
      ),
    ).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
    await act(async () =>
      pending.resolve({ available: false, error: "stopped for the test" }),
    );
    await waitFor(() => expect(startButton()).toBeEnabled());
    expect(mockRunDomConfigCapture).not.toHaveBeenCalled();
  });
});
