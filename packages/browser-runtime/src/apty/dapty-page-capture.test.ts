import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendCommand: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  denyList: vi.fn(),
  peekTabRequests: vi.fn(),
}));

vi.mock("../automation/cdp-commander.js", () => ({
  CdpCommander: class {
    constructor(readonly tabId: number) {}
    sendCommand = mocks.sendCommand;
  },
}));

vi.mock("../automation/debugger-manager.js", () => ({
  debuggerManager: {
    safeAttachDebugger: mocks.attach,
    safeDetachDebugger: mocks.detach,
  },
}));

vi.mock("./extension-network-inspector.js", () => ({
  loadBodyDenyList: mocks.denyList,
}));

vi.mock("./network-capture-session.js", () => ({
  peekTabRequests: mocks.peekTabRequests,
}));

type Listener = (...args: never[]) => unknown;

function event() {
  const listeners: Listener[] = [];
  return {
    listeners,
    addListener: vi.fn((listener: Listener) => listeners.push(listener)),
    removeListener: vi.fn((listener: Listener) => {
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    }),
    fire: (...args: unknown[]) => {
      for (const listener of [...listeners]) listener(...args);
    },
  };
}

const AGENT_ID = "bpiondflhhdplemamgggcdajclmoeple";
const session: Record<string, unknown> = {};

const chromeMock = {
  runtime: { id: AGENT_ID, sendMessage: vi.fn() },
  webRequest: {
    onBeforeRequest: event(),
    onCompleted: event(),
    onErrorOccurred: event(),
  },
  debugger: { onEvent: event(), onDetach: event() },
  tabs: { onRemoved: event() },
  alarms: { create: vi.fn(), clear: vi.fn(), onAlarm: event() },
  storage: {
    session: {
      get: vi.fn(async (key: string) => ({ [key]: session[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(session, structuredClone(items));
      }),
      remove: vi.fn(async (key: string) => {
        delete session[key];
      }),
    },
  },
};
(globalThis as { chrome?: unknown }).chrome = chromeMock;

const {
  __resetDaptyPageCapture,
  classifyDaptyUrl,
  DAPTY_PAGE_CALLS_MESSAGE,
  getDaptyPageCalls,
  handleDaptyCaptureMessage,
  MAX_BODY_CHARS,
  MAX_CALLS_PER_TAB,
  RECORDING_KEEPALIVE_ALARM_NAME,
  recordDaptyChat,
  startDaptyPageCapture,
  stopDaptyRecording,
} = await import("./dapty-page-capture");

const TAB = 7;
const CHAT_URL =
  "https://ai.apty.example/ai-service/api/v1/ai/tenant-1/widget/chat?applicationId=app-9";
const STREAM_URL =
  "https://ai.apty.example/ai-service/api/v1/ai/tenant-1/widget/chat/stream?applicationId=app-9";
const LIST_URL =
  "https://content.apty.example/tenant-1/app-9/users/u-1/widget-chat/chat-list.json";
const STORED_URL =
  "https://content.apty.example/tenant-1/app-9/users/u-1/widget-chat/c-42.json";
const REQUEST = JSON.stringify({
  message: "Wie lege ich einen Lieferanten an? 🚚",
  context: [],
  envId: "prod",
  applicationType: "web",
});
const REPLY = JSON.stringify({
  reply: "Use the workflow below.",
  suggestions: [{ id: "wf-1", name: "Create vendor", type: "workflow" }],
});

let requestCounter = 0;

function postChat(
  body: string,
  options: { tabId?: number; url?: string; splitAt?: number } = {},
) {
  const bytes = new TextEncoder().encode(body);
  const splitAt = options.splitAt ?? bytes.length;
  const requestId = String(++requestCounter);
  chromeMock.webRequest.onBeforeRequest.fire({
    requestId,
    tabId: options.tabId ?? TAB,
    url: options.url ?? CHAT_URL,
    method: "POST",
    timeStamp: Date.now(),
    requestBody: {
      raw: [
        { bytes: bytes.slice(0, splitAt).buffer },
        { bytes: bytes.slice(splitAt).buffer },
      ],
    },
  });
  return requestId;
}

function complete(requestId: string, statusCode: number, url = CHAT_URL) {
  chromeMock.webRequest.onCompleted.fire({
    requestId,
    tabId: TAB,
    url,
    method: "POST",
    statusCode,
  });
}

async function callsSettled(
  expected: (calls: Awaited<ReturnType<typeof getDaptyPageCalls>>) => boolean,
) {
  let last: Awaited<ReturnType<typeof getDaptyPageCalls>> = [];
  await vi.waitFor(
    async () => {
      last = await getDaptyPageCalls(TAB);
      if (!expected(last)) throw new Error(`not yet ${JSON.stringify(last)}`);
    },
    { timeout: 2000, interval: 5 },
  );
  return last;
}

function cdp(method: string, params: object, tabId = TAB) {
  chromeMock.debugger.onEvent.fire({ tabId }, method, params);
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of Object.keys(session)) delete session[key];
  vi.stubGlobal("ServiceWorkerGlobalScope", class {});
  mocks.denyList.mockResolvedValue([]);
  mocks.attach.mockResolvedValue(true);
  mocks.detach.mockResolvedValue(undefined);
  mocks.peekTabRequests.mockReturnValue(null);
  mocks.sendCommand.mockResolvedValue({});
  chromeMock.storage.session.get.mockImplementation(async (key: string) => ({
    [key]: session[key],
  }));
  chromeMock.storage.session.set.mockImplementation(
    async (items: Record<string, unknown>) => {
      Object.assign(session, structuredClone(items));
    },
  );
  chromeMock.storage.session.remove.mockImplementation(async (key: string) => {
    delete session[key];
  });
  for (const group of [
    chromeMock.webRequest.onBeforeRequest,
    chromeMock.webRequest.onCompleted,
    chromeMock.webRequest.onErrorOccurred,
    chromeMock.debugger.onEvent,
    chromeMock.debugger.onDetach,
    chromeMock.tabs.onRemoved,
    chromeMock.alarms.onAlarm,
  ]) {
    group.listeners.length = 0;
    group.addListener.mockImplementation((listener: Listener) =>
      group.listeners.push(listener),
    );
    group.removeListener.mockImplementation((listener: Listener) => {
      const index = group.listeners.indexOf(listener);
      if (index !== -1) group.listeners.splice(index, 1);
    });
  }
  __resetDaptyPageCapture();
  startDaptyPageCapture();
});

