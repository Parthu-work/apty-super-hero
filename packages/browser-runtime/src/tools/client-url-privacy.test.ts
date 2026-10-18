/**
 * Apty Client resource URLs as the model finally gets them: after the real
 * result-privacy wrapper, in the redaction mode current at that moment. A
 * relative URL is the case the wrapper alone leaves unmasked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
const ID = "4815162342";
const DOB = "1980-01-01";

const state = vi.hoisted(() => ({
  mode: "standard" as "strict" | "standard",
  sent: [] as Array<{ type: string; requestId?: string }>,
}));

const RESOURCES = [
  { requestId: "ok", status: 200, mimeType: "application/json" },
  { requestId: "err", status: 404, mimeType: "application/json" },
  { requestId: "fail", failed: true, errorText: "net::ERR_FAILED" },
  { requestId: "pend" },
  { requestId: "deny", status: 200, mimeType: "application/json" },
  { requestId: "nobody", status: 200, mimeType: "application/json" },
].map((r, i) => ({
  ...r,
  url: `/api/${r.requestId}/users/4815162342.json?dob=1980-01-01`,
  method: "GET",
  timestamp: i + 1,
}));
const ABSOLUTE = {
  requestId: "abs",
  url: "https://cdn.apty.example/api/abs/users/4815162342.json?dob=1980-01-01",
  method: "GET",
  status: 200,
  mimeType: "application/json",
  timestamp: 10,
};
const BODIES: Record<string, string> = {
  ok: '{"ok":true}',
  err: '{"error":"nope"}',
  abs: '{"ok":true}',
};

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
          state.sent.push(message);
          switch (message.type) {
            case "apty-debug-agent:get-service-worker-status":
              return callback({ running: true });
            case "apty-debug-agent:list-observed-resources":
              return callback({ resources: [...RESOURCES_FOR_MOCK()] });
            case "apty-debug-agent:get-resource-body": {
              const body = BODIES_FOR_MOCK()[message.requestId ?? ""];
              return callback(body ? { found: true, body } : { found: false });
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
            networkBodyCaptureDenyList: ["/api/deny/"],
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

function RESOURCES_FOR_MOCK() {
  return [...RESOURCES, ABSOLUTE];
}
function BODIES_FOR_MOCK() {
  return BODIES;
}

import { clearEvidence } from "../apty/evidence-store";
import {
  connectExtensionClient,
  inspectResource,
  listObservedResources,
} from "../apty/extension-network-inspector";
import { resetRedactionModeForTests } from "../runtime/redaction-mode";
import { applyResultPrivacy } from "../runtime/result-privacy";
import { currentValuePolicy } from "../runtime/value-policy";
import { allBrowserTools } from "./index";

const CONV = "conv-url";

function useMode(mode: "strict" | "standard") {
  state.mode = mode;
  resetRedactionModeForTests();
}

/** What the model gets from a tool result, in the mode current now. */
const asSent = (result: unknown) =>
  JSON.stringify(applyResultPrivacy(result, currentValuePolicy()));

async function timeline(): Promise<string> {
  const tool = allBrowserTools.find(
    (t) => t.name === "get_investigation_timeline",
  ) as unknown as {
    invoke: (ctx: unknown, input: string) => Promise<unknown>;
  };
  return JSON.stringify(
    await tool.invoke(
      { context: { conversationId: CONV } },
      JSON.stringify({ windowMs: 2000 }),
    ),
  );
}

beforeEach(async () => {
  clearEvidence(CONV);
  state.sent = [];
  useMode("standard");
  await connectExtensionClient(CONV, EXT_ID);
});

describe("Client resource URLs in what the model gets", () => {
  it.each([
    "strict",
    "standard",
  ] as const)("the list never carries the query values, and in Strict no record number (%s)", async (mode) => {
    useMode(mode);
    const sent = asSent(await listObservedResources(CONV));
    expect(sent).toContain("users");
    expect(sent).not.toContain(DOB);
    if (mode === "strict") expect(sent).not.toContain(ID);
  });

  it.each([
    ["ok/users", "ok"],
    ["err/users", "http_error"],
    ["fail/users", "failed"],
    ["pend/users", "pending"],
    ["deny/users", "body_denied"],
    ["nobody/users", "body_unavailable"],
    ["nothing.json", "not_observed"],
  ])("inspectResource(%s) answers %s without the record number or query values in Strict", async (query, status) => {
    useMode("strict");
    const result = await inspectResource(CONV, query);
    expect(result.status).toBe(status);
    const sent = asSent(result);
    expect(sent).not.toContain(ID);
    expect(sent).not.toContain(DOB);
  });

  it("inspectResource in Standard keeps the path but never the query values", async () => {
    useMode("standard");
    const sent = asSent(await inspectResource(CONV, "err/users"));
    expect(sent).toContain(ID);
    expect(sent).not.toContain(DOB);
  });

  it("still matches and denies on the raw URL", async () => {
    useMode("strict");
    expect(await inspectResource(CONV, `${ID}.json`)).toMatchObject({
      found: true,
    });
    await inspectResource(CONV, "deny/users");
    expect(
      state.sent.filter(
        (m) =>
          m.type === "apty-debug-agent:get-resource-body" &&
          m.requestId === "deny",
      ),
    ).toEqual([]);
  });
});

describe("evidence in get_investigation_timeline follows the current mode", () => {
  it("recorded in Standard, read in Strict: no record number, no query values", async () => {
    await inspectResource(CONV, "ok/users");
    useMode("strict");
    const out = await timeline();
    expect(out).toContain('"available":true');
    expect(out).not.toContain(ID);
    expect(out).not.toContain(DOB);
  });

  it("in Standard the query values are masked", async () => {
    await inspectResource(CONV, "ok/users");
    const out = await timeline();
    expect(out).toContain('"available":true');
    expect(out).not.toContain(DOB);
  });

  it("an absolute URL with a record number in its path, recorded in Standard and read in Strict", async () => {
    await inspectResource(CONV, "abs/users");
    useMode("strict");
    const out = await timeline();
    expect(out).toContain('"available":true');
    expect(out).not.toContain(ID);
    expect(out).not.toContain(DOB);
  });

  it("recorded in Strict, read in Standard: the path shows again, the query values do not", async () => {
    useMode("strict");
    await inspectResource(CONV, "ok/users");
    useMode("standard");
    const out = await timeline();
    expect(out).toContain(ID);
    expect(out).not.toContain(DOB);
  });
});
