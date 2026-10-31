/**
 * The Widget team's reference service worker (docs/integrations/apty) against
 * this Agent's consumer: its answers must pass the consumer's own zod
 * schemas, and the real panel functions must read them, so the two sides
 * cannot drift apart.
 */
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConfiguredServiceWorkerDiagnosticsProvider,
  MAX_BODY_CHARS_ACCEPTED,
  resourceBodyResponseSchema,
  resourcesResponseSchema,
  widgetChatResponseSchema,
} from "./service-worker-diagnostics";

const AGENT_ID = "bpiondflhhdplemamgggcdajclmoeple";
const WIDGET_ID = "abcdefghijklmnopabcdefghijklmnop";
const REFERENCE = fileURLToPath(
  new URL(
    "../../../../docs/integrations/apty/apty-widget-service-worker.reference.ts",
    import.meta.url,
  ),
);

type Listener = (
  message: unknown,
  sender: { id?: string },
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

const store = vi.hoisted(() => ({
  local: {} as Record<string, unknown>,
  session: {} as Record<string, unknown>,
  listener: undefined as Listener | undefined,
}));

function area(data: Record<string, unknown>) {
  return {
    get: vi.fn(async (key: string) => ({ [key]: data[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, structuredClone(items));
    }),
  };
}

(globalThis as { chrome?: unknown }).chrome = {
  runtime: {
    id: AGENT_ID,
    lastError: undefined,
    onSuspend: { addListener: vi.fn() },
    onMessageExternal: {
      addListener: (listener: Listener) => {
        store.listener = listener;
      },
    },
    // The Agent's sendMessage reaches the Widget's listener as Chrome would.
    sendMessage: (
      _id: string,
      message: unknown,
      callback: (response: unknown) => void,
    ) => {
      const answered = store.listener?.(message, { id: AGENT_ID }, callback);
      if (answered !== true) callback(undefined);
    },
  },
  storage: {
    local: area(store.local),
    session: area(store.session),
    onChanged: { addListener: vi.fn() },
  },
};

type Reference = {
  observedFetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  DEBUG_AGENT_EXTENSION_IDS: readonly string[];
  handleNetworkMessage: (
    message: { type?: unknown; requestId?: unknown },
    sendResponse: (response: unknown) => void,
  ) => boolean;
  recordWidgetChatTurn: (
    chatId: string,
    name: string,
    messages: ReadonlyArray<{
      id?: string;
      role: string;
      content: string;
      suggestions?: ReadonlyArray<{ id: string; name: string; type: string }>;
    }>,
  ) => void;
};

const SEGMENTS = Array.from({ length: 206 }, (_, i) => ({
  id: 4000 + i,
  name: `segment-${i}`,
}));

function serve(fullUrl: string): Response {
  const url = fullUrl.split("?")[0] ?? fullUrl;
  if (url.endsWith("/segments.json")) {
    return Response.json(SEGMENTS);
  }
  if (url.endsWith("/missing.json")) {
    return Response.json({ error: "Not Found" }, { status: 404 });
  }
  if (url.endsWith("/logo.png")) {
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { "content-type": "image/png" },
    });
  }
  if (url.endsWith("/huge.json")) {
    return new Response(`"${"x".repeat(MAX_BODY_CHARS_ACCEPTED + 1)}"`, {
      headers: { "content-type": "application/json" },
    });
  }
  throw new TypeError("Failed to fetch");
}

async function loadReference(): Promise<Reference> {
  vi.resetModules();
  return (await import(REFERENCE)) as Reference;
}

async function ask(message: unknown, senderId = AGENT_ID): Promise<unknown> {
  return new Promise((resolve) => {
    const answered = store.listener?.(message, { id: senderId }, resolve);
    if (answered !== true) resolve("no answer");
  });
}

const NETWORK_KEY = "apty_sw_network_calls";

interface SavedNetwork {
  calls: Array<{ requestId: string; status?: number; failed?: boolean }>;
  bodies: Record<string, unknown>;
}

/** Recording happens after the Widget has its Response; wait until the debounced write holds what `done` expects. */
async function saved(done: (state: SavedNetwork) => boolean) {
  await vi.waitFor(
    () => {
      const state = store.session[NETWORK_KEY] as SavedNetwork | undefined;
      if (!state || !done(state)) throw new Error("not saved yet");
    },
    { timeout: 4000, interval: 20 },
  );
}

