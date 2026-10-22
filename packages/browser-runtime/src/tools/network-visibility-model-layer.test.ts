/**
 * The Apty Client's calls as the chat model finally gets them (the real
 * wrapped tools, then the outbound sanitizer and redactToolOutput, in the
 * mode current at that moment): one entry per unique resource, and a body
 * read from an older call when the newest has none.
 */
import type { AgentInputItem } from "@apty/agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
const ID = "4815162342";
const DOB = "1980-01-01";
const PERSON_BODY = `{"name":"Jane","email":"jane.doe@example.com"}`;

type Mode = "strict" | "standard" | "off";

const state = vi.hoisted(() => ({
  mode: "standard" as "strict" | "standard" | "off",
  resources: [] as Array<Record<string, unknown>>,
  bodies: {} as Record<string, string>,
  reasons: {} as Record<string, string>,
  bodyRequests: [] as string[],
  denyList: [] as string[],
}));

vi.hoisted(() => {
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      id: "agent",
      lastError: undefined,
      sendMessage: vi.fn(
        (
          _id: string,
          message: { type: string; requestId?: string },
          callback: (r: unknown) => void,
        ) => {
          switch (message.type) {
            case "apty-debug-agent:get-service-worker-status":
              return callback({ running: true });
            case "apty-debug-agent:list-observed-resources":
              return callback({ resources: state.resources });
            case "apty-debug-agent:get-resource-body": {
              const id = message.requestId ?? "";
              state.bodyRequests.push(id);
              const body = state.bodies[id];
              const reason = state.reasons[id];
              return callback(
                body === undefined
                  ? { found: false, ...(reason ? { reason } : {}) }
                  : { found: true, body },
              );
            }
            default:
              return callback(undefined);
          }
        },
      ),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({
          [key]: {
            redactionMode: state.mode,
            networkBodyCaptureDenyList: state.denyList,
          },
        })),
        set: vi.fn(async () => {}),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
      onChanged: { addListener: vi.fn() },
    },
    tabs: { query: vi.fn(async () => []), get: vi.fn() },
  };
});

import { clearEvidence } from "../apty/evidence-store";
import { connectExtensionClient } from "../apty/extension-network-inspector";
import {
  createOutboundSanitizer,
  redactToolOutput,
} from "../runtime/outbound-sanitizer";
import {
  currentRedactionMode,
  getRedactionMode,
  resetRedactionModeForTests,
} from "../runtime/redaction-mode";
import { allBrowserTools } from "./index";

const CONV = "conv-network-visibility";
const API = "https://api.apty.example";
const CDN = "https://client.app.apty.io";

interface Call {
  requestId: string;
  url: string;
  method: string;
  timestamp: number;
  status?: number;
  mimeType?: string;
  failed?: boolean;
  errorText?: string;
  hasBody?: boolean;
}

const call = (overrides: Partial<Call>): Call => ({
  requestId: "r",
  url: `${CDN}/config.json`,
  method: "GET",
  timestamp: 1,
  status: 200,
  mimeType: "application/json",
  ...overrides,
});

async function setMode(mode: Mode): Promise<void> {
  state.mode = mode;
  resetRedactionModeForTests();
  await getRedactionMode();
}

function toolNamed(name: string) {
  const found = allBrowserTools.find((t) => t.name === name);
  if (!found) throw new Error(`no tool named ${name}`);
  return found as unknown as {
    invoke: (ctx: unknown, input: string) => Promise<unknown>;
  };
}

/** The tool's result as the chat model and as an MCP client get it, in the mode current now. */
async function asSent(
  name: string,
  input: Record<string, unknown>,
): Promise<{ chat: string; mcp: string; raw: ReturnType<typeof JSON.parse> }> {
  const output = await toolNamed(name).invoke(
    { context: { conversationId: CONV } },
    JSON.stringify(input),
  );
  const sanitize = createOutboundSanitizer({ getMode: currentRedactionMode });
  const [item] = await sanitize([
    {
      type: "function_call_result",
      name,
      callId: `call-${name}`,
      status: "completed",
      output,
    } as unknown as AgentInputItem,
  ]);
  const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  return {
    chat: text((item as { output: unknown }).output),
    mcp: text(redactToolOutput(output, currentRedactionMode())),
    raw: JSON.parse(text(output)),
  };
}

const list = () => asSent("list_extension_network_resources", {});
const inspect = (resourceQuery: string) =>
  asSent("inspect_extension_network", { resourceQuery });

/** Three page loads of the same files, each call with a cache-buster. */
function threeLoads(): Call[] {
  return [1, 2, 3].flatMap((load) => [
    call({
      requestId: `config-${load}`,
      url: `${CDN}/config.json?timestamp=${load}`,
      timestamp: load * 10,
    }),
    call({
      requestId: `record-${load}`,
      url: `${API}/records/${ID}.json?dob=${DOB}&timestamp=${load}`,
      timestamp: load * 10 + 1,
    }),
  ]);
}

