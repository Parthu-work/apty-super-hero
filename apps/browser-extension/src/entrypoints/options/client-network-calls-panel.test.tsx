import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  body: vi.fn(),
}));
const download = vi.hoisted(() => vi.fn());

vi.mock("@apty/browser-runtime/apty/client-network-calls", () => ({
  listClientNetworkCalls: api.list,
  readClientNetworkCallBody: api.body,
}));
vi.mock("@apty/browser-runtime/runtime/redaction-mode", () => ({
  currentRedactionMode: () => "strict",
}));
vi.mock("@apty/ui/lib/download", () => ({ downloadText: download }));

import type { NetworkCall } from "@apty/browser-runtime/apty/client-network-calls";
import {
  ClientNetworkCallsPanel,
  filterNetworkCalls,
} from "./client-network-calls-panel";

const EXT_ID = "a".repeat(32);

const call = (overrides: Partial<NetworkCall>): NetworkCall => ({
  requestId: "r",
  url: "https://cdn.apty.example/x.json",
  method: "GET",
  status: 200,
  timestamp: 0,
  resourceName: "x.json",
  ...overrides,
});

const CALLS = [
  call({
    requestId: "r1",
    resourceName: "segments.json",
    url: "https://cdn.apty.example/segments.json",
  }),
  call({ requestId: "r2", resourceName: "missing.json", status: 404 }),
  call({
    requestId: "r3",
    resourceName: "boom.json",
    status: 503,
    method: "POST",
  }),
  call({
    requestId: "r4",
    resourceName: "flows.json",
    status: undefined,
    failed: true,
    errorText: "net::ERR_CONNECTION_RESET",
  }),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("filterNetworkCalls", () => {
  it("filters by status class", () => {
    const names = (s: Parameters<typeof filterNetworkCalls>[2]) =>
      filterNetworkCalls(CALLS, "", s).map((c) => c.requestId);
    expect(names("all")).toEqual(["r1", "r2", "r3", "r4"]);
    expect(names("failed")).toEqual(["r4"]);
    expect(names("4xx")).toEqual(["r2"]);
    expect(names("5xx")).toEqual(["r3"]);
  });

  it("matches text in the name, URL or method, in any case, together with the class", () => {
    expect(filterNetworkCalls(CALLS, "SEGMENTS", "all")).toHaveLength(1);
    expect(filterNetworkCalls(CALLS, "post", "all")[0]?.requestId).toBe("r3");
    expect(filterNetworkCalls(CALLS, "cdn.apty", "4xx")[0]?.requestId).toBe(
      "r2",
    );
    expect(filterNetworkCalls(CALLS, "segments", "5xx")).toEqual([]);
  });
});

function renderPanel() {
  render(<ClientNetworkCallsPanel extensionId={EXT_ID} />);
  fireEvent.click(screen.getByRole("button", { name: "Load network calls" }));
}

describe("ClientNetworkCallsPanel", () => {
  it("asks the Client for nothing until the user clicks", () => {
    render(<ClientNetworkCallsPanel extensionId={EXT_ID} />);
    expect(api.list).not.toHaveBeenCalled();
  });

  it("lists the calls, marks a failed one with its error, and filters them", async () => {
    api.list.mockResolvedValue({ ok: true, calls: CALLS, mayBeBounded: false });
    renderPanel();

    expect(
      await screen.findByText("Showing 4 of 4 calls the Client reported."),
    ).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith(EXT_ID);
    const failedRow = screen
      .getByText("flows.json")
      .closest("tr") as HTMLElement;
    expect(within(failedRow).getByText("Failed")).toBeInTheDocument();
    expect(
      within(failedRow).getByText("net::ERR_CONNECTION_RESET"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "5xx" }));
    expect(screen.getByText("Showing 1 of 4 calls the Client reported."));
    expect(screen.queryByText("segments.json")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5xx" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("says when the Client's list may be cut off, and reports an empty list as empty", async () => {
    api.list.mockResolvedValueOnce({
      ok: true,
      calls: CALLS,
      mayBeBounded: true,
    });
    renderPanel();
    expect(
      await screen.findByText(/older calls may be missing/),
    ).toBeInTheDocument();

    api.list.mockResolvedValueOnce({
      ok: true,
      calls: [],
      mayBeBounded: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(
      await screen.findByText("The Client reported no network calls."),
    ).toBeInTheDocument();
  });

  it("names why the calls couldn't be loaded, with the allow-list fix", async () => {
    api.list.mockResolvedValue({
      ok: false,
      failure: "no_receiver",
      message: "Chrome found nothing listening in the Apty Client.",
      fix: 'Apty Client\'s manifest must list this Agent ID in externally_connectable.ids: "agent-id"',
    });
    renderPanel();

    expect(
      await screen.findByText("Couldn't load the Client's network calls"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Chrome found nothing listening in the Apty Client."),
    ).toBeInTheDocument();
    expect(screen.getByText(/externally_connectable\.ids: "agent-id"/));
  });

  it("downloads the shown calls as JSON that says it is redacted", async () => {
    api.list.mockResolvedValue({ ok: true, calls: CALLS, mayBeBounded: false });
    renderPanel();
    await screen.findByText("segments.json");
    expect(
      screen.getByText(/redacted \(Strict mode\)|redacted \(strict mode\)/i),
    );

    fireEvent.click(screen.getByRole("button", { name: "4xx" }));
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));

    const [filename, content, mime] = download.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(filename).toBe("apty-client-network-calls.redaction-strict.json");
    expect(mime).toBe("application/json");
    const parsed = JSON.parse(content);
    expect(parsed).toMatchObject({
      source: "Apty Client",
      redactionMode: "strict",
    });
    expect(parsed.calls.map((c: NetworkCall) => c.requestId)).toEqual(["r2"]);
  });

  it("views and downloads a body on demand", async () => {
    api.list.mockResolvedValue({ ok: true, calls: CALLS, mayBeBounded: false });
    api.body.mockResolvedValue({
      status: "ok",
      call: CALLS[0],
      body: {
        text: '{"name":"sales-team"}',
        fullLength: 21,
        isBinary: false,
      },
    });
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "View the body of segments.json",
      }),
    );

    expect(await screen.findByText(/sales-team/)).toBeInTheDocument();
    expect(api.body).toHaveBeenCalledWith(EXT_ID, "r1");
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(download).toHaveBeenCalledWith(
      "segments.json.redaction-strict.json",
      '{"name":"sales-team"}',
      "application/json",
    );
  });

  it.each([
    [
      { status: "body_denied", deniedBy: "/users/", call: CALLS[0] },
      'Not fetched: its URL matches "/users/" in the body deny list (Settings → Data handling).',
    ],
    [
      { status: "not_observed" },
      "The Client no longer lists this call. Load the calls again.",
    ],
    [
      { status: "failed", call: CALLS[3] },
      "The call failed, so there is no body: net::ERR_CONNECTION_RESET",
    ],
    [
      { status: "pending", call: CALLS[0] },
      "The Client hasn't reported a response for this call yet.",
    ],
    [
      { status: "body_unavailable", call: CALLS[0] },
      "The Client observed this call but didn't provide its body.",
    ],
    [
      { status: "http_error", call: CALLS[1] },
      "The call returned HTTP 404, and the Client didn't provide its body.",
    ],
    [
      {
        status: "not_connected",
        failure: "timeout",
        message: "The Apty Client accepted the message but never answered.",
      },
      "The Apty Client accepted the message but never answered.",
    ],
  ])("explains a body it can't show: %o", async (result, text) => {
    api.list.mockResolvedValue({ ok: true, calls: CALLS, mayBeBounded: false });
    api.body.mockResolvedValue(result);
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "View the body of segments.json",
      }),
    );

    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});
