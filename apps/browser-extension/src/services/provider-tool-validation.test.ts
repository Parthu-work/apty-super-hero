/**
 * The tool schemas a provider receives, for every registered tool: the agent
 * is built as the extension builds it (createAIProvider, aisdk, the browser
 * tools and the outbound filters) and the request each provider path would
 * send is captured. Some OpenAI-compatible providers (Groq among them)
 * reject an object schema that has `required` but no `properties`, which a
 * tool with `z.object({})` must never produce.
 */
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("import", { meta: { env: { PROD: false } } });

vi.hoisted(() => {
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      id: "agent",
      lastError: undefined,
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
      getURL: (path: string) => path,
    },
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn() },
    },
    tabs: { query: vi.fn(async () => []), onRemoved: { addListener: vi.fn() } },
  };
});

import { AptyAgent, aisdk } from "@apty/agent-core";
import { allBrowserTools } from "@apty/browser-runtime/tools";
import { createOutboundFilters } from "../hooks/outbound-filters";
import { createAIProvider } from "./ai-provider";

let ARGS: Record<string, unknown> = {};
let ARGS_JSON = "";
function callWith(topK: number): void {
  ARGS = {
    query: "content is not visible",
    topK,
    layers: null,
    aptyVersion: null,
  };
  ARGS_JSON = JSON.stringify(ARGS);
}

function sse(events: unknown[], named = false): Response {
  const text = events
    .map((event) => {
      const type = (event as { type?: string }).type;
      return `${named && type ? `event: ${type}\n` : ""}data: ${JSON.stringify(event)}\n\n`;
    })
    .join("");
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** One provider's streamed answer: a search_kb call first, then a short text. */
const ANSWERS = {
  anthropic: (call) =>
    sse(
      [
        {
          type: "message_start",
          message: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
        call
          ? {
              type: "content_block_start",
              index: 0,
              content_block: {
                type: "tool_use",
                id: "toolu_1",
                name: "search_kb",
                input: {},
              },
            }
          : {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            },
        call
          ? {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: ARGS_JSON },
            }
          : {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "done" },
            },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: call ? "tool_use" : "end_turn" },
          usage: { output_tokens: 1 },
        },
        { type: "message_stop" },
      ],
      true,
    ),
  chat: (call) =>
    new Response(
      `${[
        call
          ? {
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_1",
                        type: "function",
                        function: { name: "search_kb", arguments: ARGS_JSON },
                      },
                    ],
                  },
                },
              ],
            }
          : {
              choices: [
                { index: 0, delta: { role: "assistant", content: "done" } },
              ],
            },
        {
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: call ? "tool_calls" : "stop",
            },
          ],
        },
      ]
        .map(
          (c) =>
            `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "m", ...c })}\n\n`,
        )
        .join("")}data: [DONE]\n\n`,
      { status: 200, headers: { "content-type": "text/event-stream" } },
    ),
  responses: (call) =>
    sse([
      {
        type: "response.created",
        response: { id: "r1", created_at: 1, model: "m" },
      },
      call
        ? {
            type: "response.output_item.added",
            output_index: 0,
            item: {
              type: "function_call",
              id: "fc_1",
              call_id: "call_1",
              name: "search_kb",
              arguments: "",
            },
          }
        : {
            type: "response.output_item.added",
            output_index: 0,
            item: { type: "message", id: "m_1" },
          },
      call
        ? {
            type: "response.function_call_arguments.delta",
            item_id: "fc_1",
            output_index: 0,
            delta: ARGS_JSON,
          }
        : {
            type: "response.output_text.delta",
            item_id: "m_1",
            delta: "done",
          },
      call
        ? {
            type: "response.output_item.done",
            output_index: 0,
            item: {
              type: "function_call",
              id: "fc_1",
              call_id: "call_1",
              name: "search_kb",
              arguments: ARGS_JSON,
              status: "completed",
            },
          }
        : {
            type: "response.output_item.done",
            output_index: 0,
            item: { type: "message", id: "m_1" },
          },
      {
        type: "response.completed",
        response: {
          id: "r1",
          created_at: 1,
          model: "m",
          incomplete_details: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    ]),
  google: (call) =>
    sse([
      {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                call
                  ? { functionCall: { name: "search_kb", args: ARGS } }
                  : { text: "done" },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      },
    ]),
} satisfies Record<string, (call: boolean) => Response>;

const PATHS: Array<
  [string, Record<string, string>, keyof typeof ANSWERS, string]
> = [
  [
    "Anthropic",
    { aiProvider: "anthropic", aiHost: "https://api.anthropic.com" },
    "anthropic",
    "claude-sonnet-4-5",
  ],
  [
    "Groq",
    { aiProvider: "groq", aiHost: "https://api.groq.com/openai/v1" },
    "chat",
    "m",
  ],
  [
    "OpenRouter",
    { aiProvider: "openrouter", aiHost: "https://openrouter.ai/api/v1" },
    "chat",
    "m",
  ],
  [
    "OpenAI",
    { aiProvider: "openai", aiHost: "https://api.openai.com/v1" },
    "responses",
    "m",
  ],
  [
    "Google",
    {
      aiProvider: "google",
      aiHost: "https://generativelanguage.googleapis.com/v1beta",
    },
    "google",
    "m",
  ],
];

/** The tool layer's own error for input its Zod schema refuses. */
const INVALID = "Invalid JSON input for tool";

/** The second request's body: what the provider is sent after the tool ran. */
async function afterToolCall(
  settings: Record<string, string>,
  answer: (call: boolean) => Response,
  model: string,
): Promise<string> {
  const bodies: string[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    return answer(bodies.length === 1);
  }) as typeof globalThis.fetch;
  const provider = createAIProvider(
    { ...settings, aiToken: "test", aiModel: model } as never,
    { fetch },
  );
  const agent = AptyAgent.create({
    instructions: "Test",
    model: aisdk(provider(model)),
    tools: allBrowserTools,
    outboundFilters: createOutboundFilters(),
  });
  for await (const _event of agent.chat("hello")) {
    // Two requests: the tool call, then the answer.
  }
  expect(bodies.length, "requests sent").toBe(2);
  return bodies[1] as string;
}

describe("tool input stays validated on every provider path (KB-RAG K25, A1)", () => {
  it.each(
    PATHS,
  )("%s: search_kb with topK 9 is rejected by the tool's own schema", async (_label, settings, format, model) => {
    callWith(9);
    const rejected = await afterToolCall(settings, ANSWERS[format], model);
    expect(rejected).toContain(INVALID);

    callWith(3);
    const accepted = await afterToolCall(settings, ANSWERS[format], model);
    expect(accepted).not.toContain(INVALID);
  });
});
