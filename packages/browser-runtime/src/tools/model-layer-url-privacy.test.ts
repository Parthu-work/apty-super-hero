/**
 * A relative Apty Client resource URL as the model and MCP clients finally
 * get it: the real wrapped tools, then the outbound sanitizer (chat) and
 * redactToolOutput (what the MCP server runs), all in the mode current at
 * that moment. Neither of those two layers masks a relative URL, so these
 * hold only if the tools mask it when they emit it.
 */
import type { AgentInputItem } from "@apty/agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
const ID = "4815162342";
const DOB = "1980-01-01";
const URL_WITH_ID = `/api/users/${ID}.json?dob=${DOB}`;

type Mode = "strict" | "standard";

interface MockResource {
  requestId: string;
  url: string;
  method: string;
  timestamp: number;
  status?: number;
  mimeType?: string;
  failed?: boolean;
  errorText?: string;
}

const state = vi.hoisted(() => ({
  mode: "standard" as "strict" | "standard",
  resources: [] as Array<Record<string, unknown>>,
  body: undefined as string | undefined,
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
          message: { type: string },
          callback: (r: unknown) => void,
        ) => {
          switch (message.type) {
            case "apty-debug-agent:get-service-worker-status":
              return callback({ running: true });
            case "apty-debug-agent:list-observed-resources":
              return callback({ resources: state.resources });
            case "apty-debug-agent:get-resource-body":
              return callback(
                state.body === undefined
                  ? { found: false }
                  : { found: true, body: state.body },
              );
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

const CONV = "conv-model-layer-url";

const resource = (overrides: Partial<MockResource>): MockResource => ({
  requestId: "r1",
  url: URL_WITH_ID,
  method: "GET",
  timestamp: 1,
  ...overrides,
});

/** What the Apty Client reports, and its body, for each status the chat tool can answer. */
const STATUS_FIXTURES = {
  ok: {
    query: "users",
    resources: [resource({ status: 200, mimeType: "application/json" })],
    body: '{"ok":true}',
  },
  http_error: {
    query: "users",
    resources: [resource({ status: 404, mimeType: "application/json" })],
    body: '{"error":"nope"}',
  },
  failed: {
    query: "users",
    resources: [resource({ failed: true, errorText: "net::ERR_FAILED" })],
  },
  pending: { query: "users", resources: [resource({})] },
  body_denied: {
    query: "users",
    resources: [resource({ status: 200, mimeType: "application/json" })],
    body: '{"ok":true}',
    denyList: ["/api/users/"],
  },
  body_unavailable: {
    query: "users",
    resources: [resource({ status: 200, mimeType: "application/json" })],
  },
  not_observed: {
    query: "segments.json",
    resources: [resource({ status: 200, mimeType: "application/json" })],
  },
} satisfies Record<
  string,
  {
    query: string;
    resources: MockResource[];
    body?: string;
    denyList?: string[];
  }
>;

type Status = keyof typeof STATUS_FIXTURES;
const STATUSES = Object.keys(STATUS_FIXTURES) as Status[];

function setClient(status: Status): void {
  const fixture: {
    resources: MockResource[];
    body?: string;
    denyList?: string[];
  } = STATUS_FIXTURES[status];
  state.resources = fixture.resources;
  state.body = fixture.body;
  state.denyList = fixture.denyList ?? [];
}

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
): Promise<{ chat: string; mcp: string }> {
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
  const chat = (item as { output: unknown }).output;
  const mcp = redactToolOutput(output, currentRedactionMode());
  const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  return { chat: text(chat), mcp: text(mcp) };
}

const list = () => asSent("list_extension_network_resources", {});
const inspect = (status: Status) =>
  asSent("inspect_extension_network", {
    resourceQuery: STATUS_FIXTURES[status].query,
  });
const timeline = () => asSent("get_investigation_timeline", { windowMs: 2000 });

function expectMasked(
  sent: { chat: string; mcp: string },
  mode: Mode,
  label: string,
): void {
  for (const [layer, text] of Object.entries(sent)) {
    expect(text, `${label} (${layer})`).not.toContain(DOB);
    if (mode === "strict") {
      expect(text, `${label} (${layer})`).not.toContain(ID);
    }
  }
}

beforeEach(async () => {
  clearEvidence(CONV);
  setClient("ok");
  await setMode("standard");
  await connectExtensionClient(CONV, EXT_ID);
});

describe("list_extension_network_resources, as the model gets it", () => {
  it("in Strict carries neither the record number nor the query value", async () => {
    await setMode("strict");
    const sent = await list();
    expect(sent.chat).toContain("users");
    expectMasked(sent, "strict", "list");
  });

  it("in Standard never carries the query value", async () => {
    const sent = await list();
    expect(sent.chat).toContain("users");
    expectMasked(sent, "standard", "list");
  });
});

describe("inspect_extension_network, as the model gets it, for every status", () => {
  it.each([
    "strict",
    "standard",
  ] as const)("%s: all 7 statuses mask the relative URL", async (mode) => {
    await setMode(mode);
    for (const status of STATUSES) {
      setClient(status);
      const sent = await inspect(status);
      expect(sent.chat).toContain(`"status":"${status}"`);
      expectMasked(sent, mode, status);
    }
  });
});

describe("get_investigation_timeline, as the model gets it", () => {
  it("in Strict carries neither the record number nor the query value", async () => {
    await setMode("strict");
    await inspect("ok");
    const sent = await timeline();
    expect(sent.chat).toContain('"available":true');
    expectMasked(sent, "strict", "timeline");
  });

  it("in Standard never carries the query value", async () => {
    await inspect("ok");
    const sent = await timeline();
    expect(sent.chat).toContain('"available":true');
    expectMasked(sent, "standard", "timeline");
  });
});

describe("the mode changes after the evidence is recorded", () => {
  it("recorded in Standard, read in Strict: the timeline follows Strict", async () => {
    await inspect("ok");
    await setMode("strict");
    const sent = await timeline();
    expect(sent.chat).toContain('"available":true');
    expectMasked(sent, "strict", "timeline");
  });

  it("recorded in Strict, read in Standard: the path shows again, the query value does not", async () => {
    await setMode("strict");
    await inspect("ok");
    await setMode("standard");
    const sent = await timeline();
    expect(sent.chat).toContain(ID);
    expectMasked(sent, "standard", "timeline");
  });

  it("recorded in Standard, then all three tools in Strict", async () => {
    await inspect("ok");
    await setMode("strict");
    expectMasked(await list(), "strict", "list");
    expectMasked(await inspect("ok"), "strict", "inspect");
    expectMasked(await timeline(), "strict", "timeline");
  });
});
