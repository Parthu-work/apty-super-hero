import { describe, expect, it, vi } from "vitest";
import { createKbPackStore } from "../storage/kb-store.js";
import { createKbIndexSource, kbToolResult } from "./kb-index.js";
import {
  FIXTURE_CARDS,
  type FixtureCard,
  fixturePackText,
  fixtureV2PackText,
  memoryRecords,
  unsignedAllowed,
  versionPackText,
} from "./kb-test-utils.js";

async function source(text = fixturePackText(FIXTURE_CARDS)) {
  const store = createKbPackStore({
    assess: unsignedAllowed,
    records: memoryRecords(),
  });
  await store.replace(text);
  return { store, source: createKbIndexSource(store) };
}

describe("kbToolResult", () => {
  it("names no pack and an uncovered question", async () => {
    expect(kbToolResult(null, "banner")).toEqual({
      status: "no_pack",
      source: "kb",
      cards: [],
      results: [],
    });
    const index = await (await source()).source.current();
    expect(kbToolResult(index, "kubernetes helm chart")).toEqual({
      status: "not_covered",
      source: "kb",
      cards: [],
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
      source: "kb",
      cards: [],
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

  it("K24-2: keeps the context words coverage left out to diagnostics, never in the model's result", async () => {
    const v2 = fixturePackText(
      FIXTURE_CARDS,
      { coverage: { min: 0.5, minIdf: 1, minTerms: 1 } },
      { schemaVersion: 2 },
    );
    const index = await (await source(v2)).source.current();
    const query = "tooltip opens twice on the ServiceNow form";
    expect(index?.search(query).contextIgnored).toEqual(["servicenow", "form"]);
    const result = kbToolResult(index, query);
    expect(result.status).toBe("ok");
    expect(JSON.stringify(result)).not.toMatch(/contextIgnored|servicenow/i);
    expect(kbToolResult(index, "ServiceNow incident form").status).toBe(
      "not_covered",
    );
  });

  it("names a card whose text is not written yet, with its link and no text", async () => {
    const index = await (await source(fixtureV2PackText())).source.current();
    expect(kbToolResult(index, "the gadget export never finishes")).toEqual({
      status: "stub",
      source: "kb",
      cards: [{ pageId: "303" }],
      stub: {
        cite: "kb://303",
        title: "FIXTURE gadget export never finishes",
        site: "fixture.atlassian.net",
        space: "FX",
        aptyVersion: "5.x",
      },
      mixedVersions: false,
      results: [],
    });
  });

  it("returns each chunk with its citation, Verified on line and NOT VERIFIED mark", async () => {
    const index = await (await source()).source.current();
    const result = kbToolResult(index, "glow.json glowIds", { topK: 1 });
    expect(result).toEqual({
      status: "ok",
      source: "kb",
      cards: [{ pageId: "101", layer: 3 }],
      mixedVersions: false,
      results: [
        {
          cite: "kb://101#L3",
          title: "FIXTURE banner never glows",
          site: "fixture.atlassian.net",
          space: "FX",
          aptyVersion: "5.x",
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

describe("createKbIndexSource per version (K12)", () => {
  const banner = (pageId: string) => ({
    ...(FIXTURE_CARDS[0] as FixtureCard),
    pageId,
  });
  async function threePacks() {
    const store = createKbPackStore({
      assess: unsignedAllowed,
      records: memoryRecords(),
    });
    await store.replace(versionPackText("4.x", [banner("401")], "A4X"));
    await store.replace(
      versionPackText(
        "5.x",
        [banner("501"), FIXTURE_CARDS[1] as FixtureCard],
        "JX",
      ),
    );
    await store.replace(
      versionPackText(
        "common",
        [
          {
            pageId: "601",
            title: "FIXTURE policy blocks the extension",
            layers: [
              "- In Admin, allow the FIXTURE extension in the browser policy.",
              "- chrome://policy lists the FIXTURE block.",
              "- policy.json lists blockedIds (FIXTURE).",
              "- Send support the FIXTURE policy export.",
            ],
          },
        ],
        "CX",
      ),
    );
    return { store, source: createKbIndexSource(store) };
  }

  it("gives a 4.x tab the 4.x and common cards only, linked in their own spaces", async () => {
    const { source: kb } = await threePacks();
    const result = kbToolResult(
      await kb.current("4.x"),
      "the banner never glows",
      {
        onePerCard: true,
        topK: 5,
      },
    );
    expect(
      result.results.map((hit) => [hit.cite, hit.aptyVersion, hit.space]),
    ).toEqual([["kb://401#L1", "4.x", "A4X"]]);
    expect(
      kbToolResult(await kb.current("4.x"), "the tooltip opens twice").status,
    ).toBe("not_covered");
  });

  it("searches every pack for an unknown version, labels both versions and says they differ", async () => {
    const { source: kb } = await threePacks();
    const result = kbToolResult(
      await kb.current("unknown"),
      "the banner never glows",
      {
        onePerCard: true,
      },
    );
    expect(
      result.results
        .slice(0, 2)
        .map((hit) => hit.aptyVersion)
        .sort(),
    ).toEqual(["4.x", "5.x"]);
    expect(result.mixedVersions).toBe(true);
  });

  it("keeps one index per set of packs, and forgets a removed version", async () => {
    const { store, source: kb } = await threePacks();
    const first = await kb.current("5.x");
    expect(await kb.current("5.x")).toBe(first);
    expect(first?.info.aptyVersions).toEqual(["5.x", "common"]);
    await store.remove("4.x");
    expect(await kb.current("4.x")).not.toBe(null);
    expect((await kb.current("4.x"))?.info.aptyVersions).toEqual(["common"]);
    await store.remove("common");
    expect(await kb.current("4.x")).toBeNull();
    expect(await kb.current("5.x")).not.toBe(first);
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

    await store.remove("5.x");
    expect(await kb.current()).toBeNull();
  });
});