const answered = (state: SavedNetwork) =>
  state.calls.every((c) => c.status !== undefined || c.failed);

const list = () => ask({ type: "apty-debug-agent:list-observed-resources" });
const body = (requestId: string) =>
  ask({ type: "apty-debug-agent:get-resource-body", requestId });

beforeEach(() => {
  for (const data of [store.local, store.session]) {
    for (const key of Object.keys(data)) delete data[key];
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      serve(input instanceof Request ? input.url : String(input)),
    ),
  );
});

async function recordCalls(reference: Reference) {
  const { observedFetch } = reference;
  const segments = await observedFetch(
    "https://cdn.apty.example/segments.json",
  );
  await observedFetch("https://cdn.apty.example/missing.json");
  await observedFetch(
    new Request("https://cdn.apty.example/logo.png", { method: "post" }),
  );
  await observedFetch("https://cdn.apty.example/huge.json");
  await expect(
    observedFetch("https://cdn.apty.example/offline.json"),
  ).rejects.toThrow("Failed to fetch");
  await saved(
    (state) =>
      state.calls.length === 5 &&
      answered(state) &&
      Object.keys(state.bodies).length === 3,
  );
  return segments;
}

describe("the Widget reference service worker", () => {
  it("answers the list and body messages in the shapes the Agent accepts", async () => {
    const reference = await loadReference();
    const segments = await recordCalls(reference);
    expect(await segments.json()).toHaveLength(206);

    const listed = resourcesResponseSchema.parse(await list());
    expect(
      listed.resources.map(({ url, method, status, mimeType, failed }) => ({
        name: url.split("/").at(-1),
        method,
        status,
        mimeType,
        failed,
      })),
    ).toEqual([
      {
        name: "segments.json",
        method: "GET",
        status: 200,
        mimeType: "application/json",
        failed: undefined,
      },
      {
        name: "missing.json",
        method: "GET",
        status: 404,
        mimeType: "application/json",
        failed: undefined,
      },
      {
        name: "logo.png",
        method: "POST",
        status: 200,
        mimeType: "image/png",
        failed: undefined,
      },
      {
        name: "huge.json",
        method: "GET",
        status: 200,
        mimeType: "application/json",
        failed: undefined,
      },
      {
        name: "offline.json",
        method: "GET",
        status: undefined,
        mimeType: undefined,
        failed: true,
      },
    ]);
    expect(listed.resources.at(-1)?.errorText).toBe("Failed to fetch");
    expect(new Set(listed.resources.map((r) => r.requestId)).size).toBe(5);

    const [seg, missing, logo, huge, offline] = listed.resources;
    const segBody = resourceBodyResponseSchema.parse(
      await body(seg!.requestId),
    );
    expect(JSON.parse(segBody.body ?? "")).toHaveLength(206);
    expect(segBody.base64Encoded).toBe(false);
    expect(
      resourceBodyResponseSchema.parse(await body(missing!.requestId)).body,
    ).toContain("Not Found");
    expect(
      resourceBodyResponseSchema.parse(await body(logo!.requestId)),
    ).toEqual({
      found: true,
      body: btoa(String.fromCharCode(137, 80, 78, 71)),
      base64Encoded: true,
    });
    expect(
      resourceBodyResponseSchema.parse(await body(huge!.requestId)),
    ).toEqual({ found: false, reason: "too-large" });
    expect(await body(offline!.requestId)).toEqual({
      found: false,
      reason: "none",
    });
    expect(await body("unknown")).toEqual({ found: false, reason: "evicted" });
    expect(listed.resources.map((r) => r.hasBody)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("answers only the Agent's IDs, and ignores a body request without an ID", async () => {
    const reference = await loadReference();
    expect(reference.DEBUG_AGENT_EXTENSION_IDS).toContain(AGENT_ID);

    expect(
      await ask(
        { type: "apty-debug-agent:list-observed-resources" },
        WIDGET_ID,
      ),
    ).toBe("no answer");
    expect(await ask({ type: "apty-debug-agent:get-resource-body" })).toBe(
      "no answer",
    );
    expect(await ask({ type: "something-else" })).toBe("no answer");
  });

  it("serves the network verbs to a host's own listener through handleNetworkMessage, and leaves other messages to it", async () => {
    const reference = await loadReference();
    await reference.observedFetch("https://cdn.apty.example/segments.json");
    await saved((state) => state.calls.length === 1 && answered(state));

    const sendResponse = vi.fn();
    expect(
      reference.handleNetworkMessage(
        { type: "apty-debug-agent:list-observed-resources" },
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
    expect(
      resourcesResponseSchema.parse(sendResponse.mock.calls[0]?.[0]).resources,
    ).toHaveLength(1);

    for (const message of [
      { type: "apty-debug-agent:get-service-worker-status" },
      { type: "apty-debug-agent:get-resource-body" },
    ]) {
      expect(reference.handleNetworkMessage(message, vi.fn())).toBe(false);
    }
  });

  it("keeps a JSON body of about 700,000 characters, as large as the Client's themes.json, and the panel reads it whole", async () => {
    const themes = Array.from({ length: 6000 }, (_, i) => ({
      id: i,
      name: `theme-${i}`,
      css: "x".repeat(80),
    }));
    const text = JSON.stringify(themes);
    expect(text.length).toBeGreaterThan(600_000);
    expect(text.length).toBeLessThan(MAX_BODY_CHARS_ACCEPTED);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(text, {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const reference = await loadReference();
    await reference.observedFetch("https://cdn.apty.example/themes.json");
    await saved(
      (state) =>
        state.calls.length === 1 &&
        answered(state) &&
        Object.keys(state.bodies).length === 1,
    );

    const [call] = resourcesResponseSchema.parse(await list()).resources;
    expect(
      resourceBodyResponseSchema.parse(await body(call!.requestId)).body,
    ).toHaveLength(text.length);

    const { readClientNetworkCallBody } = await import(
      "./client-network-calls"
    );
    const read = await readClientNetworkCallBody(WIDGET_ID, call!.requestId);
    expect(read).toMatchObject({ status: "ok", body: { isBinary: false } });
    expect("body" in read && read.body?.fullLength).toBe(text.length);
  });

  it("keeps at most 1000 calls, one body for one resource, in session storage only, across a restart", async () => {
    const reference = await loadReference();
    for (let i = 0; i < 1005; i++) {
      await reference.observedFetch(
        `https://cdn.apty.example/segments.json?timestamp=${i}`,
      );
    }
    await saved(
      (state) =>
        state.calls.length === 1000 &&
        answered(state) &&
        Object.keys(state.bodies).length === 1,
    );
    const first = resourcesResponseSchema.parse(await list()).resources;
    expect(first).toHaveLength(1000);
    const withBody = first.filter((call) => call.hasBody);
    expect(withBody.map((c) => c.requestId)).toEqual([first.at(-1)?.requestId]);
    expect(
      resourceBodyResponseSchema.parse(await body(withBody[0]!.requestId))
        .found,
    ).toBe(true);
    expect(
      resourceBodyResponseSchema.parse(await body(first[0]!.requestId)),
    ).toEqual({ found: false, reason: "evicted" });
    expect(Object.keys(store.local).some((k) => k.includes("network"))).toBe(
      false,
    );

    await loadReference();
    const afterRestart = resourcesResponseSchema.parse(await list()).resources;
    expect(afterRestart.map((c) => c.requestId)).toEqual(
      first.map((c) => c.requestId),
    );
  });

  it("is read end to end by the Agent's Widget network calls panel", async () => {
    const reference = await loadReference();
    await recordCalls(reference);
    const { listClientNetworkCalls, readClientNetworkCallBody } = await import(
      "./client-network-calls"
    );

    const listed = await listClientNetworkCalls(WIDGET_ID);
    expect(listed).toMatchObject({ ok: true, mayBeBounded: false });
    if (!listed.ok) return;
    expect(listed.calls.map((c) => c.resourceName)).toEqual([
      "segments.json",
      "missing.json",
      "logo.png",
      "huge.json",
      "offline.json",
    ]);

    const [seg, missing, logo, huge, offline] = listed.calls;
    const segments = await readClientNetworkCallBody(WIDGET_ID, seg!.requestId);
    expect(segments).toMatchObject({ status: "ok" });
    expect(
      "body" in segments && JSON.parse(segments.body?.text ?? "null"),
    ).toHaveLength(206);
    expect(
      await readClientNetworkCallBody(WIDGET_ID, missing!.requestId),
    ).toMatchObject({ status: "http_error", body: { isBinary: false } });
    expect(
      await readClientNetworkCallBody(WIDGET_ID, logo!.requestId),
    ).toMatchObject({ status: "ok", body: { isBinary: true } });
    expect(
      await readClientNetworkCallBody(WIDGET_ID, huge!.requestId),
    ).toMatchObject({ status: "body_unavailable" });
    expect(
      await readClientNetworkCallBody(WIDGET_ID, offline!.requestId),
    ).toMatchObject({ status: "failed" });
  });
});

describe("observedFetch never slows or changes the Widget's own fetch", () => {
  const ID = "4815162342";
  const DOB = "1980-01-01";

  /** A response whose body arrives only when the test says so. */
  function heldResponse(contentType = "application/json") {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      cancel: cancelled,
    });
    const response = new Response(stream, {
      headers: { "content-type": contentType },
    });
    const encoder = new TextEncoder();
    return {
      response,
      cancelled,
      send: (text: string) => controller.enqueue(encoder.encode(text)),
      end: () => controller.close(),
    };
  }

  function fetchReturns(response: Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
  }

  it("resolves while the body stream is still pending, then keeps the body once it ends", async () => {
    const reference = await loadReference();
    const held = heldResponse();
    fetchReturns(held.response);
    held.send('{"partial":');

    const response = await reference.observedFetch(
      "https://cdn.apty.example/slow.json",
    );
    expect(response).toBe(held.response);
    await saved((state) => state.calls[0]?.status === 200);
    const [call] = resourcesResponseSchema.parse(await list()).resources;
    expect(await body(call!.requestId)).toEqual({ found: false });

    held.send("true}");
    held.end();
    await saved((state) => call!.requestId in state.bodies);
    expect(
      resourceBodyResponseSchema.parse(await body(call!.requestId)),
    ).toEqual({ found: true, body: '{"partial":true}', base64Encoded: false });
    expect(await response.json()).toEqual({ partial: true });
  });

  it("stops reading a body at the Agent's limit and does not keep the cut body", async () => {
    const reference = await loadReference();
    const held = heldResponse();
    fetchReturns(held.response);
    const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel");
    for (let i = 0; i < 5; i++) {
      held.send("x".repeat(MAX_BODY_CHARS_ACCEPTED / 4));
    }

    const response = await reference.observedFetch(
      "https://cdn.apty.example/endless.json",
    );

    await vi.waitFor(() => expect(cancel).toHaveBeenCalled(), {
      timeout: 4000,
    });
    cancel.mockRestore();
    await saved((state) => state.calls[0]?.status === 200);
    const [call] = resourcesResponseSchema.parse(await list()).resources;
    expect(
      resourceBodyResponseSchema.parse(await body(call!.requestId)),
    ).toEqual({ found: false, reason: "too-large" });
    // Only the clone was cancelled: the Widget still reads its whole body.
    expect(held.cancelled).not.toHaveBeenCalled();
    held.end();
    expect(await response.text()).toHaveLength(
      (MAX_BODY_CHARS_ACCEPTED / 4) * 5,
    );
  });

  it("records a relative URL as fetch resolves it in the service worker, and the panel masks it", async () => {
    vi.stubGlobal("location", {
      href: `chrome-extension://${WIDGET_ID}/background.js`,
    });
    const reference = await loadReference();
    fetchReturns(Response.json({ ok: true }));

    await reference.observedFetch(`/api/users/${ID}.json?dob=${DOB}`);
    await saved((state) => answered(state) && state.calls.length === 1);

    const [call] = resourcesResponseSchema.parse(await list()).resources;
    expect(call?.url).toBe(
      `chrome-extension://${WIDGET_ID}/api/users/${ID}.json?dob=${DOB}`,
    );
    const { listClientNetworkCalls } = await import("./client-network-calls");
    const shown = await listClientNetworkCalls(WIDGET_ID);
    expect(shown).toMatchObject({ ok: true });
    expect(JSON.stringify(shown)).not.toMatch(new RegExp(`${ID}|${DOB}`));
  });

  it("writes the state to session storage once the calls pause, not once per call", async () => {
    const reference = await loadReference();
    const set = chrome.storage.session.set as ReturnType<typeof vi.fn>;
    set.mockClear();

    for (let i = 0; i < 5; i++) {
      await reference.observedFetch("https://cdn.apty.example/segments.json");
    }
    await saved(
      (state) =>
        state.calls.length === 5 &&
        answered(state) &&
        Object.keys(state.bodies).length === 1,
    );

    expect(
      set.mock.calls.filter(([items]) => NETWORK_KEY in items),
    ).toHaveLength(1);
  });

  it("gives the Widget its Response and its error even when recording fails", async () => {
    const reference = await loadReference();
    const get = chrome.storage.session.get as ReturnType<typeof vi.fn>;
    const set = chrome.storage.session.set as ReturnType<typeof vi.fn>;
    get.mockImplementationOnce(() => {
      throw new Error("storage is gone");
    });
    set.mockImplementation(() => {
      throw new Error("storage is gone");
    });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const ok = Response.json({ ok: true });
      fetchReturns(ok);
      expect(
        await reference.observedFetch("https://cdn.apty.example/a.json"),
      ).toBe(ok);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
      );
      await expect(
        reference.observedFetch("https://cdn.apty.example/b.json"),
      ).rejects.toThrow("Failed to fetch");
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      set.mockImplementation(async (items: Record<string, unknown>) => {
        Object.assign(store.session, structuredClone(items));
      });
    }
  });
});

describe("bodies are kept per resource", () => {
  const BASE = "https://cdn.apty.example";

  /** The calls the Client lists, each with whether its body can be read. */
  async function listedWithBodies() {
    const { resources } = resourcesResponseSchema.parse(await list());
    return Promise.all(
      resources.map(async (call) => ({
        call,
        answer: resourceBodyResponseSchema.parse(await body(call.requestId)),
      })),
    );
  }

  /** Serve `answers` in order; the last one repeats. */
  function serveInOrder(...answers: Response[]) {
    let i = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const answer = answers[Math.min(i++, answers.length - 1)]!;
        return answer.clone();
      }),
    );
  }

  it("keeps the latest body per resource when only the query string differs", async () => {
    const reference = await loadReference();
    serveInOrder(
      Response.json({ version: 1 }),
      Response.json({ version: 2 }),
      Response.json({ version: 3 }),
    );
    for (const stamp of [1, 2, 3]) {
      await reference.observedFetch(`${BASE}/styles.json?timestamp=${stamp}`);
    }
    await saved(
      (state) => answered(state) && Object.keys(state.bodies).length === 1,
    );

    const calls = await listedWithBodies();
    expect(calls.map(({ call }) => call.hasBody)).toEqual([false, false, true]);
    expect(JSON.parse(calls[2]!.answer.body ?? "")).toEqual({ version: 3 });
    expect(calls[0]!.answer).toEqual({ found: false, reason: "evicted" });
  });

  it("keeps a failed call's body through 30 later successful calls of the same resource and others", async () => {
    const reference = await loadReference();
    serveInOrder(
      Response.json({ error: "Boom" }, { status: 500 }),
      Response.json({ ok: true }),
    );
    await reference.observedFetch(`${BASE}/rules.json?timestamp=0`);
    for (let i = 1; i <= 30; i++) {
      await reference.observedFetch(`${BASE}/rules.json?timestamp=${i}`);
      await reference.observedFetch(`${BASE}/other-${i}.json`);
    }
    await saved(
      (state) =>
        state.calls.length === 61 &&
        answered(state) &&
        Object.keys(state.bodies).length === 31 + 1,
    );

    const calls = await listedWithBodies();
    const failed = calls.find(({ call }) => call.status === 500)!;
    expect(failed.call.hasBody).toBe(true);
    expect(failed.answer.body).toContain("Boom");
    const rules = calls.filter(({ call }) => call.url.includes("/rules.json"));
    expect(rules.filter(({ call }) => call.hasBody)).toHaveLength(2);
  });

  it("drops the oldest resources' successful bodies first when the total passes the budget", async () => {
    const reference = await loadReference();
    const bigBody = (i: number) =>
      `"${String(i).padStart(2, "0")}${"x".repeat(189_995)}"`;
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(bigBody(n++), {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    for (let i = 0; i < 12; i++) {
      await reference.observedFetch(`${BASE}/resource-${i}.json`);
    }
    await saved((state) => answered(state) && state.calls.length === 12);
    await saved((state) => Object.keys(state.bodies).length === 10);

    const calls = await listedWithBodies();
    const kept = calls
      .filter(({ call }) => call.hasBody)
      .map(({ call }) => call.url);
    expect(kept).toEqual(
      Array.from({ length: 10 }, (_, i) => `${BASE}/resource-${i + 2}.json`),
    );
    expect(calls[0]!.answer).toEqual({ found: false, reason: "evicted" });
  });

  it("evicts failed bodies only after every successful body", async () => {
    const reference = await loadReference();
    const big = `"${"x".repeat(190_000)}"`;
    const respond = (status: number) =>
      new Response(big, {
        status,
        headers: { "content-type": "application/json" },
      });
    const statuses = [
      500, 500, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200,
    ];
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(statuses[n++]!)),
    );
    for (let i = 0; i < statuses.length; i++) {
      await reference.observedFetch(`${BASE}/resource-${i}.json`);
    }
    await saved((state) => answered(state) && state.calls.length === 12);
    await saved((state) => Object.keys(state.bodies).length === 10);

    const kept = (await listedWithBodies())
      .filter(({ call }) => call.hasBody)
      .map(({ call }) => call.status);
    expect(kept.filter((status) => status === 500)).toHaveLength(2);
  });

  it("says why a body is missing: too-large, unreadable, evicted or none", async () => {
    const reference = await loadReference();
    serveInOrder(
      new Response(`"${"x".repeat(MAX_BODY_CHARS_ACCEPTED + 1)}"`, {
        headers: { "content-type": "application/json" },
      }),
    );
    await reference.observedFetch(`${BASE}/huge.json`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const unreadable = Response.json({});
        vi.spyOn(unreadable, "clone").mockImplementation(() => {
          throw new Error("cannot clone");
        });
        return unreadable;
      }),
    );
    await reference.observedFetch(`${BASE}/unreadable.json`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(
      reference.observedFetch(`${BASE}/down.json`),
    ).rejects.toThrow();
    await saved((state) => answered(state) && state.calls.length === 3);
    await saved((state) => Object.keys(state.notKept ?? {}).length >= 1);

    const reasons = Object.fromEntries(
      (await listedWithBodies()).map(({ call, answer }) => [
        call.url.split("/").at(-1),
        answer.reason,
      ]),
    );
    expect(reasons["huge.json"]).toBe("too-large");
    expect(reasons["down.json"]).toBe("none");
    expect(reasons["unreadable.json"]).toBe("unreadable");
    expect(await body("never-recorded")).toEqual({
      found: false,
      reason: "evicted",
    });
  });

  it("counts failed saves in the list answer, and keeps answering from memory", async () => {
    const reference = await loadReference();
    const set = chrome.storage.session.set as ReturnType<typeof vi.fn>;
    set.mockRejectedValue(new Error("QUOTA_BYTES quota exceeded"));
    try {
      serveInOrder(Response.json({ ok: true }));
      await reference.observedFetch(`${BASE}/a.json`);
      await vi.waitFor(
        async () => {
          const answer = (await list()) as { saveFailures?: number };
          expect(answer.saveFailures).toBeGreaterThan(0);
        },
        { timeout: 4000, interval: 50 },
      );
      expect(
        (resourcesResponseSchema.parse(await list()).resources[0] ?? {}).url,
      ).toBe(`${BASE}/a.json`);
    } finally {
      set.mockImplementation(async (items: Record<string, unknown>) => {
        Object.assign(store.session, structuredClone(items));
      });
    }
  });

  it("wraps console unless CAPTURE_CONSOLE is false", async () => {
    const before = console.log;
    await loadReference();
    expect(console.log).not.toBe(before);
    console.log = before;
  });
});