afterEach(() => {
  __resetDaptyPageCapture();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("classifyDaptyUrl", () => {
  it("names the chat POSTs and the stored-chat GETs, and nothing else", () => {
    expect(classifyDaptyUrl(CHAT_URL, "post")).toBe("chat");
    expect(classifyDaptyUrl(STREAM_URL, "POST")).toBe("chat");
    expect(classifyDaptyUrl(LIST_URL, "GET")).toBe("chat-list");
    expect(classifyDaptyUrl(STORED_URL, "GET")).toBe("stored-chat");
    expect(classifyDaptyUrl(CHAT_URL, "GET")).toBeNull();
    expect(
      classifyDaptyUrl(
        "https://ai.apty.example/ai-service/api/v1/ai/t/widget/chat/history",
        "POST",
      ),
    ).toBeNull();
    expect(classifyDaptyUrl("not a url", "POST")).toBeNull();
  });
});

describe("passive capture", () => {
  it("registers webRequest with the request body and a narrow URL filter", () => {
    expect(
      chromeMock.webRequest.onBeforeRequest.addListener,
    ).toHaveBeenCalledWith(
      expect.any(Function),
      { urls: ["*://*/*ai-service/api/v1/ai/*"] },
      ["requestBody"],
    );
  });

  it("decodes a body split mid-character across raw parts, and adds the status when the call completes", async () => {
    const id = postChat(REQUEST, { splitAt: REQUEST.indexOf("🚚") + 2 });
    complete(id, 200);

    const calls = await callsSettled((c) => c[0]?.status === 200);

    expect(calls).toEqual([
      {
        source: "page",
        kind: "chat",
        url: CHAT_URL,
        method: "POST",
        status: 200,
        requestBody: REQUEST,
        timestamp: expect.any(Number),
      },
    ]);
  });

  it("records the stream endpoint and a failed call, and ignores calls outside a tab", async () => {
    postChat(REQUEST, { tabId: -1 });
    const id = postChat(REQUEST, { url: STREAM_URL });
    chromeMock.webRequest.onErrorOccurred.fire({
      requestId: id,
      tabId: TAB,
      url: STREAM_URL,
      method: "POST",
      error: "net::ERR_BLOCKED_BY_CLIENT",
    });

    const calls = await callsSettled((c) => c[0]?.failed === true);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: STREAM_URL,
      failed: true,
      errorText: "net::ERR_BLOCKED_BY_CLIENT",
    });
  });

  it("keeps the newest 20 calls per tab and drops a body over 1,000,000 characters", async () => {
    for (let i = 0; i < MAX_CALLS_PER_TAB + 5; i++) {
      postChat(JSON.stringify({ message: `q${i}` }));
    }
    postChat(`"${"x".repeat(MAX_BODY_CHARS)}"`);

    const calls = await callsSettled((c) => c.length === MAX_CALLS_PER_TAB);
    await vi.waitFor(async () => {
      const latest = await getDaptyPageCalls(TAB);
      expect(latest.at(-1)?.requestBody).toBeUndefined();
    });

    expect(calls[0]?.requestBody).toBe(JSON.stringify({ message: "q6" }));
  });

  it("does not keep the body of a URL on the body deny list", async () => {
    mocks.denyList.mockResolvedValue(["ai.apty.example"]);
    postChat(REQUEST);

    const calls = await callsSettled((c) => c.length === 1);

    expect(calls[0]).not.toHaveProperty("requestBody");
  });

  it("keeps the calls in session storage across a service-worker restart, and drops them when the tab closes", async () => {
    postChat(REQUEST);
    await callsSettled((c) => c.length === 1);

    __resetDaptyPageCapture();
    startDaptyPageCapture();
    expect(await getDaptyPageCalls(TAB)).toHaveLength(1);
    expect(chromeMock.storage.session.set).toHaveBeenCalled();

    chromeMock.tabs.onRemoved.fire(TAB);
    await vi.waitFor(() => expect(Object.keys(session)).toEqual([]));
    __resetDaptyPageCapture();
    expect(await getDaptyPageCalls(TAB)).toEqual([]);
  });
});

