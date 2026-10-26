import type {
  DomConfigApplicationCapture,
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
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUseChatContext = vi.hoisted(() => vi.fn());
const mockUseCurrentTarget = vi.hoisted(() => vi.fn());
const mockRunDomConfigCapture = vi.hoisted(() => vi.fn());
const mockBuildReportFromCapture = vi.hoisted(() => vi.fn());
const mockCaptureCurrentState = vi.hoisted(() => vi.fn());
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
    mockCaptureCurrentState.mockImplementation(actual.captureCurrentState);
    return {
      ...actual,
      runDomConfigCapture: mockRunDomConfigCapture,
      buildReportFromCapture: mockBuildReportFromCapture,
      captureCurrentState: mockCaptureCurrentState,
    };
  },
);

vi.mock("@apty/browser-runtime", () => ({
  runDomHealthAudit: vi.fn(),
  runApplicationDomHealthAudit: mockRunApplicationDomHealthAudit,
  startRouteProbe: vi.fn(),
  toShareableRouteProbeReport: vi.fn(),
}));

// DOM health's page frame (header, context bar) is tested on its own.
vi.mock("../../shell/tool-page-shell", () => ({
  ToolPageShell: ({
    children,
    footer,
  }: {
    children: ReactNode;
    footer?: ReactNode;
  }) => (
    <>
      {children}
      {footer}
    </>
  ),
}));

import {
  buildReportFromCapture,
  DOM_CONFIG_CONSOLE_SCRIPT,
} from "@apty/browser-runtime/apty/dom-config/index";
import { DomHealthPage } from "../dom-health/dom-health-page";
import { createDomHealthStore } from "../dom-health-store";
import { DomConfigCard } from "./dom-config-card";
import { createDomConfigStore } from "./dom-config-store";
import {
  CAPTURE,
  deferred,
  ORIGIN,
  outcome,
  profile,
  TAB_ID,
} from "./dom-config-test-fixtures";

const OTHER_TAB = 7;

interface FakeTab {
  url: string;
  heading: string;
  attributes: DomProfileV2["attributes"];
  frames: NonNullable<DomProfileV2["frames"]>;
}

let tab: FakeTab;
let requests: string[];
let clipboard: string[];
let downloads: Blob[];
let store: ReturnType<typeof createDomConfigStore>;
const tabsUpdate = vi.fn();
const tabsReload = vi.fn();

