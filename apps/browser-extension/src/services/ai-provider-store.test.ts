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