describe("recording on demand", () => {
  it("records the chat POST with both bodies and the stored-chat GETs", async () => {
    mocks.sendCommand.mockImplementation(async (command: string) => {
      if (command === "Network.getRequestPostData")
        return { postData: REQUEST };
      if (command === "Network.getResponseBody") {
        return { body: btoa(REPLY), base64Encoded: true };
      }
      return {};
    });

    expect(await recordDaptyChat(TAB, { maxMs: 5000 })).toEqual({
      ok: true,
      until: expect.any(Number),
    });
    expect(mocks.sendCommand).toHaveBeenCalledWith("Network.enable", {});
    expect(chromeMock.alarms.create).toHaveBeenCalledWith(
      RECORDING_KEEPALIVE_ALARM_NAME,
      expect.anything(),
    );

    cdp("Network.requestWillBeSent", {
      requestId: "r1",
      request: { url: CHAT_URL, method: "POST", hasPostData: true },
    });
    cdp("Network.responseReceived", {
      requestId: "r1",
      response: { status: 200 },
    });
    cdp("Network.loadingFinished", { requestId: "r1" });
    cdp("Network.requestWillBeSent", {
      requestId: "r2",
      request: { url: LIST_URL, method: "GET" },
    });
    cdp("Network.loadingFailed", {
      requestId: "r2",
      errorText: "net::ERR_FAILED",
    });
    cdp("Network.requestWillBeSent", {
      requestId: "r3",
      request: { url: "https://app.example/other.json", method: "GET" },
    });
    cdp(
      "Network.requestWillBeSent",
      {
        requestId: "r4",
        request: { url: CHAT_URL, method: "POST" },
      },
      99,
    );

    const calls = await callsSettled(
      (c) => c.length === 2 && c[0]?.responseBody !== undefined,
    );

    expect(calls).toEqual([
      expect.objectContaining({
        kind: "chat",
        status: 200,
        requestBody: REQUEST,
        responseBody: REPLY,
      }),
      expect.objectContaining({
        kind: "chat-list",
        url: LIST_URL,
        method: "GET",
        failed: true,
        errorText: "net::ERR_FAILED",
      }),
    ]);
  });

  it("merges a call both sources saw into one record", async () => {
    await recordDaptyChat(TAB);
    const id = postChat(REQUEST);
    complete(id, 200);
    mocks.sendCommand.mockResolvedValue({ body: REPLY });
    cdp("Network.requestWillBeSent", {
      requestId: "r1",
      request: { url: CHAT_URL, method: "POST", postData: REQUEST },
    });
    cdp("Network.loadingFinished", { requestId: "r1" });

    const calls = await callsSettled((c) => c[0]?.responseBody === REPLY);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      requestBody: REQUEST,
      responseBody: REPLY,
    });
  });

  it("does not fetch bodies of a URL on the deny list", async () => {
    mocks.denyList.mockResolvedValue(["/widget-chat/"]);
    await recordDaptyChat(TAB);
    cdp("Network.requestWillBeSent", {
      requestId: "r1",
      request: { url: STORED_URL, method: "GET" },
    });
    cdp("Network.loadingFinished", { requestId: "r1" });

    const calls = await callsSettled((c) => c.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls[0]).toMatchObject({ kind: "stored-chat" });
    expect(mocks.sendCommand).not.toHaveBeenCalledWith(
      "Network.getResponseBody",
      expect.anything(),
    );
  });

  it("stops and detaches after maxMs, but leaves a running network capture attached", async () => {
    vi.useFakeTimers();
    await recordDaptyChat(TAB, { maxMs: 2000 });
    await vi.advanceTimersByTimeAsync(2000);

    expect(mocks.detach).toHaveBeenCalledWith(TAB, true);
    expect(chromeMock.debugger.onEvent.listeners).toHaveLength(0);
    expect(chromeMock.alarms.clear).toHaveBeenCalledWith(
      RECORDING_KEEPALIVE_ALARM_NAME,
    );

    mocks.detach.mockClear();
    mocks.peekTabRequests.mockReturnValue([]);
    await recordDaptyChat(TAB);
    await stopDaptyRecording(TAB);
    expect(mocks.detach).not.toHaveBeenCalled();
  });

  it("reports why it could not record", async () => {
    mocks.attach.mockResolvedValue(false);
    expect(await recordDaptyChat(TAB)).toEqual({
      ok: false,
      reason: "attach-failed",
    });

    mocks.attach.mockResolvedValue(true);
    mocks.sendCommand.mockRejectedValue(new Error("no"));
    expect(await recordDaptyChat(TAB)).toEqual({
      ok: false,
      reason: "network-enable-failed",
    });
    expect(chromeMock.debugger.onEvent.listeners).toHaveLength(0);
    expect(mocks.detach).toHaveBeenCalledWith(TAB, true);
  });
});