beforeEach(async () => {
  clearEvidence(CONV);
  state.resources = [];
  state.bodies = {};
  state.reasons = {};
  state.bodyRequests = [];
  state.denyList = [];
  await setMode("standard");
  await connectExtensionClient(CONV, EXT_ID);
});

describe("list_extension_network_resources, as the model gets it", () => {
  it.each([
    "strict",
    "standard",
    "off",
  ] as const)("%s: the same request over 3 loads is one entry counted 3", async (mode) => {
    state.resources = threeLoads();
    await setMode(mode);
    const sent = await list();

    expect(sent.raw).toMatchObject({
      connected: true,
      uniqueResources: 2,
      totalCalls: 6,
    });
    const config = sent.raw.resources.find(
      (r: { resourceName: string }) => r.resourceName === "config.json",
    );
    expect(config).toMatchObject({
      method: "GET",
      count: 3,
      failedCount: 0,
      latestStatus: 200,
      latestTimestamp: 30,
    });
    expect(sent.raw.resources).toHaveLength(2);
    for (const resource of sent.raw.resources) {
      expect(resource.url, mode).not.toContain("?");
    }
    for (const [layer, text] of [
      ["chat", sent.chat],
      ["mcp", sent.mcp],
    ] as const) {
      expect(text, `${mode} ${layer}`).not.toContain(DOB);
      expect(text, `${mode} ${layer}`).not.toContain("timestamp=");
      if (mode === "strict") expect(text, layer).not.toContain(ID);
    }
    // The control: with redaction off the same list names the record.
    if (mode === "off") expect(sent.chat).toContain(`${ID}.json`);
  });

  it("counts failed calls and reports the latest, and says whether a body is kept when the Client does", async () => {
    state.resources = [
      call({ requestId: "a", timestamp: 1, hasBody: false }),
      call({ requestId: "b", timestamp: 2, status: 503, hasBody: true }),
      call({
        requestId: "c",
        timestamp: 3,
        status: undefined,
        failed: true,
        errorText: "net::ERR_CONNECTION_RESET",
        hasBody: false,
      }),
    ];
    const { raw } = await list();

    expect(raw.resources).toEqual([
      expect.objectContaining({
        resourceName: "config.json",
        count: 3,
        failedCount: 2,
        latestFailed: true,
        latestError: "net::ERR_CONNECTION_RESET",
        hasBody: true,
      }),
    ]);
  });

  it("caps the list and says how many resources are left out", async () => {
    state.resources = Array.from({ length: 250 }, (_, i) =>
      call({ requestId: `r${i}`, url: `${CDN}/file-${i}.json`, timestamp: i }),
    );
    const { raw, chat } = await list();

    expect(raw.resources).toHaveLength(200);
    expect(raw).toMatchObject({
      uniqueResources: 250,
      totalCalls: 250,
      omittedResources: 50,
    });
    expect(raw.resources[0].resourceName).toBe("file-249.json");
    expect(chat.length).toBeLessThan(80_000);
  });

  it("is smaller than listing every call", async () => {
    state.resources = Array.from({ length: 105 }, (_, i) =>
      call({
        requestId: `r${i}`,
        url: `${CDN}/file-${i % 32}.json?timestamp=${i}`,
        timestamp: i,
      }),
    );
    const { raw } = await list();
    expect(raw.resources).toHaveLength(32);
  });
});

