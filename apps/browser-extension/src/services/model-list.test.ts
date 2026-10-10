import type { AppSettings } from "@apty/agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearModelListCache,
  fetchModelList,
  MODEL_LIST_CACHE_MS,
  parseModelPage,
} from "./model-list";

const KEY = "sk-secret-key-123456";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requests(fetchImpl: ReturnType<typeof vi.fn>) {
  return fetchImpl.mock.calls.map(([url, init]) => ({
    url: String(url),
    headers: init?.headers as Record<string, string>,
  }));
}

const openai: AppSettings = {
  aiProvider: "openai",
  aiHost: "https://api.openai.com/v1",
  aiToken: KEY,
};

beforeEach(() => {
  clearModelListCache();
});

describe("parseModelPage", () => {
  it("reads OpenAI-style { data: [{ id }] } and a bare array (Together)", () => {
    expect(
      parseModelPage("openai-compatible", {
        object: "list",
        data: [{ id: "b" }, { id: "a" }],
      }),
    ).toEqual({ models: ["b", "a"], next: null });
    expect(
      parseModelPage("openai-compatible", [{ id: "meta/x", type: "chat" }]),
    ).toEqual({ models: ["meta/x"], next: null });
  });

  it("follows Anthropic's has_more / last_id", () => {
    expect(
      parseModelPage("anthropic", {
        data: [{ type: "model", id: "claude-opus-5-5" }],
        has_more: true,
        last_id: "claude-opus-5-5",
      }),
    ).toEqual({ models: ["claude-opus-5-5"], next: "claude-opus-5-5" });
  });

  it("keeps only Gemini models that generate content, without the models/ prefix", () => {
    expect(
      parseModelPage("google", {
        models: [
          {
            name: "models/gemini-flash-latest",
            supportedGenerationMethods: ["generateContent", "countTokens"],
          },
          {
            name: "models/text-embedding-004",
            supportedGenerationMethods: ["embedContent"],
          },
        ],
        nextPageToken: "p2",
      }),
    ).toEqual({ models: ["gemini-flash-latest"], next: "p2" });
  });

  it("returns nothing for an unexpected shape", () => {
    expect(parseModelPage("openai-compatible", { models: 3 })).toEqual({
      models: [],
      next: null,
    });
  });
});

describe("fetchModelList", () => {
  it("asks an OpenAI-compatible host for /models with a Bearer key, sorted, key never in the URL", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-a" }] }),
    );

    await expect(fetchModelList(openai, { fetchImpl })).resolves.toEqual({
      ok: true,
      models: ["model-a", "model-b"],
      cached: false,
    });
    expect(requests(fetchImpl)).toEqual([
      {
        url: "https://api.openai.com/v1/models",
        headers: { Authorization: `Bearer ${KEY}` },
      },
    ]);
  });

  it("uses x-api-key and anthropic-version for Anthropic, adds /v1 to a bare host, and pages", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json({ data: [{ id: "m1" }], has_more: true, last_id: "m1" }),
      )
      .mockResolvedValueOnce(json({ data: [{ id: "m2" }], has_more: false }));

    const result = await fetchModelList(
      {
        aiProvider: "anthropic",
        aiHost: "https://api.anthropic.com",
        aiToken: KEY,
      },
      { fetchImpl },
    );

    expect(result).toMatchObject({ ok: true, models: ["m1", "m2"] });
    expect(requests(fetchImpl)).toEqual([
      {
        url: "https://api.anthropic.com/v1/models?limit=1000",
        headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      },
      {
        url: "https://api.anthropic.com/v1/models?limit=1000&after_id=m1",
        headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      },
    ]);
  });

  it("uses the x-goog-api-key header and Gemini's default host and page token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json({ models: [{ name: "models/a" }], nextPageToken: "t" }),
      )
      .mockResolvedValueOnce(json({ models: [{ name: "models/b" }] }));

    const result = await fetchModelList(
      { aiProvider: "google", aiToken: KEY },
      { fetchImpl },
    );

    expect(result).toMatchObject({ ok: true, models: ["a", "b"] });
    expect(requests(fetchImpl).map((r) => r.url)).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=t",
    ]);
    expect(requests(fetchImpl)[0]?.headers).toEqual({ "x-goog-api-key": KEY });
  });

  it.each([
    [401, "The provider rejected the API key (401)."],
    [403, "The API key is not allowed to list models (403)."],
    [404, "This host has no models list (404). Type the model id instead."],
    [429, "The provider is rate limiting requests (429). Try again shortly."],
    [500, "The provider answered 500 to the models list request."],
  ])("names a %s", async (status, error) => {
    const fetchImpl = vi.fn(async () =>
      json({ error: { message: KEY } }, status),
    );
    const result = await fetchModelList(openai, { fetchImpl });
    expect(result).toEqual({ ok: false, status, error });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("names an unreachable host and a timeout", async () => {
    await expect(
      fetchModelList(openai, {
        fetchImpl: vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
      }),
    ).resolves.toEqual({ ok: false, error: "Could not reach api.openai.com." });
    await expect(
      fetchModelList(openai, {
        fetchImpl: vi.fn(async () => {
          throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      error: "api.openai.com did not answer within 10s.",
    });
  });

  it("refuses private and plain-http hosts before any request, and needs a key", async () => {
    const fetchImpl = vi.fn();
    for (const aiHost of [
      "https://10.0.0.5/v1",
      "http://models.example.com/v1",
    ]) {
      const result = await fetchModelList({ ...openai, aiHost }, { fetchImpl });
      expect(result.ok).toBe(false);
    }
    expect(
      await fetchModelList({ ...openai, aiToken: " " }, { fetchImpl }),
    ).toEqual({ ok: false, error: "Enter an API key first." });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows a loopback model server over http", async () => {
    const fetchImpl = vi.fn(async () => json({ data: [{ id: "llama" }] }));
    await fetchModelList(
      {
        aiProvider: "custom",
        aiHost: "http://localhost:11434/v1",
        aiToken: "x",
      },
      { fetchImpl },
    );
    expect(requests(fetchImpl)[0]?.url).toBe(
      "http://localhost:11434/v1/models",
    );
  });

  it("caches a list per provider and host for ten minutes, and never caches a failure", async () => {
    let now = 1_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429))
      .mockImplementation(async () => json({ data: [{ id: "m" }] }));
    const options = { fetchImpl, now: () => now };

    expect((await fetchModelList(openai, options)).ok).toBe(false);
    expect(await fetchModelList(openai, options)).toMatchObject({
      cached: false,
    });
    now += MODEL_LIST_CACHE_MS - 1;
    expect(await fetchModelList(openai, options)).toMatchObject({
      cached: true,
    });
    expect(
      await fetchModelList(
        { ...openai, aiHost: "https://api.groq.com/openai/v1" },
        options,
      ),
    ).toMatchObject({ cached: false });
    now += 1;
    expect(await fetchModelList(openai, options)).toMatchObject({
      cached: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("reports an empty list and a non-JSON answer", async () => {
    expect(
      await fetchModelList(openai, {
        fetchImpl: vi.fn(async () => json({ data: [] })),
      }),
    ).toEqual({ ok: false, error: "The provider listed no models." });
    clearModelListCache();
    expect(
      await fetchModelList(openai, {
        fetchImpl: vi.fn(async () => new Response("<html>")),
      }),
    ).toEqual({ ok: false, error: "The models list was not JSON." });
  });
});
