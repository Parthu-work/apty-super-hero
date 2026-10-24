import type {
  DomConfigApplicationCapture,
  DomConfigCaptureOptions,
  DomConfigCaptureOutcome,
  DomConfigReport,
  DomProfileV2,
} from "@apty/browser-runtime/apty/dom-config/index";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

import { buildReportFromCapture } from "@apty/browser-runtime/apty/dom-config/index";
import { DebuggingWelcomeScreen } from "../debugging-welcome-screen";
import { DomHealthCard } from "../dom-health-card";
import { DomConfigCard } from "./dom-config-card";
import { createDomConfigStore, domConfigStore } from "./dom-config-store";

const ORIGIN = "https://app.example.test";
const TAB_ID = 5;

function profile(attributes: DomProfileV2["attributes"]): DomProfileV2 {
  return {
    schema: 2,
    tags: { html: 1, head: 1, body: 1, div: 4 },
    attributes,
    maxZIndex: 10,
    zIndexSources: [],
    frames: [],
    shadow: [],
    meta: {
      elementCount: 7,
      urlShape: `${ORIGIN}/home`,
      aptyPresent: false,
      extensionNoisePresent: false,
    },
  };
}

function runOf(
  label: "initial" | "after-reload",
  load: number,
): DomConfigApplicationCapture["pages"][number]["runs"][number] {
  return {
    meta: {
      label,
      capturedAt: `2026-10-24T08:0${load}:00.000Z`,
      urlShape: `${ORIGIN}/home`,
      aptyPresent: false,
      extensionNoisePresent: false,
    },
    profile: profile({
      id: { [`ui-id-${load}`]: 1, [`ui-id-${load + 1}`]: 1, main: 1 },
      href: { [`/a?nocache=${load}`]: 1 },
      "data-row-id": { "98765": 1 },
      "aria-expanded": { true: 1 },
      name: { search: 1 },
    }),
  };
}

const CAPTURE: DomConfigApplicationCapture = {
  applicationName: "app.example.test",
  pages: [
    {
      pageId: `${ORIGIN}/home`,
      label: `${ORIGIN}/home`,
      runs: [runOf("initial", 1), runOf("after-reload", 3)],
    },
  ],
};

