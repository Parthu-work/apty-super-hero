import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  body: vi.fn(),
}));
const download = vi.hoisted(() => vi.fn());

vi.mock("@apty/browser-runtime/apty/client-network-calls", () => ({
  listClientNetworkCalls: api.list,
  readClientResourceBody: api.body,
}));
vi.mock("@apty/browser-runtime/runtime/redaction-mode", () => ({
  currentRedactionMode: () => "strict",
}));
vi.mock("@apty/ui/lib/download", () => ({ downloadText: download }));

import type { NetworkCall } from "@apty/browser-runtime/apty/client-network-calls";
import { groupByResource } from "@apty/browser-runtime/apty/network-resource-groups";
import {
  ClientNetworkCallsPanel,
  filterNetworkCalls,
  filterResourceGroups,
} from "./client-network-calls-panel";

const EXT_ID = "a".repeat(32);

const call = (overrides: Partial<NetworkCall>): NetworkCall => {
  const resourceName = overrides.resourceName ?? "x.json";
  return {
    requestId: "r",
    url: `https://cdn.apty.example/${resourceName}`,
    method: "GET",
    status: 200,
    timestamp: 0,
    resourceName,
    ...overrides,
  };
};

const key = (name: string, method = "GET") =>
  `${method} https://cdn.apty.example/${name}`;

