/**
 * A tool result that is JSON cut off part way (a log line, a truncated body)
 * is not valid JSON, so it is redacted as text. This is what the model and MCP
 * clients get for it: the outbound sanitizer (chat) and redactToolOutput (what
 * the MCP server runs).
 */
import type { AgentInputItem } from "@apty/agent-core";
import { describe, expect, it } from "vitest";
import {
  createOutboundSanitizer,
  redactToolOutput,
} from "./outbound-sanitizer.js";

type Mode = "strict" | "standard";

async function asSent(
  mode: Mode,
  text: string,
): Promise<Record<"chat" | "mcp", unknown>> {
  const [item] = await createOutboundSanitizer({ getMode: () => mode })([
    {
      type: "function_call_result",
      name: "get_console_logs",
      callId: `call-${mode}`,
      output: text,
    } as AgentInputItem,
  ]);
  return {
    chat: (item as { output: unknown }).output,
    mcp: redactToolOutput(text, mode),
  };
}

async function expectTruncatedSentAs(mode: Mode, cases: [string, string][]) {
  for (const [text, expected] of cases) {
    expect(() => JSON.parse(text), text).toThrow();
    for (const [layer, sent] of Object.entries(await asSent(mode, text))) {
      expect(sent, `${layer} ${text}`).toBe(expected);
    }
  }
}

describe("truncated JSON text, at the model layer", () => {
  it.each([
    "strict",
    "standard",
  ] as const)("%s: an object or array under a hyphenated credential key is masked whole", async (mode) => {
    await expectTruncatedSentAs(mode, [
      [
        '{"X-Api-Key": {"v":"S6"}, "next": 1',
        '{"X-Api-Key": "<REDACTED>", "next": 1',
      ],
      [
        '{"x-auth-token": ["a","b"], "next": 1',
        '{"x-auth-token": "<REDACTED>", "next": 1',
      ],
      [
        '{"Proxy-Authorization": {"k":"v"}, "next": 1',
        '{"Proxy-Authorization": "<REDACTED>", "next": 1',
      ],
      [
        '{"req":{"headers":{"X-Api-Key":{"inner":{"v":"S9"}},"x-request-id":"r1"},"body":"cut',
        '{"req":{"headers":{"X-Api-Key":"<REDACTED>","x-request-id":"r1"},"body":"cut',
      ],
      ['{"X-Api-Key": {"v":"S6", "w":', '{"X-Api-Key": "<REDACTED>"'],
    ]);
  });

  it.each([
    "strict",
    "standard",
  ] as const)("%s: what a later pass masked across such a value stays masked", async (mode) => {
    for (const [text, secret] of [
      [
        '{"X-Api-Key": ["-----BEGIN KEY-----"], "x": "SECRETPEM-----END KEY-----"}, "t": 1',
        "SECRETPEM",
      ],
      ['{"X-Api-Key": [token=abc]SECRETRUN, "n": 1', "SECRETRUN"],
    ]) {
      for (const [layer, sent] of Object.entries(await asSent(mode, text))) {
        expect(sent, `${layer} ${text}`).not.toContain(secret);
      }
    }
  });

  it.each([
    "strict",
    "standard",
  ] as const)("%s: string values and keys not on the list are sent as before", async (mode) => {
    await expectTruncatedSentAs(mode, [
      [
        '{"X-Api-Key": "S7", "x-auth-token": "a\\"b", "next": 1',
        '{"X-Api-Key": "<REDACTED>", "x-auth-token": "<REDACTED>", "next": 1',
      ],
      [
        '{"Proxy-Authorization": "Basic S8',
        '{"Proxy-Authorization": "<REDACTED>"',
      ],
      [
        '{"x-request-id": {"id":"r1"}, "x-request-id": ["r2"], "name": {"first":"Jane"}, "next": 1',
        '{"x-request-id": {"id":"r1"}, "x-request-id": ["r2"], "name": {"first":"Jane"}, "next": 1',
      ],
      [
        '{"token_count": "42", "tokenizer": "cl100k", "name": "Jane", "x-request-id": "r3"',
        '{"token_count": "<REDACTED>", "tokenizer": "<REDACTED>", "name": "Jane", "x-request-id": "r3"',
      ],
    ]);
  });

  it.each([
    "strict",
    "standard",
  ] as const)("%s: well-formed JSON is masked by key, as before", async (mode) => {
    const text =
      '{"X-Api-Key":{"v":"S6"},"x-request-id":"r1","token_count":42,"tokenizer":"cl100k","name":"Jane"}';
    for (const [layer, sent] of Object.entries(await asSent(mode, text))) {
      expect(sent, layer).toBe(
        '{"X-Api-Key":"<REDACTED>","x-request-id":"r1","token_count":42,"tokenizer":"cl100k","name":"Jane"}',
      );
    }
  });
});