function outcome(
  patch: Partial<Extract<DomConfigCaptureOutcome, { available: true }>> = {},
): DomConfigCaptureOutcome {
  return {
    available: true,
    capture: CAPTURE,
    inventory: [],
    states: [
      {
        pageId: `${ORIGIN}/home`,
        runs: CAPTURE.pages[0]!.runs,
        frames: [],
        revisitIssue: null,
        failedRuns: [],
      },
    ],
    limitsReached: { maxPages: false, maxTotalMs: false },
    aborted: false,
    returnedToSeed: { success: true, reason: null },
    ...buildReportFromCapture(CAPTURE),
    ...patch,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let clipboard: string[];
let downloads: Blob[];
let tabUrl: string;
let store: ReturnType<typeof createDomConfigStore>;

beforeEach(() => {
  vi.clearAllMocks();
  store = createDomConfigStore();
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

function renderCard() {
  return render(<DomConfigCard store={store} />);
}

async function openStartPanel() {
  renderCard();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Generate DOM config for this application",
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Start generating the DOM config" }),
    ).toBeEnabled(),
  );
}

async function showReport(result: DomConfigCaptureOutcome = outcome()) {
  mockRunDomConfigCapture.mockResolvedValue(result);
  await openStartPanel();
  fireEvent.click(
    screen.getByRole("button", { name: "Start generating the DOM config" }),
  );
  await screen.findByRole("tablist", { name: "Report sections" });
}

function report(): DomConfigReport {
  return store.getState().report!;
}

describe("DomConfigCard", () => {
  it("is idle until asked, and never captures on its own", () => {
    renderCard();
    expect(screen.getByText("Not generated yet")).toBeInTheDocument();
    expect(mockRunDomConfigCapture).not.toHaveBeenCalled();
  });

  it("runs 'This page only' as one page in safe mode with the chosen options", async () => {
    mockRunDomConfigCapture.mockResolvedValue(outcome());
    await openStartPanel();
    fireEvent.click(screen.getByLabelText("This page only"));
    fireEvent.change(screen.getByLabelText("Runs per page"), {
      target: { value: "3" },
    });
    fireEvent.click(
      screen.getByLabelText(
        "Measure page behavior (a short probe on each page)",
      ),
    );
    expect(
      screen.getByText(
        "This tab will load this page again for the second run. Unsaved input on it can be lost.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Start generating the DOM config" }),
    );
    await screen.findByText("Report ready");
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
    fireEvent.click(
      screen.getByLabelText(
        "Whole application: deep (also clicks menus and tabs)",
      ),
    );
    const start = screen.getByRole("button", {
      name: "Start generating the DOM config",
    });
    expect(start).toBeDisabled();
    fireEvent.click(
      screen.getByLabelText(
        "I understand that deep mode clicks menus, tabs and tree items on the live application.",
      ),
    );
    fireEvent.click(start);
    await screen.findByText("Report ready");
    expect(mockRunDomConfigCapture).toHaveBeenCalledWith(
      TAB_ID,
      expect.objectContaining({
        discoveryMode: "application-deep",
        maxPages: 20,
      }),
    );
  });

  it("shows progress from the run's events in order, then the outcome's chips", async () => {
    const pending = deferred<DomConfigCaptureOutcome>();
    let options: DomConfigCaptureOptions = {};
    mockRunDomConfigCapture.mockImplementation((_tab, o) => {
      options = o;
      return pending.promise;
    });
    await openStartPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "Start generating the DOM config" }),
    );
    const current = () =>
      screen
        .getByRole("list", { name: "Progress" })
        .querySelector("[aria-current='step']")?.textContent;
    expect(current()).toBe("Discover");

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
    expect(current()).toBe("Capture");
    expect(
      screen.getByText("Capturing page 1 of up to 20"),
    ).toBeInTheDocument();
    act(() =>
      options.onProgress?.({
        phase: "revisiting",
        stateIndex: 1,
        urlShape: `${ORIGIN}/calendar`,
      }),
    );
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
    expect(screen.getByText("Run 1, initial: done")).toBeInTheDocument();
    expect(
      screen.getByText("Run 2, after reload: running"),
    ).toBeInTheDocument();
    act(() => options.onProgress?.({ phase: "analyzing" }));
    expect(current()).toBe("Analyze");

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
    expect(
      screen.getByText("Run 2, after reload: different state"),
    ).toBeInTheDocument();
    expect(screen.getByText("Run 3, repeat: failed")).toBeInTheDocument();
    expect(screen.getByText("7 elements")).toBeInTheDocument();
  });

  it("stops through the abort signal and flags the report as partial", async () => {
    const pending = deferred<DomConfigCaptureOutcome>();
    let signal: AbortSignal | undefined;
    mockRunDomConfigCapture.mockImplementation((_tab, o) => {
      signal = o.signal;
      return pending.promise;
    });
    await openStartPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "Start generating the DOM config" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Stop and build a report from what was captured",
      }),
    );
    expect(signal?.aborted).toBe(true);
    expect(
      screen.getByText("Stopping after the current step"),
    ).toBeInTheDocument();
    await act(async () => pending.resolve(outcome({ aborted: true })));
    expect(screen.getByText("Partial report ready")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Partial report: the run was stopped before every page was captured.",
      ),
    ).toBeInTheDocument();
  });

  it("re-runs the analysis on the held capture without capturing again", async () => {
    await showReport();
    mockBuildReportFromCapture.mockClear();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Re-run analysis on the captured runs, without capturing again",
      }),
    );
    expect(mockBuildReportFromCapture).toHaveBeenCalledWith(CAPTURE, {
      ignoredRoots: [],
    });
    expect(mockRunDomConfigCapture).toHaveBeenCalledTimes(1);
  });

  it("says when there is no tab, and never starts", async () => {
    mockUseCurrentTarget.mockReturnValue({
      tabId: null,
      title: null,
      hostname: null,
    });
    renderCard();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Generate DOM config for this application",
      }),
    );
    expect(
      screen.getByText(
        "Open a web page in this window to generate its DOM config.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start generating the DOM config" }),
    ).toBeDisabled();
  });

  it("names why a browser page cannot be analyzed", async () => {
    tabUrl = "chrome://settings/";
    renderCard();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Generate DOM config for this application",
      }),
    );
    expect(
      await screen.findByText(
        "This page cannot be analyzed: browser and extension pages do not allow content scripts.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start generating the DOM config" }),
    ).toBeDisabled();
  });

  it("shows the engine's error when the capture is unavailable", async () => {
    mockRunDomConfigCapture.mockResolvedValue({
      available: false,
      error: "The target tab could not be found — it may have been closed.",
    });
    await openStartPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "Start generating the DOM config" }),
    );
    expect(
      await screen.findByText("The DOM config could not be generated."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The target tab could not be found — it may have been closed.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("exports exactly the rules ticked on screen, review and record-specific ones only when chosen", async () => {
    await showReport();
    const rules = report().rules;
    const main = rules.find((r) => r.group === "main")!;
    const reviewRule = rules.find((r) => r.group === "review")!;
    const record = rules.find((r) => r.group === "record-specific")!;
    expect([main, reviewRule, record].every(Boolean)).toBe(true);

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

    fireEvent.click(
      screen.getByRole("button", {
        name: "Export Markdown of the report, with the included rules only",
      }),
    );
    const markdown = await downloads.at(-1)!.text();
    const ticked = new Set(
      screen
        .getAllByRole("checkbox", { name: /^Include the rule / })
        .filter((box) => (box as HTMLInputElement).checked)
        .map((box) => box.getAttribute("aria-label")),
    );
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

    fireEvent.click(
      screen.getByRole("button", {
        name: "Export JSON of the engine report, with the included rules only",
      }),
    );
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

  it("copies a tile's value, a section as a table and every section without excluded rules", async () => {
    await showReport();
    fireEvent.click(
      screen.getByRole("button", { name: "Copy Attribute priority" }),
    );
    await waitFor(() =>
      expect(clipboard.at(-1)).toBe(report().attributePriority.value),
    );
    expect(
      await screen.findByText("Copied Attribute priority"),
    ).toBeInTheDocument();

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

    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy as tables: every section, with the included rules only",
      }),
    );
    await waitFor(() => expect(clipboard).toHaveLength(3));
    const record = report().rules.find((r) => r.group === "record-specific")!;
    expect(clipboard.at(-1)).not.toContain(record.conditions.at(-1)!.value);
    expect(clipboard.at(-1)).toContain("Setting\tValue\tBasis\tReason");
  });

  it("shows both container score threshold values and the basis of every setting", async () => {
    await showReport();
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(
      screen.getAllByText(
        "75 in the reference configurations, 0.5 in the reconstructed model. The units may differ (open question).",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/^What was not measured: /)).toBeInTheDocument();
  });
});

