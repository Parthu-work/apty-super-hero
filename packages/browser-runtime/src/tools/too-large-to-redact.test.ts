/**
 * An Apty Client response body longer than redaction can cover whole
 * (MAX_REDACT_INPUT_LENGTH) as the model and MCP clients get it: the real
 * wrapped tools, then the outbound sanitizer (chat) and redactToolOutput
 * (what the MCP server runs), in the mode current at that moment. Such a
 * body is neither shown cut off nor stored; one at the limit works as before.
 */
import type { AgentInputItem } from "@apty/agent-core";
import { MAX_REDACT_INPUT_LENGTH } from "@apty/debug-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
const MARKER = "START-MARKER-7f3a";

type Mode = "strict" | "standard";

const state = vi.hoisted(() => ({
  mode: "standard" as "strict" | "standard",
  body: "",
  base64Encoded: false,
  status: 200,
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
                    url: "https://cdn.apty.example/api/segments.json",
                    method: "GET",
                    status: state.status,
                    mimeType: "application/json",
                    timestamp: 1,
                  },
                ],
              });
            case "apty-debug-agent:get-resource-body":
              return callback({
                found: true,
                body: state.body,
                base64Encoded: state.base64Encoded,
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

import { readClientNetworkCallBody } from "../apty/client-network-calls";
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

const CONV = "conv-too-large";

/** A JSON body of exactly `length` characters that starts with MARKER and, unless told otherwise, holds a password. */
function jsonBody(length: number, { secret = true } = {}): string {
  const head = `{"note":"${MARKER}",${secret ? '"password":"hunter2",' : ""}"pad":"`;
  const tail = '"}';
  const body = `${head}${"x".repeat(length - head.length - tail.length)}${tail}`;
  expect(body).toHaveLength(length);
  return body;
}

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

/** A tool's result as the chat model and as an MCP client get it, in the mode current now. */
async function asSent(
  name: string,
  input: Record<string, unknown>,
): Promise<{ chat: string; mcp: string }> {
  const output = await invoke(name, input);
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
  };
}

const inspect = () =>
  asSent("inspect_extension_network", { resourceQuery: "segments.json" });
const timeline = () => asSent("get_investigation_timeline", { windowMs: 2000 });
const evidenceJson = (evidenceId: string | undefined) =>
  asSent("get_evidence_json", { evidenceId, path: "", limit: 10, offset: 0 });

function storedData(): Record<string, unknown> {
  const [stored] = getEvidence(CONV);
  return (stored?.data ?? {}) as Record<string, unknown>;
}

beforeEach(async () => {
  clearEvidence(CONV);
  state.base64Encoded = false;
  state.status = 200;
  await setMode("standard");
  await connectExtensionClient(CONV, EXT_ID);
});

describe("a Client body too large to redact safely", () => {
  it.each([
    [100_001, "standard"],
    [100_001, "strict"],
    [199_881, "standard"],
    [199_881, "strict"],
  ] as const)("%i characters (%s): never shown cut off, never stored, and every answer says why", async (length, mode) => {
    await setMode(mode);
    state.body = jsonBody(length);

    const inspected = await inspect();
    for (const [layer, text] of Object.entries(inspected)) {
      expect(text, layer).toContain('"tooLargeToRedact":true');
      expect(text, layer).toContain("redacted safely");
      expect(text, layer).not.toContain(MARKER);
      expect(text, layer).not.toContain("truncated before redaction");
    }

    const data = storedData();
    expect(data).toMatchObject({ tooLargeToRedact: true, fullLength: length });
    expect(data).not.toHaveProperty("body");

    const shown = await timeline();
    for (const [layer, text] of Object.entries(shown)) {
      expect(text, layer).toContain('"tooLargeToRedact":true');
      expect(text, layer).not.toContain(MARKER);
    }

    const evidenceId = (JSON.parse(inspected.chat) as { evidenceId?: string })
      .evidenceId;
    expect(evidenceId).toBe(getEvidence(CONV)[0]?.evidenceId);
    const queried = await evidenceJson(evidenceId);
    for (const [layer, text] of Object.entries(queried)) {
      expect(text, layer).toContain("too large to redact safely");
      expect(text, layer).not.toContain("not valid JSON");
    }
  });

  it("an HTTP error whose body is too large keeps its http_error status and says why there is no body", async () => {
    state.status = 500;
    state.body = jsonBody(150_000);

    const inspected = await inspect();
    for (const [layer, text] of Object.entries(inspected)) {
      expect(text, layer).toContain('"status":"http_error"');
      expect(text, layer).toContain('"tooLargeToRedact":true');
      expect(text, layer).toContain("redacted safely");
      expect(text, layer).not.toContain(MARKER);
    }
    expect(storedData()).toMatchObject({
      status: 500,
      tooLargeToRedact: true,
      fullLength: 150_000,
    });
    expect(storedData()).not.toHaveProperty("body");

    expect(await readClientNetworkCallBody(EXT_ID, "r1")).toMatchObject({
      status: "http_error",
      tooLargeToRedact: true,
    });
  });

  it("is named in the Options panel's answer too, with nothing to show", async () => {
    state.body = jsonBody(100_001);
    const read = await readClientNetworkCallBody(EXT_ID, "r1");
    expect(read).toMatchObject({
      status: "body_unavailable",
      tooLargeToRedact: true,
      fullLength: 100_001,
    });
    expect(read).not.toHaveProperty("body");
  });
});

describe("a body at the limit, or base64 that decodes under it", () => {
  it("exactly 100,000 characters with nothing to redact: shown, stored whole and queryable, as before", async () => {
    state.body = jsonBody(MAX_REDACT_INPUT_LENGTH, { secret: false });

    const inspected = await inspect();
    expect(inspected.chat).toContain('"status":"ok"');
    expect(inspected.chat).not.toContain("tooLargeToRedact");

    const body = storedData().body as string;
    expect(body).toBe(state.body);

    const evidenceId = getEvidence(CONV)[0]?.evidenceId;
    expect((await evidenceJson(evidenceId)).chat).toContain('"found":true');
  });

  // The provider used to redact too, so a secret's longer placeholder took
  // the text over the limit and the second pass cut it off.
  it("exactly 100,000 characters with a secret: redacted once, not cut off by a second pass", async () => {
    state.body = jsonBody(MAX_REDACT_INPUT_LENGTH);

    const inspected = await inspect();
    expect(inspected.chat).toContain('"status":"ok"');
    expect(inspected.chat).not.toContain("hunter2");

    const body = storedData().body as string;
    expect(() => JSON.parse(body)).not.toThrow();
    expect(body).toContain(MARKER);
    expect(body).not.toContain("hunter2");

    const evidenceId = getEvidence(CONV)[0]?.evidenceId;
    expect((await evidenceJson(evidenceId)).chat).toContain('"found":true');
  });

  it("base64 longer than the limit whose decoded text is under it is decoded, then redacted", async () => {
    const text = jsonBody(80_000);
    state.body = Buffer.from(text, "utf8").toString("base64");
    state.base64Encoded = true;
    expect(state.body.length).toBeGreaterThan(MAX_REDACT_INPUT_LENGTH);

    const inspected = await inspect();
    expect(inspected.chat).toContain('"isBinary":false');
    expect(inspected.chat).not.toContain("hunter2");

    const body = storedData().body as string;
    expect(() => JSON.parse(body)).not.toThrow();
    expect(body).toContain(MARKER);
  });
});