function respond(message: { request: string }): unknown {
  switch (message.request) {
    case "wait-for-dom-stable":
      return { settled: true, elapsedMs: 0 };
    case "collect-dom-health-frame-bundle":
      return {
        snapshot: {
          url: tab.url,
          counts: {
            interactiveElements: 1,
            inputs: 0,
            selects: 0,
            textareas: 0,
          },
          elementUniverse: { totalElements: 6, meaningfulElements: 6 },
        },
        stateSignature: {
          url: tab.url,
          navTrail: [],
          primaryHeading: tab.heading,
          structureHash: "s0",
        },
      };
    case "collect-dom-health-frame-owners":
      return [];
    case "collect-dom-profile":
      return {
        ...profile(tab.attributes),
        frames: tab.frames,
        meta: { elementCount: 7, urlShape: tab.url, aptyPresent: false },
      };
    default:
      return undefined;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  store = createDomConfigStore();
  requests = [];
  clipboard = [];
  downloads = [];
  tab = {
    url: `${ORIGIN}/patients`,
    heading: "Patients",
    attributes: { id: { "ui-id-4": 1, main: 1 }, class: { modal: 1 } },
    frames: [],
  };
  mockUseChatContext.mockReturnValue({ sessionId: "session-1" });
  mockUseCurrentTarget.mockReturnValue({
    tabId: TAB_ID,
    title: "Clinic for Jane Example",
    hostname: "app.example.test",
  });
  Object.assign(chrome, {
    webNavigation: {
      getAllFrames: vi.fn(async () => [
        { frameId: 0, parentFrameId: -1, url: tab.url, errorOccurred: false },
      ]),
    },
  });
  Object.assign(chrome.runtime, {
    lastError: undefined,
    getManifest: () => ({ content_scripts: [] }),
  });
  Object.assign(chrome.tabs, {
    get: vi.fn(async (id: number) => ({ id, url: tab.url })),
    update: tabsUpdate,
    reload: tabsReload,
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    sendMessage: vi.fn(
      (
        _tabId: number,
        message: { request: string },
        _options: unknown,
        callback: (response: unknown) => void,
      ) => {
        requests.push(message.request);
        const data = respond(message);
        callback(
          data === undefined
            ? { success: false, error: "The frame did not answer." }
            : { success: true, data },
        );
      },
    ),
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
  act(() => store.setExpanded(true));
  return render(<DomConfigCard store={store} />);
}

async function openSection(name: string) {
  const summary = screen.getByText(name, { selector: "summary" });
  fireEvent.click(summary);
  await waitFor(() => expect(summary.parentElement).toHaveAttribute("open"));
}

async function captureByHand(pageName: string) {
  if (!screen.queryByLabelText("Page name")) {
    await openSection("Capture current state");
  }
  fireEvent.change(screen.getByLabelText("Page name"), {
    target: { value: pageName },
  });
  const button = screen.getByRole("button", {
    name: "Capture now: add a run of the current tab as it is",
  });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(store.getState().capturing).toBe(false));
}

describe("manual capture", () => {
  it("captures the current tab as it is, never navigating, reloading or clicking", async () => {
    renderCard();
    await openSection("Capture current state");
    expect(screen.getByLabelText("Page name")).toHaveValue("");

    await captureByHand("Patient search, filters open");

    expect(
      await screen.findByText(
        "Captured run 1 of Patient search, filters open.",
      ),
    ).toBeInTheDocument();
    expect(mockCaptureCurrentState).toHaveBeenCalledWith(
      TAB_ID,
      expect.objectContaining({
        pageName: "Patient search, filters open",
        runLabel: "initial",
        probe: false,
      }),
    );
    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(tabsReload).not.toHaveBeenCalled();
    expect(requests).not.toContain("click-safe-navigation-candidate");
    expect(mockRunDomConfigCapture).not.toHaveBeenCalled();
    const pages = screen.getByRole("region", { name: "Pages" });
    expect(within(pages).getByText("manual")).toBeInTheDocument();
    expect(screen.getByText("Report ready")).toBeInTheDocument();
    expect(screen.queryByText(/^Partial report/)).not.toBeInTheDocument();
  });
});

async function showCrawlReport() {
  mockRunDomConfigCapture.mockResolvedValue(outcome());
  const view = renderCard();
  const start = screen.getByRole("button", {
    name: "Start generating the DOM config",
  });
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.click(start);
  await screen.findByRole("tablist", { name: "Report sections" });
  return view;
}

function section(name: string): HTMLElement {
  return screen.getByText(name, { selector: "summary" }).parentElement!;
}

async function exportedMarkdown(): Promise<string> {
  fireEvent.click(
    screen.getByRole("button", {
      name: "Export Markdown of the report, with the included rules only",
    }),
  );
  return downloads.at(-1)!.text();
}

function consoleProfile(ids: Record<string, number>): string {
  return JSON.stringify({ tags: { div: 3 }, attributes: { id: ids } });
}

function importRuns(pageName: string, count: number) {
  act(() => {
    store.importPage({
      pageName,
      runs: Array.from({ length: count }, (_, i) => ({
        text: consoleProfile({ [`row-${i}`]: 1 }),
        label: i === 0 ? "initial" : "repeat",
      })),
    });
  });
}

/** A DOM health store set to audit the whole application. */
function applicationHealthStore() {
  const health = createDomHealthStore();
  health.setScope("application");
  return health;
}

describe("manual capture, continued", () => {
  it("reads the tab in front, not the crawl's, and holds the tab lock while it reads", async () => {
    mockRunDomConfigCapture.mockResolvedValue(outcome());
    const health = applicationHealthStore();
    const view = render(
      <>
        <DomHealthPage store={health} />
        <DomConfigCard store={store} />
      </>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Generate DOM config for this application",
      }),
    );
    const start = screen.getByRole("button", {
      name: "Start generating the DOM config",
    });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await screen.findByRole("tablist", { name: "Report sections" });

    mockUseCurrentTarget.mockReturnValue({
      tabId: OTHER_TAB,
      title: "Other",
      hostname: "app.example.test",
    });
    view.rerender(
      <>
        <DomHealthPage store={health} />
        <DomConfigCard store={store} />
      </>,
    );
    const pending = deferred<{ available: false; error: string }>();
    mockCaptureCurrentState.mockImplementationOnce(() => pending.promise);
    await openSection("Capture current state");
    fireEvent.change(screen.getByLabelText("Page name"), {
      target: { value: "Allergies modal" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Capture now: add a run of the current tab as it is",
      }),
    );
    expect(mockCaptureCurrentState).toHaveBeenCalledWith(
      OTHER_TAB,
      expect.objectContaining({ capture: CAPTURE }),
    );
    expect(
      screen.getByRole("button", { name: "Audit application" }),
    ).toBeDisabled();
    await act(async () =>
      pending.resolve({ available: false, error: "the tab went away" }),
    );
    expect(
      screen.getByRole("button", { name: "Audit application" }),
    ).toBeEnabled();
    expect(store.getState().tabId).toBe(TAB_ID);
  });

  it("adds to a crawl's capture: the page joins the same report and the exported Markdown", async () => {
    await showCrawlReport();
    await captureByHand("Reports modal");

    const pages = screen.getByRole("region", { name: "Pages" });
    expect(within(pages).getByText("/home")).toBeInTheDocument();
    expect(within(pages).getByText("Reports modal")).toBeInTheDocument();
    expect(store.getState().capture?.pages.map((p) => p.label)).toEqual([
      `${ORIGIN}/home`,
      "Reports modal",
    ]);
    expect(
      store
        .getState()
        .report?.pages.map((p) => p.pageId)
        .sort(),
    ).toEqual([`${ORIGIN}/home`, "Reports modal"].sort());
    expect(await exportedMarkdown()).toContain("Reports modal");
  });

  it("warns when the state was already captured under another name", async () => {
    renderCard();
    await captureByHand("Patient list");
    await captureByHand("Patient list again");
    expect(
      await screen.findByText(
        "This looks like the same state as a run already held on Patient list. Check that you opened the state you meant to capture.",
      ),
    ).toBeInTheDocument();
  });

  it("announces the engine's error, the run limit included", async () => {
    importRuns("Full", 8);
    renderCard();
    await captureByHand("Full");
    const error = await screen.findByText(
      "Not captured: This page already holds 8 runs, the most the analysis keeps.",
    );
    expect(error.closest("[role='status']")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(store.getState().capture?.pages[0]?.runs).toHaveLength(8);
  });

  it("says why it cannot capture: no tab, a browser page, a tab DOM Health is auditing", async () => {
    mockUseCurrentTarget.mockReturnValue({
      tabId: null,
      title: null,
      hostname: null,
    });
    const view = renderCard();
    await openSection("Capture current state");
    fireEvent.change(screen.getByLabelText("Page name"), {
      target: { value: "Anything" },
    });
    const capture = () =>
      screen.getByRole("button", {
        name: "Capture now: add a run of the current tab as it is",
      });
    expect(
      within(section("Capture current state")).getByText(
        "Open a web page in this window to capture it.",
      ),
    ).toBeInTheDocument();
    expect(capture()).toBeDisabled();
    view.unmount();

    mockUseCurrentTarget.mockReturnValue({
      tabId: TAB_ID,
      title: "Settings",
      hostname: "settings",
    });
    tab.url = "chrome://settings/";
    const restricted = renderCard();
    await openSection("Capture current state");
    expect(
      await within(section("Capture current state")).findByText(
        "This page cannot be analyzed: browser and extension pages do not allow content scripts.",
      ),
    ).toBeInTheDocument();
    restricted.unmount();

    tab.url = `${ORIGIN}/patients`;
    const audit = deferred<unknown>();
    mockRunApplicationDomHealthAudit.mockReturnValue(audit.promise);
    const health = applicationHealthStore();
    render(
      <>
        <DomHealthPage store={health} />
        <DomConfigCard store={store} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Audit application" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Generate DOM config for this application",
      }),
    );
    await openSection("Capture current state");
    fireEvent.change(screen.getByLabelText("Page name"), {
      target: { value: "Anything" },
    });
    expect(
      await within(section("Capture current state")).findByText(
        "DOM Health is auditing this tab. Wait for it to finish.",
      ),
    ).toBeInTheDocument();
    expect(capture()).toBeDisabled();
    expect(mockCaptureCurrentState).not.toHaveBeenCalled();
    await act(async () =>
      audit.resolve({ available: false, error: "stopped for the test" }),
    );
  });
});

