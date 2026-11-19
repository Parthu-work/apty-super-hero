import {
  capture,
  evidenceFrom,
} from "@apty/browser-runtime/apty/diagnosis/diagnosis-test-utils";
import type {
  ClientEvidence,
  DiagnosisResult,
} from "@apty/browser-runtime/apty/diagnosis/types";
import { diagnoseWidgetNotVisible } from "@apty/browser-runtime/apty/diagnosis/widget-not-visible";
import type { UIToolPart } from "@apty/ui/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captureAndReload = vi.hoisted(() => vi.fn());
const recheckFromCapture = vi.hoisted(() => vi.fn());
vi.mock(
  "@apty/browser-runtime/apty/diagnosis/capture-check",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    captureAndReload,
    recheckFromCapture,
  }),
);

const runHarCheck = vi.hoisted(() => vi.fn());
vi.mock(
  "@apty/browser-runtime/apty/diagnosis/har-check",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    runHarCheck,
  }),
);

const facts = vi.hoisted(() => vi.fn());
const remembered = vi.hoisted(() => vi.fn());
const remember = vi.hoisted(() => vi.fn());
vi.mock(
  "@apty/browser-runtime/apty/evidence-route",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    tabClientModeFacts: facts,
    rememberedRoute: remembered,
    rememberRoute: remember,
  }),
);

import { CheckResultCard } from "./check-result-card";
import { GetEvidence } from "./get-evidence";

const tool = (output: unknown): UIToolPart => ({
  type: "tool",
  toolName: "run_diagnosis",
  toolCallId: "c1",
  input: {},
  output,
  state: "completed",
});

const PAGE = "https://uat.crm.example.com/leads/42";
const unreachable: ClientEvidence = {
  connection: { ok: false, failure: "no_receiver", message: "Nothing." },
  observedNames: [],
  files: {},
};
const NO_SIGNS = {
  injectedConfig: false,
  clientScript: false,
  pageContentCalls: 0,
};

function show(result = diagnoseWidgetNotVisible(unreachable, PAGE)) {
  const shown: DiagnosisResult[] = [];
  render(
    <GetEvidence
      result={result}
      renderCheck={(again, id) => {
        shown.push(again);
        return <p key={id}>CHECK AGAIN {again.packId}</p>;
      }}
    />,
  );
  return shown;
}

function harFile(entries: unknown[]) {
  return new File([JSON.stringify({ log: { entries } })], "sw.har", {
    type: "application/json",
  });
}

const CONTENT_ENTRY = {
  request: {
    method: "GET",
    url: "https://cdn.apty.example/tenant-4x/app-301/env-3012/flow.json",
  },
  response: { status: 200, content: { text: "[]" } },
};

beforeEach(() => {
  vi.resetAllMocks();
  (chrome as unknown as { tabs: unknown }).tabs = {
    query: vi.fn(async () => [{ id: 3, url: PAGE }]),
  };
  facts.mockResolvedValue(NO_SIGNS);
  remembered.mockResolvedValue(undefined);
  remember.mockResolvedValue(undefined);
});

describe("where the check card offers Get the evidence (KB-RAG K27, E8)", () => {
  const cdn = (status: "failed" | "ok") => ({
    ...diagnoseWidgetNotVisible(unreachable, PAGE),
    filesFromCdn: true,
    files: [{ name: "app-urls.json", status }],
  });

  it("offers it when Apty's content CDN was tried and gave no file", async () => {
    render(<CheckResultCard tool={tool(cdn("failed"))} />);
    expect(
      await screen.findByRole("button", { name: "Get the evidence" }),
    ).toBeInTheDocument();
  });

  it("does not when the CDN gave a file", () => {
    render(<CheckResultCard tool={tool(cdn("ok"))} />);
    expect(
      screen.queryByRole("button", { name: "Get the evidence" }),
    ).toBeNull();
  });
});

