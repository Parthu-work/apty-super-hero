import type { AppSettings } from "@apty/agent-core";
import { generateText, type LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { createAIProvider } from "./ai-provider";

function recordingFetch(reply: unknown) {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { bodies, fetchImpl };
}

const RESPONSES_REPLY = {
  id: "resp_1",
  object: "response",
  created_at: 1,
  model: "gpt-4o",
  status: "completed",
  output: [
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "hi", annotations: [] }],
    },
  ],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
};

const CHAT_REPLY = {
  id: "c1",
  object: "chat.completion",
  created: 1,
  model: "m",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "hi" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

async function sendOne(settings: AppSettings, reply: unknown) {
  const { bodies, fetchImpl } = recordingFetch(reply);
  const provider = createAIProvider(settings, { fetch: fetchImpl });
  await generateText({
    model: provider(settings.aiModel ?? "") as LanguageModel,
    prompt: "Hi",
    maxRetries: 0,
  });
  return bodies;
}

describe("OpenAI requests are not stored on OpenAI's side", () => {
  it("sends store: false on an OpenAI request", async () => {
    const bodies = await sendOne(
      { aiProvider: "openai", aiToken: "sk-test", aiModel: "gpt-4o" },
      RESPONSES_REPLY,
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.store).toBe(false);
  });

  it("leaves OpenAI-compatible providers unchanged", async () => {
    const bodies = await sendOne(
      {
        aiProvider: "custom" as AppSettings["aiProvider"],
        aiToken: "k",
        aiHost: "https://proxy.example.com/v1",
        aiModel: "m",
      },
      CHAT_REPLY,
    );
    expect(bodies[0]).not.toHaveProperty("store");
  });
});

const ANTHROPIC_REPLY = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-test",
  content: [{ type: "text", text: "hi" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};

const ANTHROPIC: AppSettings = {
  aiProvider: "anthropic",
  aiToken: "sk-ant-test",
  aiModel: "claude-test",
};

type AnthropicBlock = { cache_control?: unknown };
type AnthropicBody = {
  system?: AnthropicBlock[];
  messages: Array<{ content: AnthropicBlock[] }>;
};

async function sendAnthropic(
  request: Omit<Parameters<typeof generateText>[0], "model">,
) {
  const { bodies, fetchImpl } = recordingFetch(ANTHROPIC_REPLY);
  const provider = createAIProvider(ANTHROPIC, { fetch: fetchImpl });
  await generateText({
    ...request,
    model: provider("claude-test") as LanguageModel,
    maxRetries: 0,
  } as Parameters<typeof generateText>[0]);
  return bodies[0] as unknown as AnthropicBody;
}

const breakpoints = (body: AnthropicBody) =>
  [...(body.system ?? []), ...body.messages.flatMap((m) => m.content)].filter(
    (block) => block.cache_control !== undefined,
  ).length;

describe("Anthropic requests mark the stable prefix and the newest turn for caching", () => {
  it("marks the system prompt and the last block of the last message, nothing else", async () => {
    const body = await sendAnthropic({
      system: "You are the Apty Agent.",
      messages: [
        { role: "user", content: "investigate the widget" },
        { role: "assistant", content: "Starting." },
        {
          role: "user",
          content: [
            { type: "text", text: "ok" },
            { type: "text", text: "go ahead" },
          ],
        },
      ],
    });

    const ephemeral = { type: "ephemeral" };
    expect(body.system?.at(-1)?.cache_control).toEqual(ephemeral);
    const last = body.messages.at(-1)?.content;
    expect(last?.at(-1)?.cache_control).toEqual(ephemeral);
    expect(last?.at(0)?.cache_control).toBeUndefined();
    expect(breakpoints(body)).toBe(2);
  });

  it("marks the tool result when a tool loop step ends the conversation", async () => {
    const body = await sendAnthropic({
      system: "You are the Apty Agent.",
      messages: [
        { role: "user", content: "check dom health" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "run_dom_health_audit",
              input: {},
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "run_dom_health_audit",
              output: { type: "text", value: "score 80" },
            },
          ],
        },
      ],
    });

    const last = body.messages.at(-1)?.content.at(-1) as AnthropicBlock & {
      type?: string;
    };
    expect(last.type).toBe("tool_result");
    expect(last.cache_control).toEqual({ type: "ephemeral" });
    expect(breakpoints(body)).toBe(2);
  });

  it("marks only the message when there is no system prompt", async () => {
    const body = await sendAnthropic({ prompt: "Hi" });

    expect(body.system).toBeUndefined();
    expect(body.messages.at(-1)?.content.at(-1)?.cache_control).toEqual({
      type: "ephemeral",
    });
    expect(breakpoints(body)).toBe(1);
  });
});