describe("one held capture", () => {
  it("asks before a new crawl replaces pages captured by hand, and replaces a crawl without asking", async () => {
    mockRunDomConfigCapture.mockResolvedValue(outcome());
    renderCard();
    await captureByHand("Patient modal");

    let result: string | undefined;
    await act(async () => {
      result = await store.start(TAB_ID);
    });
    expect(result).toBe("confirm");
    expect(mockRunDomConfigCapture).not.toHaveBeenCalled();
    expect(store.getState().capture?.pages).toHaveLength(1);

    await openSection("Start a new crawl");
    const start = () =>
      screen.getByRole("button", { name: "Start generating the DOM config" });
    await waitFor(() => expect(start()).toBeEnabled());
    fireEvent.click(start());
    expect(
      screen.getByRole("button", { name: "Replace them and start" }),
    ).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Replace them and start" }),
    ).toHaveAccessibleDescription(
      "Starting replaces the 1 pages already captured, including the ones you captured by hand or imported. Export the report first to keep them.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep the capture" }));
    expect(mockRunDomConfigCapture).not.toHaveBeenCalled();
    expect(store.getState().capture?.pages[0]?.label).toBe("Patient modal");

    fireEvent.click(start());
    fireEvent.click(
      screen.getByRole("button", { name: "Replace them and start" }),
    );
    await waitFor(() =>
      expect(store.getState().capture?.pages.map((p) => p.label)).toEqual([
        `${ORIGIN}/home`,
      ]),
    );
    expect(mockRunDomConfigCapture).toHaveBeenCalledTimes(1);

    await openSection("Start a new crawl");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Start generating the DOM config",
      }),
    );
    await waitFor(() =>
      expect(mockRunDomConfigCapture).toHaveBeenCalledTimes(2),
    );
  });
});

