/**
 * The Widget team's reference service worker (docs/integrations/apty) against
 * this Agent's consumer: its answers must pass the consumer's own zod
 * schemas, and the real panel functions must read them, so the two sides
 * cannot drift apart.
 */
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resourceBodyResponseSchema,
  resourcesResponseSchema,
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
};

const SEGMENTS = Array.from({ length: 206 }, (_, i) => ({
  id: 4000 + i,
  name: `segment-${i}`,
}));

function serve(url: string): Response {
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
    return new Response(`"${"x".repeat(200_001)}"`, {
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
    ).toEqual({
      found: false,
    });
    expect(await body(offline!.requestId)).toEqual({ found: false });
    expect(await body("unknown")).toEqual({ found: false });
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

  it("keeps at most 1000 calls and 10 bodies, in session storage only, across a restart", async () => {
    const reference = await loadReference();
    for (let i = 0; i < 1005; i++) {
      await reference.observedFetch("https://cdn.apty.example/segments.json");
    }
    const first = resourcesResponseSchema.parse(await list()).resources;
    expect(first).toHaveLength(1000);
    const withBody = [];
    for (const call of first) {
      const answer = resourceBodyResponseSchema.parse(
        await body(call.requestId),
      );
      if (answer.found) withBody.push(call.requestId);
    }
    expect(withBody).toEqual(first.slice(-10).map((c) => c.requestId));
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
