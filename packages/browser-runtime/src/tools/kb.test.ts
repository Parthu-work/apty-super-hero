import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPolicy = vi.hoisted(() => vi.fn());
const kbSource = vi.hoisted(() => ({ current: vi.fn() }));

vi.mock("../runtime/value-policy", () => ({
  currentValuePolicy: mockPolicy,
  valuePolicyForMode: vi.fn(),
}));

vi.mock("../kb/kb-index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../kb/kb-index.js")>()),
  sharedKbIndexSource: () => kbSource,
}));

vi.hoisted(() => {
  (globalThis as { chrome?: unknown }).chrome = {
    tabs: { query: vi.fn(async () => []), get: vi.fn(), update: vi.fn() },
    storage: {
      local: { get: vi.fn(async () => ({})) },
      onChanged: { addListener: vi.fn() },
    },
    runtime: { id: "x" },
  };
});

import { createKbIndexSource } from "../kb/kb-index.js";
import {
  FIXTURE_CARDS,
  fixturePackText,
  memoryRecords,
} from "../kb/kb-test-utils.js";
import { createKbPackStore } from "../storage/kb-store.js";
import { browserToolGroups } from "./index";
import { searchKbTool } from "./kb";

type ToolLike = { invoke: (ctx: unknown, input: string) => Promise<unknown> };

async function run(tool: unknown, args: unknown) {
  const out = await (tool as ToolLike).invoke({}, JSON.stringify(args));
  return typeof out === "string" ? JSON.parse(out) : out;
}

async function loadPack(cards = FIXTURE_CARDS) {
  const store = createKbPackStore({ records: memoryRecords() });
  await store.replace(fixturePackText(cards));
  kbSource.current.mockImplementation(() =>
    createKbIndexSource(store).current(),
  );
}

beforeEach(() => {
  mockPolicy.mockReset();
  kbSource.current.mockReset();
});

describe("search_kb", () => {
  it("answers from the loaded pack, and names a missing pack", async () => {
    kbSource.current.mockResolvedValue(null);
    expect(await run(searchKbTool, { query: "banner" })).toEqual({
      status: "no_pack",
      results: [],
    });
    await loadPack();
    const result = await run(searchKbTool, {
      query: "Double Trigger setting",
      layers: [1],
    });
    expect(result.status).toBe("ok");
    expect(result.results[0].cite).toBe("kb://202#L1");
    expect(result.results.every((r: { layer: number }) => r.layer === 1)).toBe(
      true,
    );
  });

  it("takes only a query, a topK of 1 to 5 and layers: no pack, URL or page id", async () => {
    const { properties } = searchKbTool.parameters as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(properties).sort()).toEqual(["layers", "query", "topK"]);
    for (const args of [
      { query: "x".repeat(301) },
      { query: "" },
      { query: "a", topK: 6 },
      { query: "a", layers: [5] },
    ]) {
      const out = await (searchKbTool as unknown as ToolLike).invoke(
        {},
        JSON.stringify(args),
      );
      expect(String(out)).toMatch(/error/i);
    }
    expect(kbSource.current).not.toHaveBeenCalled();
  });

  it("is offered through the result-privacy filter, like every other tool", async () => {
    await loadPack([
      {
        pageId: "303",
        title: "FIXTURE portal link",
        layers: [
          "- Open https://portal.example.com/admin?tenant=884213 (FIXTURE).",
          "- a",
          "- b",
          "- c",
        ],
      },
    ]);
    mockPolicy.mockReturnValue("withhold");
    const [registered] = browserToolGroups.kb;
    expect(registered?.name).toBe("search_kb");
    const wrapped = await run(registered, { query: "portal link" });
    expect(JSON.stringify(wrapped)).not.toContain("884213");
    const direct = await run(searchKbTool, { query: "portal link" });
    expect(JSON.stringify(direct)).toContain("884213");
  });
});
