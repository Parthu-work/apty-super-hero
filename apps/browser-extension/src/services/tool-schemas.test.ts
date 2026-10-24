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

type Schema = Record<string, unknown>;

/** Every object in `schema` that has `required` but no `properties`, by path. */
function requiredWithoutProperties(schema: unknown, path = "$"): string[] {
  if (Array.isArray(schema)) {
    return schema.flatMap((item, i) =>
      requiredWithoutProperties(item, `${path}[${i}]`),
    );
  }
  if (!schema || typeof schema !== "object") return [];
  const node = schema as Schema;
  const here = "required" in node && !("properties" in node) ? [path] : [];
  return [
    ...here,
    ...Object.entries(node).flatMap(([key, value]) =>
      requiredWithoutProperties(value, `${path}.${key}`),
    ),
  ];
}

/** The body of the first request the agent sends through this provider. */
async function requestBody(
  settings: Record<string, string>,
): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> | undefined;
  const fetch = (async (_url: string, init: RequestInit) => {
    body ??= JSON.parse(String(init.body));
    return new Response('{"error":{"message":"captured"}}', { status: 400 });
  }) as typeof globalThis.fetch;
  const provider = createAIProvider(
    { ...settings, aiToken: "test", aiModel: "m" } as never,
    { fetch },
  );
  const agent = AptyAgent.create({
    instructions: "Test",
    model: aisdk(provider("m")),
    tools: allBrowserTools,
    outboundFilters: createOutboundFilters(),
  });
  for await (const _event of agent.chat("hello")) {
    // The provider answers 400, so the run ends after this one request.
  }
  if (!body) throw new Error("no request was sent");
  return body;
}

/** Each tool's parameters in the request, by tool name, whatever the provider's format. */
function sentSchemas(body: Record<string, unknown>): Map<string, unknown> {
  const schemas = new Map<string, unknown>();
  for (const entry of (body.tools as Schema[] | undefined) ?? []) {
    const fn = entry.function as Schema | undefined;
    const name = (fn?.name ?? entry.name) as string;
    schemas.set(name, fn?.parameters ?? entry.parameters ?? entry.input_schema);
  }
  return schemas;
}

const PROVIDERS = {
  "OpenAI-compatible (custom, e.g. Groq)": {
    aiProvider: "groq",
    aiHost: "https://api.groq.com/openai/v1",
  },
  OpenAI: { aiProvider: "openai", aiHost: "https://api.openai.com/v1" },
  Anthropic: { aiProvider: "anthropic", aiHost: "https://api.anthropic.com" },
};

describe("tool schemas as each provider receives them", () => {
  it("never has required without properties in any registered tool's own schema", () => {
    for (const tool of allBrowserTools as Array<{
      name: string;
      parameters?: unknown;
    }>) {
      expect(requiredWithoutProperties(tool.parameters), tool.name).toEqual([]);
    }
  });

  it.each(
    Object.entries(PROVIDERS),
  )("%s: every registered tool is sent, none with required but no properties", async (_label, settings) => {
    const schemas = sentSchemas(await requestBody(settings));

    expect([...schemas.keys()].sort()).toEqual(
      allBrowserTools.map((t) => t.name).sort(),
    );
    for (const [name, schema] of schemas) {
      expect(requiredWithoutProperties(schema), name).toEqual([]);
    }
    expect(schemas.get("connect_apty_client")).toMatchObject({
      type: "object",
      properties: {},
    });
    expect(schemas.get("get_apty_widget_diagnostics")).toMatchObject({
      type: "object",
      properties: {},
    });
  });
});

describe("strict on tools without parameters", () => {
  type SentTool = {
    function: { name: string; parameters: Schema; strict?: boolean };
  };

  async function sentTools(settings: Record<string, string>) {
    return ((await requestBody(settings)).tools as SentTool[]).map(
      (t) => t.function,
    );
  }
  const hasNoProperties = (fn: { parameters: Schema }) =>
    Object.keys((fn.parameters.properties as object) ?? {}).length === 0;

  it("Groq: tools without parameters carry no strict, tools with parameters keep it", async () => {
    const tools = await sentTools(
      PROVIDERS["OpenAI-compatible (custom, e.g. Groq)"],
    );

    expect(tools).toHaveLength(allBrowserTools.length);
    const empty = tools.filter(hasNoProperties);
    const withParameters = tools.filter((fn) => !hasNoProperties(fn));
    expect(empty.map((fn) => fn.name)).toEqual(
      expect.arrayContaining([
        "connect_apty_client",
        "get_apty_widget_diagnostics",
      ]),
    );
    for (const fn of empty) expect("strict" in fn, fn.name).toBe(false);
    expect(withParameters.length).toBeGreaterThan(0);
    for (const fn of withParameters) expect(fn.strict, fn.name).toBe(true);
  });

  it("Groq is detected by host, whatever the provider key", async () => {
    const tools = await sentTools({
      aiProvider: "custom",
      aiHost: "https://api.groq.com/openai/v1",
    });
    expect(
      tools.find((fn) => fn.name === "connect_apty_client"),
    ).not.toHaveProperty("strict");
  });

  it.each([
    [
      "OpenRouter",
      { aiProvider: "openrouter", aiHost: "https://openrouter.ai/api/v1" },
    ],
    [
      "another OpenAI-compatible host",
      { aiProvider: "custom", aiHost: "https://llm.example.com/v1" },
    ],
  ])("%s: every tool keeps strict: true", async (_label, settings) => {
    const tools = await sentTools(settings);
    expect(tools).toHaveLength(allBrowserTools.length);
    for (const fn of tools) expect(fn.strict, fn.name).toBe(true);
  });

  it("OpenAI: every tool keeps strict: true", async () => {
    const body = await requestBody(PROVIDERS.OpenAI);
    const tools = body.tools as Array<{ name: string; strict?: boolean }>;
    expect(tools).toHaveLength(allBrowserTools.length);
    for (const tool of tools) expect(tool.strict, tool.name).toBe(true);
  });
});
