import { describe, expect, it, vi } from "vitest";
import { createKbPackStore } from "../storage/kb-store.js";
import { createKbIndexSource, kbToolResult } from "./kb-index.js";
import {
  FIXTURE_CARDS,
  fixturePackText,
  memoryRecords,
} from "./kb-test-utils.js";

async function source(text = fixturePackText(FIXTURE_CARDS)) {
  const store = createKbPackStore({ records: memoryRecords() });
  await store.replace(text);
  return { store, source: createKbIndexSource(store) };
}

describe("kbToolResult", () => {
  it("names no pack and an uncovered question", async () => {
    expect(kbToolResult(null, "banner")).toEqual({
      status: "no_pack",
      results: [],
    });
    const index = await (await source()).source.current();
    expect(kbToolResult(index, "kubernetes helm chart")).toEqual({
      status: "not_covered",
      reason: "no_match",
      results: [],
    });
  });

  it("tells the model why a schema 2 pack does not cover a question, naming a setting it lacks", async () => {
    const v2 = fixturePackText(
      FIXTURE_CARDS,
      { coverage: { min: 0.5, minIdf: 1, minTerms: 1 } },
      { schemaVersion: 2 },
    );
    const index = await (await source(v2)).source.current();
    expect(
      kbToolResult(index, "where is the Glowing Toggle for the banner"),
    ).toEqual({
      status: "not_covered",
      reason: "unknown_setting",
      missingPhrases: ["Glowing Toggle"],
      results: [],
    });
    expect(
      kbToolResult(
        index,
        "our kubernetes pod restarts with CrashLoopBackOff after the helm upgrade overnight",
      ),
    ).toMatchObject({ status: "not_covered", results: [] });
    expect(kbToolResult(index, "tooltip opens twice").status).toBe("ok");
  });

  it("returns each chunk with its citation, Verified on line and NOT VERIFIED mark", async () => {
    const index = await (await source()).source.current();
    const result = kbToolResult(index, "glow.json glowIds", { topK: 1 });
    expect(result).toEqual({
      status: "ok",
      results: [
        {
          cite: "kb://101#L3",
          title: "FIXTURE banner never glows",
          layer: 3,
          heading: "Layer 3: FIXTURE banner never glows, part 3",
          verifiedOn: "Verified on: FIXTURE code, 2026-01-01.",
          notVerified: true,
          score: expect.any(Number),
          text: "- NOT VERIFIED: glow.json lists glowIds (FIXTURE).",
        },
      ],
    });
    const score = result.results[0]?.score ?? 0;
    expect(Math.round(score * 1000) / 1000).toBe(score);
  });

  it("keeps whole chunks, at most 4,000 characters in all", async () => {
    const long = (word: string) => `- ${word} ${"x".repeat(990)}`;
    const cards = ["1", "2", "3", "4", "5"].map((pageId) => ({
      pageId,
      title: `FIXTURE long ${pageId}`,
      layers: [long("lengthy"), "- a", "- b", "- c"] as [
        string,
        string,
        string,
        string,
      ],
    }));
    const index = await (await source(fixturePackText(cards))).source.current();
    const result = kbToolResult(index, "lengthy", { topK: 5 });
    expect(result.results).toHaveLength(4);
    expect(
      result.results.reduce((sum, hit) => sum + hit.text.length, 0),
    ).toBeLessThanOrEqual(4000);
  });
});

describe("createKbIndexSource", () => {
  it("builds the index once per pack, rebuilds for a new pack and forgets a removed one", async () => {
    const { store, source: kb } = await source();
    const load = vi.spyOn(store, "load");
    const first = await kb.current();
    expect(await kb.current()).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);

    await store.replace(fixturePackText(FIXTURE_CARDS.slice(1)));
    const second = await kb.current();
    expect(second).not.toBe(first);
    expect(second?.info.cardCount).toBe(1);

    await store.remove();
    expect(await kb.current()).toBeNull();
  });
});