describe("the Ask Dapty chat in extension mode", () => {
  const CHAT =
    "https://ai.apty.example/ai-service/api/v1/ai/tenant-1/widget/chat?applicationId=app-9";
  const chatRequest = (i: number) =>
    JSON.stringify({
      message: `question ${i}`,
      context: [],
      envId: "prod",
      applicationType: "web",
    });

  it("lists each chat POST with its request body, and keeps the last 20 chat bodies", async () => {
    const reference = await loadReference();
    let i = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ reply: `answer ${i++}`, suggestions: [] }),
      ),
    );
    for (let n = 0; n < 25; n++) {
      await reference.observedFetch(CHAT, {
        method: "POST",
        body: chatRequest(n),
      });
    }
    await reference.observedFetch(`${CHAT.split("?")[0]}/history`, {
      method: "POST",
      body: "not allow-listed",
    });
    await saved(
      (state) =>
        state.calls.length === 26 &&
        answered(state) &&
        Object.keys(state.bodies).length === 21,
    );

    const { resources } = resourcesResponseSchema.parse(await list());
    const chats = resources.slice(0, 25);
    expect(chats.slice(0, 5).map((c) => [c.hasBody, c.requestBody])).toEqual(
      Array.from({ length: 5 }, () => [false, undefined]),
    );
    expect(chats.slice(5).map((c) => c.requestBody)).toEqual(
      Array.from({ length: 20 }, (_, n) => chatRequest(n + 5)),
    );
    expect(chats.slice(5).every((c) => c.hasBody)).toBe(true);
    expect(resources[25]).not.toHaveProperty("requestBody");
    expect(
      resourceBodyResponseSchema.parse(await body(chats[24]!.requestId)),
    ).toMatchObject({
      found: true,
      body: expect.stringContaining("answer 24"),
    });
  });

  it("answers get-widget-chat from the Widget's own state, bounded, and the Agent reads it", async () => {
    const reference = await loadReference();
    reference.recordWidgetChatTurn("c-1", "Vendors", [
      { id: "m1", role: "user", content: "How do I add a vendor?" },
      {
        id: "m2",
        role: "assistant",
        content: "Use the workflow below.",
        suggestions: [
          { id: "wf-1", name: "Create vendor", type: "workflow" },
          { id: "kc-7", name: "Vendor policy", type: "knowledge_content" },
        ],
      },
      { id: "m3", role: "tool", content: "ignored" },
    ]);
    for (let n = 0; n < 12; n++) {
      reference.recordWidgetChatTurn(`c-${n + 2}`, `chat ${n}`, [
        { role: "user", content: "x".repeat(30_000) },
      ]);
    }
    reference.recordWidgetChatTurn("c-1", "Vendors", [
      { id: "m1", role: "user", content: "How do I add a vendor?" },
    ]);
    await vi.waitFor(
      async () => {
        const answer = widgetChatResponseSchema.parse(
          await ask({ type: "apty-debug-agent:get-widget-chat" }),
        );
        expect(answer.chats.at(-1)?.turns).toHaveLength(1);
      },
      { timeout: 2000, interval: 20 },
    );

    const answer = widgetChatResponseSchema.parse(
      await ask({ type: "apty-debug-agent:get-widget-chat" }),
    );
    expect(answer.chats).toHaveLength(10);
    expect(answer.chats.at(-1)?.chatId).toBe("c-1");
    expect(answer.chats[0]?.turns[0]?.text).toHaveLength(20_000);
    expect(await ask({ type: "apty-debug-agent:get-widget-chat" }, "x")).toBe(
      "no answer",
    );

    reference.recordWidgetChatTurn("c-1", "Vendors", [
      { id: "m1", role: "user", content: "How do I add a vendor?" },
      {
        id: "m2",
        role: "assistant",
        content: "Use the workflow below.",
        suggestions: [{ id: "wf-1", name: "Create vendor", type: "workflow" }],
      },
      { id: "m3", role: "tool", content: "ignored" },
    ]);
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
      extensionId: WIDGET_ID,
    });
    await vi.waitFor(
      async () => {
        const read = await provider.readWidgetChat();
        if (!read.ok) throw new Error(read.message);
        expect(read.chats.at(-1)).toEqual({
          chatId: "c-1",
          name: "Vendors",
          turns: [
            { role: "user", text: "How do I add a vendor?" },
            {
              role: "assistant",
              text: "Use the workflow below.",
              suggestions: [
                { id: "wf-1", name: "Create vendor", type: "workflow" },
              ],
            },
          ],
        });
      },
      { timeout: 2000, interval: 20 },
    );
  });
});
