/**
 * KB-RAG K22 S3: a destination the organization policy does not allow gets
 * no request: not the chat, a custom model, the summary model, the
 * connection test or the model list.
 */
import type { AppSettings, OrgPolicy, OrgPolicyState } from "@apty/agent-core";
import { generateText, type LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  AiDestinationRefusedError,
  createAIProvider,
  policyGuardedFetch,
} from "./ai-provider";
import { fetchModelList } from "./model-list";

const active = (policy: OrgPolicy): OrgPolicyState => ({
  kind: "active",
  policy,
});

const ALLOWED = "https://ai.example.com";
const SETTINGS: AppSettings = {
  aiProvider: "custom",
  aiHost: `${ALLOWED}/v1`,
  aiToken: "k",
  aiModel: "gpt-chat",
};
const POLICY = active({
  allowedProviders: ["custom", "azure"],
  allowedOrigins: [ALLOWED],
  allowedModels: ["gpt-chat"],
});

const CHAT_REPLY = {
  id: "c1",
  object: "chat.completion",
  created: 1,
  model: "gpt-chat",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "hi" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

function okFetch() {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(CHAT_REPLY), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("createAIProvider under a policy", () => {
  it("sends to a destination on every list", async () => {
    const fetchImpl = okFetch();
    const provider = createAIProvider(SETTINGS, {
      fetch: fetchImpl as unknown as typeof fetch,
      policy: POLICY,
    });
    await generateText({
      model: provider("gpt-chat") as LanguageModel,
      prompt: "Hi",
      maxRetries: 0,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("refuses a provider off the list, naming what is allowed", () => {
    expect(() =>
      createAIProvider(
        { ...SETTINGS, aiProvider: "openai", aiHost: "" },
        { policy: POLICY },
      ),
    ).toThrow(
      "This AI provider is not allowed by your organization. Allowed: custom, azure.",
    );
  });

  it("refuses a custom model at an unlisted origin, and a look-alike host", () => {
    for (const aiHost of [
      "https://other.example.com/v1",
      "https://ai.example.com.evil.test/v1",
      "https://ai.example.com:8443/v1",
    ]) {
      expect(() =>
        createAIProvider({ ...SETTINGS, aiHost }, { policy: POLICY }),
      ).toThrow(AiDestinationRefusedError);
    }
  });

  it("refuses an http host that is not loopback", () => {
    expect(() =>
      createAIProvider(
        { ...SETTINGS, aiHost: "http://ai.example.com/v1" },
        { policy: active({}) },
      ),
    ).toThrow(/only https is allowed/);
  });

  it("refuses a model id off the list, as the summary model is built", () => {
    const provider = createAIProvider(SETTINGS, { policy: POLICY });
    expect(() => provider("claude-haiku-5-5")).toThrow(
      "This AI provider is not allowed by your organization. Allowed: gpt-chat.",
    );
  });

  it("makes no request under an invalid policy", async () => {
    const fetchImpl = okFetch();
    expect(() =>
      createAIProvider(SETTINGS, {
        fetch: fetchImpl as unknown as typeof fetch,
        policy: { kind: "invalid", reason: '"x" is not a policy key' },
      }),
    ).toThrow(/cannot be used \("x" is not a policy key\)/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("policyGuardedFetch (the last step)", () => {
  it("checks every request as it leaves: origin and body model", async () => {
    const base = okFetch();
    let policy = POLICY;
    const guarded = policyGuardedFetch(
      SETTINGS,
      base as unknown as typeof fetch,
      async () => policy,
    );
    await guarded(`${ALLOWED}/v1/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model: "gpt-chat" }),
    });
    expect(base).toHaveBeenCalledOnce();
    await expect(
      guarded("https://elsewhere.test/v1/chat/completions", {
        body: JSON.stringify({ model: "gpt-chat" }),
      }),
    ).rejects.toThrow(AiDestinationRefusedError);
    await expect(
      guarded(`${ALLOWED}/v1/chat/completions`, {
        body: JSON.stringify({ model: "gpt-mini" }),
      }),
    ).rejects.toThrow(/Allowed: gpt-chat/);
    // A policy that turns invalid after the provider was built stops it too.
    policy = { kind: "invalid", reason: "typo" };
    await expect(
      guarded(`${ALLOWED}/v1/chat/completions`, {
        body: JSON.stringify({ model: "gpt-chat" }),
      }),
    ).rejects.toThrow(AiDestinationRefusedError);
    expect(base).toHaveBeenCalledOnce();
  });
});

describe("fetchModelList under a policy", () => {
  it("sends the key nowhere the policy refuses", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchModelList(
      { ...SETTINGS, aiHost: "https://other.example.com/v1" },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadPolicy: async () => POLICY,
      },
    );
    expect(result).toEqual({
      ok: false,
      error: `This AI provider is not allowed by your organization. Allowed: ${ALLOWED}.`,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lists the policy's own models with no request", async () => {
    const fetchImpl = vi.fn();
    expect(
      await fetchModelList(SETTINGS, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadPolicy: async () => POLICY,
      }),
    ).toEqual({ ok: true, models: ["gpt-chat"], cached: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