describe("tab lock", () => {
  it("disables DOM Health while DOM Config crawls the tab", async () => {
    const pending = deferred<DomConfigCaptureOutcome>();
    mockRunDomConfigCapture.mockReturnValue(pending.promise);
    render(
      <>
        <DomHealthCard />
        <DomConfigCard store={store} />
      </>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Generate DOM config for this application",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Start generating the DOM config" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start generating the DOM config" }),
    );
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
        <DomHealthCard />
        <DomConfigCard store={store} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Audit application" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Generate DOM config for this application",
      }),
    );
    expect(
      await screen.findByText(
        "DOM Health is auditing this tab. Wait for it to finish.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start generating the DOM config" }),
    ).toBeDisabled();
    await act(async () =>
      pending.resolve({ available: false, error: "stopped for the test" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Start generating the DOM config" }),
      ).toBeEnabled(),
    );
    expect(mockRunDomConfigCapture).not.toHaveBeenCalled();
  });
});

describe("welcome screen tile", () => {
  it("opens the DOM Config card instead of sending a message", () => {
    const onSuggestionClick = vi.fn();
    domConfigStore.setExpanded(false);
    render(<DebuggingWelcomeScreen onSuggestionClick={onSuggestionClick} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /Generate DOM config: capture this application's pages/,
      }),
    );
    expect(domConfigStore.getState().expanded).toBe(true);
    expect(onSuggestionClick).not.toHaveBeenCalled();
  });
});