const CALLS = [
  call({ requestId: "r1", resourceName: "segments.json" }),
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
      await screen.findByText("4 unique requests (4 calls)."),
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
    expect(
      screen.getByText("Showing 1 of 4 unique requests (4 calls)."),
    ).toBeInTheDocument();
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
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: " missing " },
    });
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
      filter: { text: "missing", status: "4xx" },
      shown: 1,
      total: 4,
      uniqueRequests: { shown: 1, total: 4 },
      summary: "shown 1 of 4 calls, in 1 of 4 unique requests",
    });
    expect(parsed.calls.map((c: NetworkCall) => c.requestId)).toEqual(["r2"]);
  });

  it("says in the download when nothing is filtered out", async () => {
    api.list.mockResolvedValue({ ok: true, calls: CALLS, mayBeBounded: false });
    renderPanel();
    await screen.findByText("segments.json");
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));

    expect(JSON.parse(download.mock.calls[0]?.[1] as string)).toMatchObject({
      filter: { text: "", status: "all" },
      summary: "shown 4 of 4 calls, in 4 of 4 unique requests",
    });
  });

  it("never lets an older body answer replace the one asked for since", async () => {
    api.list.mockResolvedValue({ ok: true, calls: CALLS, mayBeBounded: false });
    let answerFirst!: (value: unknown) => void;
    api.body
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        status: "ok",
        call: CALLS[1],
        body: { text: '{"newer":true}', fullLength: 14, isBinary: false },
      });
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "View the body of segments.json",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "View the body of missing.json" }),
    );
    expect(await screen.findByText(/newer/)).toBeInTheDocument();

    await act(async () => {
      answerFirst({
        status: "ok",
        call: CALLS[0],
        body: { text: '{"older":true}', fullLength: 14, isBinary: false },
      });
    });
    expect(screen.queryByText(/older/)).not.toBeInTheDocument();
    expect(screen.getByText(/newer/)).toBeInTheDocument();
  });

  it("drops a body answer that arrives after the calls were reloaded", async () => {
    api.list.mockResolvedValue({ ok: true, calls: CALLS, mayBeBounded: false });
    let answer!: (value: unknown) => void;
    api.body.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "View the body of segments.json",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await screen.findByText("4 unique requests (4 calls).");

    await act(async () => {
      answer({
        status: "ok",
        call: CALLS[0],
        body: { text: '{"stale":true}', fullLength: 14, isBinary: false },
      });
    });
    expect(screen.queryByText(/stale/)).not.toBeInTheDocument();
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
    expect(api.body).toHaveBeenCalledWith(EXT_ID, key("segments.json"));
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
      {
        status: "body_unavailable",
        tooLargeToRedact: true,
        fullLength: 150_000,
        call: CALLS[0],
      },
      "The body is 150,000 characters. Redaction takes at most 100,000 characters of text at once; a longer JSON body is redacted value by value, but this one is not JSON, has a single value over that limit, or has text that runs from one value into the next. It was withheld (not shown or kept) rather than shown partly redacted.",
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

describe("calls grouped by resource", () => {
  /** What three page loads of the Client look like: the same files, each with a cache-buster. */
  const threeLoads = [1, 2, 3].flatMap((load) => [
    call({
      requestId: `styles-${load}`,
      resourceName: "styles.json",
      url: `https://cdn.apty.example/styles.json?timestamp=${load}`,
      timestamp: load * 10,
    }),
    call({
      requestId: `rules-${load}`,
      resourceName: "rules.json",
      url: `https://cdn.apty.example/rules.json?timestamp=${load}`,
      timestamp: load * 10 + 1,
      ...(load === 2 ? { status: 503 } : {}),
    }),
  ]);

  it("shows the same request over three loads as one row x3, and counts both", async () => {
    api.list.mockResolvedValue({
      ok: true,
      calls: threeLoads,
      mayBeBounded: false,
    });
    renderPanel();

    expect(
      await screen.findByText("2 unique requests (6 calls)."),
    ).toBeInTheDocument();
    const row = screen.getByText("styles.json").closest("tr") as HTMLElement;
    expect(within(row).getByText("×3")).toBeInTheDocument();
    expect(screen.getAllByText("styles.json")).toHaveLength(1);
    expect(within(row).getByText("200")).toBeInTheDocument();
  });

  it("marks a resource where some call failed, and lists its calls on request", async () => {
    api.list.mockResolvedValue({
      ok: true,
      calls: threeLoads,
      mayBeBounded: false,
    });
    renderPanel();
    const row = (await screen.findByText("rules.json")).closest(
      "tr",
    ) as HTMLElement;

    expect(within(row).getByText("1 of 3 failed")).toBeInTheDocument();
    const styles = screen.getByText("styles.json").closest("tr") as HTMLElement;
    expect(within(styles).queryByText(/failed/)).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("group-call")).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("button", { name: "Show the calls of rules.json" }),
    );
    const history = screen.getAllByTestId("group-call");
    expect(history).toHaveLength(3);
    expect(
      within(history[1] as HTMLElement).getByText("503"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/rules\.json\?timestamp=/)).toHaveLength(3);
  });

  it("matches a resource to a status class by its latest call or any failed call", () => {
    const groups = groupByResource(threeLoads);
    const names = (statusClass: Parameters<typeof filterResourceGroups>[2]) =>
      filterResourceGroups(groups, "", statusClass).map((g) => g.resourceName);

    expect(names("all").sort()).toEqual(["rules.json", "styles.json"]);
    expect(names("5xx")).toEqual(["rules.json"]);
    expect(names("4xx")).toEqual([]);
    expect(names("failed")).toEqual([]);
    const withNetworkFailure = groupByResource([
      ...threeLoads,
      call({
        requestId: "styles-down",
        resourceName: "styles.json",
        status: undefined,
        failed: true,
        timestamp: 5,
      }),
    ]);
    expect(
      filterResourceGroups(withNetworkFailure, "", "failed").map(
        (g) => g.resourceName,
      ),
    ).toEqual(["styles.json"]);
    expect(filterResourceGroups(groups, "RULES", "5xx")).toHaveLength(1);
    expect(filterResourceGroups(groups, "styles", "5xx")).toEqual([]);
  });

  it("reads the body of a resource by its key and says which older call it comes from", async () => {
    api.list.mockResolvedValue({
      ok: true,
      calls: threeLoads,
      mayBeBounded: false,
    });
    api.body.mockResolvedValue({
      status: "ok",
      call: threeLoads[0],
      newerCallsWithoutBody: 2,
      body: { text: '{"sales-team":[]}', fullLength: 16, isBinary: false },
    });
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "View the body of rules.json",
      }),
    );

    expect(await screen.findByText(/sales-team/)).toBeInTheDocument();
    expect(api.body).toHaveBeenCalledWith(EXT_ID, key("rules.json"));
    expect(
      screen.getByText(/the 2 newer call\(s\) of this resource have none/),
    ).toBeInTheDocument();
  });

  it.each([
    ["too-large", /over its size limit/],
    ["evicted", /replaced it/],
    ["unreadable", /could not read this response's body/],
    ["none", /This call has no body\./],
  ])("shows why a body is missing: %s", async (reason, text) => {
    api.list.mockResolvedValue({
      ok: true,
      calls: threeLoads,
      mayBeBounded: false,
    });
    api.body.mockResolvedValue({
      status: "body_unavailable",
      call: threeLoads[1],
      reason,
    });
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "View the body of styles.json",
      }),
    );

    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("downloads every raw call of the shown resources plus a summary per resource", async () => {
    api.list.mockResolvedValue({
      ok: true,
      calls: threeLoads,
      mayBeBounded: false,
    });
    renderPanel();
    await screen.findByText("rules.json");
    fireEvent.click(screen.getByRole("button", { name: "5xx" }));
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));

    const parsed = JSON.parse(download.mock.calls[0]?.[1] as string);
    expect(parsed.calls).toHaveLength(3);
    expect(
      parsed.calls.every((c: NetworkCall) => c.resourceName === "rules.json"),
    ).toBe(true);
    expect(parsed.groups).toEqual([
      expect.objectContaining({
        key: key("rules.json"),
        calls: 3,
        failedCalls: 1,
        latestStatus: 200,
      }),
    ]);
    expect(parsed).toMatchObject({
      redactionMode: "strict",
      uniqueRequests: { shown: 1, total: 2 },
      total: 6,
    });
  });

  it("mentions failed history saves when the Client counts them", async () => {
    api.list.mockResolvedValue({
      ok: true,
      calls: threeLoads,
      mayBeBounded: false,
      saveFailures: 4,
    });
    renderPanel();
    expect(
      await screen.findByText(/could not save its call history 4 times/),
    ).toBeInTheDocument();
  });
});