describe("Get the evidence (KB-RAG K27, E8)", () => {
  it("captures and reloads the tab in Injected mode, and remembers the route for the site", async () => {
    facts.mockResolvedValue({ ...NO_SIGNS, pageContentCalls: 4 });
    captureAndReload.mockResolvedValue({ ok: true, calls: 4 });
    recheckFromCapture.mockResolvedValue(
      diagnoseWidgetNotVisible(evidenceFrom(capture("content-4x")), PAGE),
    );
    show();
    expect(
      await screen.findByText(
        /Injected mode: the page reads Apty's files.*Shown by the page's own Apty calls\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("get-evidence")).toHaveAttribute(
      "data-route",
      "capture",
    );
    fireEvent.click(screen.getByRole("button", { name: "Get the evidence" }));
    expect(
      await screen.findByText("CHECK AGAIN widget-not-visible"),
    ).toBeInTheDocument();
    expect(captureAndReload).toHaveBeenCalledWith(3);
    expect(remember).toHaveBeenCalledWith(
      expect.stringMatching(/^site-[0-9a-f]{8}$/),
      "capture",
    );
  });

  it("asks for a service-worker HAR in Extension mode, with the steps open and a drop zone, and never captures", async () => {
    facts.mockResolvedValue({ ...NO_SIGNS, clientScript: true });
    show();
    await screen.findByText(/Shown by the script the Apty Client injects/);
    expect(screen.getByTestId("get-evidence")).toHaveAttribute(
      "data-route",
      "har",
    );
    fireEvent.click(screen.getByRole("button", { name: "Get the evidence" }));
    expect(
      await screen.findByLabelText("Drop the HAR file here, or choose it"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("list", {
          name: "Save a HAR from the 4.x Client's service worker",
        })
        .closest("details"),
    ).toHaveAttribute("open");
    expect(captureAndReload).not.toHaveBeenCalled();
    expect(remember).toHaveBeenCalledWith(expect.any(String), "har");
  });

  it("takes the route last used on the site over the detected one, and says so", async () => {
    facts.mockResolvedValue({ ...NO_SIGNS, pageContentCalls: 2 });
    remembered.mockResolvedValue("har");
    show();
    expect(
      await screen.findByText(
        "Route: a HAR from the Client's service worker. Last used on this site.",
      ),
    ).toBeInTheDocument();
  });

  it("switches to the other route on request and remembers it", async () => {
    show();
    fireEvent.click(
      await screen.findByRole("button", { name: "Use a HAR instead" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("get-evidence")).toHaveAttribute(
        "data-route",
        "har",
      ),
    );
    expect(remember).toHaveBeenCalledWith(expect.any(String), "har");
    expect(
      screen.getByRole("button", { name: "Use Capture and reload instead" }),
    ).toBeInTheDocument();
  });

  it("moves to the HAR route when a capture sees no Apty call", async () => {
    captureAndReload.mockResolvedValue({ ok: true, calls: 0 });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Get the evidence" }));
    expect(
      await screen.findByLabelText("Drop the HAR file here, or choose it"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(remember).toHaveBeenCalledWith(expect.any(String), "har"),
    );
    expect(recheckFromCapture).not.toHaveBeenCalled();
  });

  it("checks a dropped HAR against the tab's page once confirmed", async () => {
    facts.mockResolvedValue({ ...NO_SIGNS, clientScript: true });
    const checked = diagnoseWidgetNotVisible(
      evidenceFrom(capture("content-4x")),
      PAGE,
    );
    runHarCheck.mockResolvedValue(checked);
    const shown = show();
    fireEvent.click(screen.getByRole("button", { name: "Get the evidence" }));
    const zone = await screen.findByTestId("evidence-drop");
    fireEvent.drop(zone, {
      dataTransfer: { files: [harFile([CONTENT_ENTRY])] },
    });
    expect(
      await screen.findByText("sw.har: 1 calls, 1 Apty content files"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: `Use the page open in this tab: ${PAGE}`,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check the HAR" }));
    expect(
      await screen.findByText("CHECK AGAIN widget-not-visible"),
    ).toBeInTheDocument();
    expect(runHarCheck).toHaveBeenCalledWith(
      expect.anything(),
      { packId: "widget-not-visible" },
      { pageUrl: PAGE },
    );
    expect(shown).toEqual([checked]);
  });

  it("says why a dropped file is not a HAR, and that a HAR without Apty files holds none", async () => {
    facts.mockResolvedValue({ ...NO_SIGNS, clientScript: true });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Get the evidence" }));
    const input = (await screen.findByLabelText(
      "Drop the HAR file here, or choose it",
    )) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["{}"], "x.json")] },
    });
    expect(
      await screen.findByText(
        "This JSON file has no log entries, so it is not a HAR file.",
      ),
    ).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [harFile([])] } });
    expect(
      await screen.findByText(/This HAR holds no Apty content file\./),
    ).toBeInTheDocument();
    expect(runHarCheck).not.toHaveBeenCalled();
  });
});