describe("inspect_extension_network falls back to an older call with a body", () => {
  const older = (extra: Partial<Call> = {}) => [
    call({ requestId: "old", timestamp: 10, ...extra }),
    call({ requestId: "mid", timestamp: 20, ...extra }),
    call({ requestId: "new", timestamp: 30, ...extra }),
  ];

  it.each([
    "strict",
    "standard",
  ] as const)("%s: reads the older call the Client says has a body, masked, and says which call", async (mode) => {
    state.resources = [
      call({
        requestId: "old",
        url: `${API}/records/${ID}.json?timestamp=1`,
        timestamp: 10,
        hasBody: true,
      }),
      call({
        requestId: "new",
        url: `${API}/records/${ID}.json?timestamp=2`,
        timestamp: 30,
        hasBody: false,
      }),
    ];
    state.bodies = { old: PERSON_BODY };
    await setMode(mode);
    const sent = await inspect("records");

    expect(sent.raw).toMatchObject({
      found: true,
      status: "ok",
      request: { requestId: "old" },
      bodyFromOlderCall: {
        timestamp: new Date(10).toISOString(),
        newerCallsWithoutBody: 1,
      },
    });
    expect(sent.raw.bodyFromOlderCall.note).toContain(
      new Date(10).toISOString(),
    );
    expect(state.bodyRequests).toEqual(["old"]);
    for (const [layer, text] of [
      ["chat", sent.chat],
      ["mcp", sent.mcp],
    ] as const) {
      if (mode === "strict") expect(text, layer).not.toContain(ID);
      expect(text, `${mode} ${layer}`).not.toContain("jane.doe@example.com");
      if (mode === "strict") expect(text, layer).not.toContain("timestamp=");
    }
  });

  it("control: the newest call is read when it has the body, with no note", async () => {
    state.resources = older({ hasBody: true });
    state.bodies = { old: '{"v":1}', mid: '{"v":2}', new: '{"v":3}' };
    const sent = await inspect("config.json");

    expect(sent.raw).toMatchObject({
      status: "ok",
      request: { requestId: "new" },
    });
    expect(sent.raw.bodyFromOlderCall).toBeUndefined();
    expect(state.bodyRequests).toEqual(["new"]);
  });

  it("with a Client that sends no hasBody, tries the 3 newest calls and no more", async () => {
    state.resources = [
      call({ requestId: "r1", timestamp: 1 }),
      call({ requestId: "r2", timestamp: 2 }),
      call({ requestId: "r3", timestamp: 3 }),
      call({ requestId: "r4", timestamp: 4 }),
    ];
    state.bodies = { r2: '{"found":"it"}' };
    const found = await inspect("config.json");
    expect(found.raw).toMatchObject({
      status: "ok",
      request: { requestId: "r2" },
      bodyFromOlderCall: { newerCallsWithoutBody: 2 },
    });
    expect(state.bodyRequests).toEqual(["r4", "r3", "r2"]);

    state.bodyRequests = [];
    state.bodies = { r1: '{"too":"old"}' };
    const missed = await inspect("config.json");
    expect(missed.raw).toMatchObject({
      status: "body_unavailable",
      request: { requestId: "r4" },
    });
    expect(state.bodyRequests).toEqual(["r4", "r3", "r2"]);
  });

  it("falls back from a failed newest call, without asking the Client for its body", async () => {
    state.resources = [
      call({ requestId: "good", timestamp: 1 }),
      call({
        requestId: "down",
        timestamp: 2,
        status: undefined,
        failed: true,
        errorText: "net::ERR_FAILED",
      }),
    ];
    state.bodies = { good: '{"ok":true}' };
    const { raw } = await inspect("config.json");

    expect(raw).toMatchObject({
      status: "ok",
      request: { requestId: "good" },
      bodyFromOlderCall: { newerCallsWithoutBody: 1 },
    });
    expect(state.bodyRequests).toEqual(["good"]);
  });

  it("keeps the deny list check on every candidate's raw URL", async () => {
    state.resources = [
      call({
        requestId: "old",
        url: `${API}/records/1.json?tenant=secret-clinic`,
        timestamp: 1,
        hasBody: true,
      }),
      call({
        requestId: "new",
        url: `${API}/records/1.json?tenant=public`,
        timestamp: 2,
        hasBody: false,
      }),
    ];
    state.bodies = { old: '{"ok":true}' };
    state.denyList = ["tenant=secret-clinic"];
    const { raw, chat } = await inspect("records/1.json");

    expect(raw).toMatchObject({
      status: "body_denied",
      deniedBy: "tenant=secret-clinic",
    });
    expect(state.bodyRequests).toEqual([]);
    expect(chat).not.toContain('secret-clinic"}');
  });

  it("does not read a different resource's body for the same query", async () => {
    state.resources = [
      call({ requestId: "a", url: `${CDN}/segments.json`, timestamp: 1 }),
      call({
        requestId: "b",
        url: `${CDN}/segments-extra.json`,
        timestamp: 5,
        hasBody: false,
      }),
    ];
    state.bodies = { a: '{"a":1}' };
    const { raw } = await inspect("seg");

    expect(raw.request.requestId).toBe("b");
    expect(raw.status).toBe("body_unavailable");
    expect(raw.alsoMatched).toEqual(["segments.json"]);
  });

  it.each([
    ["too-large", /over the Client's size limit/],
    ["evicted", /no longer has it/],
    ["unreadable", /could not read the response body/],
    ["none", /no body to keep/],
  ])("says why when the Client gives reason %s", async (reason, text) => {
    state.resources = [call({ requestId: "only", timestamp: 1 })];
    state.reasons = { only: reason };
    const { raw } = await inspect("config.json");

    expect(raw.status).toBe("body_unavailable");
    expect(raw.error).toMatch(text);
  });

  it("keeps today's wording when the Client sends no reason, or one it does not know", async () => {
    state.resources = [call({ requestId: "only", timestamp: 1 })];
    const none = await inspect("config.json");
    state.reasons = { only: "something-new" };
    const unknown = await inspect("config.json");

    for (const { raw } of [none, unknown]) {
      expect(raw.error).toBe(
        "The request was observed, but the Apty Client did not provide the response body.",
      );
    }
  });
});