describe("import", () => {
  async function openImport(pageName: string) {
    await openSection("Import console script results");
    fireEvent.change(
      within(section("Import console script results")).getByLabelText(
        "Page name",
      ),
      { target: { value: pageName } },
    );
  }

  it("keeps the valid runs, lists each failing one with what is missing and what to do, and marks the page imported", async () => {
    renderCard();
    await openImport("Imported list");
    fireEvent.change(screen.getByLabelText("Paste the script's result"), {
      target: { value: consoleProfile({ "ui-id-1": 1 }) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add a run" }));
    const [, second] = screen.getAllByLabelText("Paste the script's result");
    fireEvent.change(second!, {
      target: { value: '{"tags":{"div":1}}' },
    });
    fireEvent.change(screen.getAllByLabelText("Run kind")[1]!, {
      target: { value: "after-reload" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import page" }));

    expect(
      screen.getByText("Runs imported into Imported list: 1."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Run 2: The profile has no attributes section, which every page produces.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Missing: attributes")).toBeInTheDocument();
    expect(
      screen.getByText(/^Run the DOM analysis script again on the same page\./),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText("Paste the script's result")).toHaveLength(
      1,
    );
    expect(screen.getByLabelText("Paste the script's result")).toHaveValue(
      '{"tags":{"div":1}}',
    );
    const page = store.getState().capture?.pages[0];
    expect(page).toMatchObject({ label: "Imported list", origin: "import" });
    expect(page?.runs.map((r) => r.meta.label)).toEqual(["initial"]);
    expect(
      within(screen.getByRole("region", { name: "Pages" })).getByText(
        "imported",
      ),
    ).toBeInTheDocument();
  });

  it("adds runs to a page of the same name up to the run limit", async () => {
    importRuns("Full", 7);
    renderCard();
    await openImport("Full");
    fireEvent.change(screen.getByLabelText("Paste the script's result"), {
      target: { value: consoleProfile({ a: 1 }) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add a run" }));
    fireEvent.change(
      screen.getAllByLabelText("Paste the script's result")[1]!,
      {
        target: { value: consoleProfile({ b: 1 }) },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Import page" }));
    expect(screen.getByText("Runs imported into Full: 1.")).toBeInTheDocument();
    expect(
      screen.getByText("Valid runs left out: 1. A page holds at most 8 runs."),
    ).toBeInTheDocument();
    expect(store.getState().capture?.pages).toHaveLength(1);
    expect(store.getState().capture?.pages[0]?.runs).toHaveLength(8);
  });

  it("takes runs from chosen files, one run per file in order", async () => {
    renderCard();
    await openImport("From files");
    const files = [
      new File([consoleProfile({ "ui-id-1": 1 })], "first.json"),
      new File([consoleProfile({ "ui-id-2": 1 })], "second.json"),
    ];
    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files },
    });
    expect(
      await screen.findByLabelText("From the file second.json"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("From the file first.json")).toHaveValue(
      consoleProfile({ "ui-id-1": 1 }),
    );
    expect(
      screen
        .getAllByLabelText("Run kind")
        .map((s) => (s as HTMLSelectElement).value),
    ).toEqual(["initial", "after-reload"]);
    fireEvent.click(screen.getByRole("button", { name: "Import page" }));
    expect(
      screen.getByText("Runs imported into From files: 2."),
    ).toBeInTheDocument();
    expect(
      store.getState().capture?.pages[0]?.runs.map((r) => r.meta.label),
    ).toEqual(["initial", "after-reload"]);
  });

  it("copies the console script and says what it cannot do", async () => {
    renderCard();
    await openSection("Import console script results");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy console script for the browser console",
      }),
    );
    await waitFor(() =>
      expect(clipboard.at(-1)).toBe(DOM_CONFIG_CONSOLE_SCRIPT),
    );
    expect(
      screen.getByText(/^The console script records only the highest z-index/),
    ).toBeInTheDocument();
  });
});

describe("page detail", () => {
  it("opens a page to its runs, what changed between them and its facts", async () => {
    await showCrawlReport();
    const row = screen.getByRole("button", { name: /^\/home/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    const detail = screen.getByRole("region", { name: "Details of /home" });
    expect(row).toHaveAttribute("aria-controls", detail.id);
    expect(within(detail).getByText("Run 1 (initial)")).toBeInTheDocument();
    expect(
      within(detail).getByText("Run 1 (initial) to Run 2 (after reload)"),
    ).toBeInTheDocument();
    const removed = within(detail)
      .getByText("ui-id-1")
      .closest("li") as HTMLElement;
    expect(within(removed).getByText("id")).toBeInTheDocument();
    expect(within(removed).getByText("removed")).toBeInTheDocument();
    expect(within(removed).getByText("1 to 0")).toBeInTheDocument();
    expect(within(detail).getByText("Max z-index: 10")).toBeInTheDocument();
    expect(within(detail).getByText("Iframes: 0")).toBeInTheDocument();
    fireEvent.click(row);
    expect(
      screen.queryByRole("region", { name: "Details of /home" }),
    ).not.toBeInTheDocument();
  });

  it("downloads a run's raw profile only after the page-data warning, and nothing else", async () => {
    await showCrawlReport();
    fireEvent.click(screen.getByRole("button", { name: /^\/home/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Download raw profile of run 2" }),
    );
    expect(
      screen.getByText(/^This file contains page data:/),
    ).toBeInTheDocument();
    expect(downloads).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Download the raw profile of run 2, page data included",
      }),
    );
    expect(downloads).toHaveLength(1);
    expect(JSON.parse(await downloads[0]!.text())).toEqual(
      CAPTURE.pages[0]!.runs[1]!.profile,
    );
    expect(
      screen.queryByText(/^This file contains page data:/),
    ).not.toBeInTheDocument();
  });
});

describe("report tabs", () => {
  it("moves across the five tabs with the arrow keys, Home and End", async () => {
    await showCrawlReport();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Ignore conditions",
      "Settings",
      "Iframes",
      "Coverage",
      "Warnings",
    ]);
    const selected = () =>
      screen.getByRole("tab", { selected: true }).textContent;
    tabs[0]!.focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(selected()).toBe("Warnings");
    expect(document.activeElement).toHaveTextContent("Warnings");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(selected()).toBe("Ignore conditions");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(selected()).toBe("Warnings");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(selected()).toBe("Ignore conditions");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(selected()).toBe("Iframes");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      document.activeElement!.id,
    );
  });

  it("lists iframes by kind, application ones needing handling first, and copies them with every table", async () => {
    const framed: DomConfigApplicationCapture = {
      ...CAPTURE,
      pages: CAPTURE.pages.map((page) => ({
        ...page,
        runs: page.runs.map((run) => ({
          ...run,
          profile: {
            ...run.profile,
            frames: [
              {
                src: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/frame.html",
                crossOrigin: true,
                readable: false,
                reason: "noise" as const,
              },
              {
                src: "https://viewer.example.test/doc",
                crossOrigin: true,
                readable: false,
                reason: "blocked-cross-origin" as const,
              },
            ],
          },
        })),
      })),
    };
    mockRunDomConfigCapture.mockResolvedValue(
      outcome({ capture: framed, ...buildReportFromCapture(framed) }),
    );
    renderCard();
    const start = screen.getByRole("button", {
      name: "Start generating the DOM config",
    });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await screen.findByRole("tablist", { name: "Report sections" });
    fireEvent.click(screen.getByRole("tab", { name: "Iframes" }));
    const app = screen.getByRole("region", { name: "Application iframes" });
    expect(
      within(app).getByText("https://viewer.example.test/doc"),
    ).toBeInTheDocument();
    expect(within(app).getByText("Needs handling")).toBeInTheDocument();
    expect(
      within(app).getByText("Cross-origin: yes · Analyzed: no"),
    ).toBeInTheDocument();
    const extension = screen.getByRole("region", { name: "Extension iframes" });
    expect(within(extension).queryByText("Needs handling")).toBeNull();
    expect(
      screen
        .getAllByRole("region", { name: /iframes$/ })
        .map((r) => r.getAttribute("aria-label")),
    ).toEqual(["Application iframes", "Extension iframes"]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy as tables: every section, with the included rules only",
      }),
    );
    await waitFor(() => expect(clipboard).toHaveLength(1));
    expect(clipboard[0]).toContain(
      "Iframes\nKind\tSource\tCross-origin\tAnalyzed\tNeeds handling\tReason\tPages\nApplication iframes\thttps://viewer.example.test/doc\tyes\tno\tyes",
    );
    expect(clipboard[0]).toContain("Coverage\nState\tStatus\tSuggested pages");
  });

  it("re-runs the analysis with a coverage mark and exports it", async () => {
    await showCrawlReport();
    fireEvent.click(screen.getByRole("tab", { name: "Coverage" }));
    expect(
      screen.getByText(
        "Mark what you captured. Marks are your statement; the engine does not check them.",
      ),
    ).toBeInTheDocument();
    const item = screen.getByText("Modals and dialogs").closest("li")!;
    expect(within(item).getByText("Not captured")).toBeInTheDocument();
    mockBuildReportFromCapture.mockClear();
    fireEvent.change(
      within(item).getByRole("combobox", { name: "Mark Modals and dialogs" }),
      { target: { value: "captured" } },
    );
    expect(mockBuildReportFromCapture).toHaveBeenCalledWith(CAPTURE, {
      ignoredRoots: [],
      coverage: { "modals-dialogs": "captured" },
    });
    expect(within(item).getAllByText("Captured")).toHaveLength(2);
    expect(await exportedMarkdown()).toMatch(
      /\| modals-dialogs \| captured \|/,
    );

    fireEvent.change(
      within(item).getByRole("combobox", { name: "Mark Modals and dialogs" }),
      { target: { value: "" } },
    );
    expect(mockBuildReportFromCapture).toHaveBeenLastCalledWith(CAPTURE, {
      ignoredRoots: [],
      coverage: {},
    });
    expect(within(item).getByText("Not captured")).toBeInTheDocument();
  });

  it("lists warnings worst first, explains single-run pages and prefills another run's page name", async () => {
    renderCard();
    await captureByHand("Patient modal");
    const summary = screen.getByRole("region", {
      name: /^Warnings to act on/,
    });
    expect(within(summary).getByText("single-run-pages")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Page name"), {
      target: { value: "something else" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Warnings" }));
    const warnings = within(screen.getByRole("tabpanel")).getAllByRole(
      "listitem",
    );
    expect(warnings[0]).toHaveTextContent(/^Act on this: /);
    expect(
      screen.getByText(
        /^A page with one run still feeds the rules found from value shapes/,
      ),
    ).toBeInTheDocument();
    const unready = screen.getByRole("region", { name: "Pages not ready" });
    expect(
      within(unready).getByText(/one run: capture a second run/),
    ).toBeInTheDocument();

    fireEvent.click(
      within(unready).getByRole("button", {
        name: "Capture another run of Patient modal",
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Page name")).toHaveValue("Patient modal"),
    );
    expect(screen.getByLabelText("Page name")).toHaveFocus();
    expect(screen.getByLabelText("Run")).toHaveValue("repeat");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Capture now: add a run of the current tab as it is",
      }),
    );
    expect(
      await screen.findByText("Captured run 2 of Patient modal."),
    ).toBeInTheDocument();
  });
});

describe("privacy of the exports", () => {
  const PII = ["jane.doe@example.com", "555-123-4567", "00012345678"];

  function piiRun(
    label: "initial" | "after-reload",
    patient: string,
  ): DomConfigApplicationCapture["pages"][number]["runs"][number] {
    return {
      meta: {
        label,
        urlShape: `${ORIGIN}/patients/1234567?mrn=00012345678`,
        aptyPresent: false,
        extensionNoisePresent: false,
      },
      profile: profile({
        title: { "jane.doe@example.com": 1 },
        "data-phone": { "555-123-4567": 1 },
        "data-mrn": { "MRN 00012345678": 1 },
        "data-patient": { [patient]: 1 },
        id: { save: 1 },
      }),
    };
  }

  it("hides PII-shaped values in every copy and export; a changed person name reaches only the JSON's page differences", async () => {
    const pii: DomConfigApplicationCapture = {
      applicationName: "app.example.test",
      pages: [
        {
          pageId: `${ORIGIN}/patients/:id?mrn`,
          label: `${ORIGIN}/patients/:id?mrn`,
          runs: [
            piiRun("initial", "Jane Doe"),
            piiRun("after-reload", "John Roe"),
          ],
          origin: "crawl",
        },
      ],
    };
    mockRunDomConfigCapture.mockResolvedValue(
      outcome({ capture: pii, states: [], ...buildReportFromCapture(pii) }),
    );
    renderCard();
    const start = screen.getByRole("button", {
      name: "Start generating the DOM config",
    });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await screen.findByRole("tablist", { name: "Report sections" });
    fireEvent.click(
      screen.getByRole("switch", { name: "Guides target a specific record" }),
    );
    fireEvent.click(screen.getByText(/^Need review/, { selector: "summary" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Include every rule that needs review",
      }),
    );

    const markdown = await exportedMarkdown();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Export JSON of the engine report, with the included rules only",
      }),
    );
    const json = await downloads.at(-1)!.text();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy as tables: every section, with the included rules only",
      }),
    );
    await waitFor(() => expect(clipboard).toHaveLength(1));
    for (const value of PII) {
      expect(markdown).not.toContain(value);
      expect(json).not.toContain(value);
      expect(clipboard[0]).not.toContain(value);
    }
    expect(markdown).not.toContain("Jane");
    expect(clipboard[0]).not.toContain("Jane");
    expect(JSON.stringify(JSON.parse(json).rules)).not.toContain("Jane");
    expect(JSON.stringify(JSON.parse(json).pages[0].diffs)).toContain(
      "Jane Doe",
    );
  });
});