describe("reading from another context", () => {
  it("asks the service worker outside it", async () => {
    vi.unstubAllGlobals();
    chromeMock.runtime.sendMessage.mockResolvedValue({
      calls: [{ kind: "chat" }],
    });

    expect(await getDaptyPageCalls(TAB)).toEqual([{ kind: "chat" }]);
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: DAPTY_PAGE_CALLS_MESSAGE,
      tabId: TAB,
    });

    chromeMock.runtime.sendMessage.mockRejectedValue(new Error("no worker"));
    expect(await getDaptyPageCalls(TAB)).toEqual([]);
    expect(await recordDaptyChat(TAB)).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("answers this extension's own pages only", async () => {
    postChat(REQUEST);
    await callsSettled((c) => c.length === 1);
    const ownPage = {
      id: AGENT_ID,
      url: `chrome-extension://${AGENT_ID}/sidepanel.html`,
    };

    const answer = await new Promise((resolve) => {
      expect(
        handleDaptyCaptureMessage(
          { type: DAPTY_PAGE_CALLS_MESSAGE, tabId: TAB },
          ownPage,
          resolve,
        ),
      ).toBe(true);
    });
    expect(answer).toEqual({
      calls: [expect.objectContaining({ kind: "chat" })],
    });

    const refused = vi.fn();
    expect(
      handleDaptyCaptureMessage(
        { type: DAPTY_PAGE_CALLS_MESSAGE, tabId: TAB },
        { id: AGENT_ID, url: "https://evil.example/" },
        refused,
      ),
    ).toBe(false);
    expect(refused).toHaveBeenCalledWith(undefined);
    expect(
      handleDaptyCaptureMessage({ type: "something-else" }, ownPage, refused),
    ).toBe(false);
  });
});
