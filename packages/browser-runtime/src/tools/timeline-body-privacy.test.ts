/**
 * A stored Apty Client response body as the model and MCP clients get the
 * timeline: the real wrapped get_investigation_timeline, then the outbound
 * sanitizer (chat) and redactToolOutput (what the MCP server runs), in the
 * mode current at that moment. Free text such as "MRN 4815162342" passes
 * every redaction pass, so the timeline must not carry the body at all.
 */
import type { AgentInputItem } from "@apty/agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
const MRN = "4815162342";
const BODY = JSON.stringify({ note: `MRN ${MRN}`, items: [1, 2, 3] });

type Mode = "strict" | "standard";

const state = vi.hoisted(() => ({
  mode: "standard" as "strict" | "standard",
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
              return callback({
                resources: [
                  {
                    requestId: "r1",
                    url: "https://cdn.apty.example/api/notes.json",
                    method: "GET",
                    status: 200,
                    mimeType: "application/json",
                    timestamp: 1,
                  },
                ],
              });
            case "apty-debug-agent:get-resource-body":
              return callback({
                found: true,
                body: JSON.stringify({
                  note: "MRN 4815162342",
                  items: [1, 2, 3],
                }),
              });
            default:
              return callback(undefined);
          }
        },
      ),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({
          [key]: { redactionMode: state.mode },
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

import { clearEvidence, getEvidence } from "../apty/evidence-store";
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

const CONV = "conv-timeline-body";

async function setMode(mode: Mode): Promise<void> {
  state.mode = mode;
  resetRedactionModeForTests();
  await getRedactionMode();
}

async function invoke(name: string, input: Record<string, unknown>) {
  const found = allBrowserTools.find((t) => t.name === name) as unknown as {
    invoke: (ctx: unknown, input: string) => Promise<unknown>;
  };
  return found.invoke(
    { context: { conversationId: CONV } },
    JSON.stringify(input),
  );
}

/** The timeline as the chat model and as an MCP client get it, in the mode current now. */
async function timeline(): Promise<{ chat: string; mcp: string }> {
  const output = await invoke("get_investigation_timeline", { windowMs: 2000 });
  const sanitize = createOutboundSanitizer({ getMode: currentRedactionMode });
  const [item] = await sanitize([
    {
      type: "function_call_result",
      name: "get_investigation_timeline",
      callId: "call-timeline",
      status: "completed",
      output,
    } as unknown as AgentInputItem,
  ]);
  const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  return {
    chat: text((item as { output: unknown }).output),
    mcp: text(redactToolOutput(output, currentRedactionMode())),
  };
}

const record = () =>
  invoke("inspect_extension_network", { resourceQuery: "notes.json" });

function storedBodyLength(): number {
  const [stored] = getEvidence(CONV);
  return ((stored?.data as { body: string }).body ?? "").length;
}

function expectBodyDropped(sent: { chat: string; mcp: string }): void {
  const length = storedBodyLength();
  expect(length).toBeGreaterThan(0);
  for (const [layer, text] of Object.entries(sent)) {
    expect(text, layer).toContain('"available":true');
    expect(text, layer).not.toContain(MRN);
    expect(text, layer).not.toContain('"body"');
    expect(text, layer).toContain('"bodyDropped":true');
    expect(text, layer).toContain(`"bodyLength":${length}`);
  }
}

beforeEach(async () => {
  clearEvidence(CONV);
  await setMode("standard");
  await connectExtensionClient(CONV, EXT_ID);
});

describe("get_investigation_timeline never carries a stored response body", () => {
  it.each([
    "strict",
    "standard",
  ] as const)("%s: the body is replaced by its length and a flag", async (mode) => {
    await setMode(mode);
    await record();
    expect(BODY).toContain(MRN);
    expectBodyDropped(await timeline());
  });

  it("recorded in Standard, read in Strict, and the other way round", async () => {
    await record();
    await setMode("strict");
    expectBodyDropped(await timeline());

    clearEvidence(CONV);
    await record();
    await setMode("standard");
    expectBodyDropped(await timeline());
  });

  it("keeps each record's evidenceId, and the body can be read by it with get_evidence_json", async () => {
    await record();
    const { chat } = await timeline();
    const emitted = JSON.parse(chat) as {
      clusters: Array<{ evidence: Array<{ evidenceId: string }> }>;
    };
    const evidenceId = emitted.clusters[0]?.evidence[0]?.evidenceId;
    expect(evidenceId).toBe(getEvidence(CONV)[0]?.evidenceId);

    const answer = (await invoke("get_evidence_json", {
      evidenceId,
      path: "items",
      limit: 10,
      offset: 0,
    })) as { found: boolean };
    expect(answer).toMatchObject({ found: true });
  });

  it("tells the model a dropped body is read by evidenceId with get_evidence_json", () => {
    const description = allBrowserTools.find(
      (t) => t.name === "get_investigation_timeline",
    )?.description;
    expect(description).toMatch(/bodyDropped/);
    expect(description).toMatch(/get_evidence_json[^.]*evidenceId/);
  });

  it("leaves the stored body for get_evidence_json, which reads it by id", async () => {
    await record();
    await timeline();
    const [stored] = getEvidence(CONV);
    expect((stored?.data as { body?: string }).body).toContain("items");

    const answer = (await invoke("get_evidence_json", {
      evidenceId: stored?.evidenceId,
      path: "items",
      limit: 10,
      offset: 0,
    })) as { found: boolean };
    expect(answer).toMatchObject({ found: true });
  });
});
