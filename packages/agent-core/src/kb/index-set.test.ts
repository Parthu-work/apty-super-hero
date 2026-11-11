import { describe, expect, it } from "vitest";
import { createKbIndexSet } from "./index-set.js";
import { type SyntheticCard, syntheticPack } from "./kb-test-utils.js";
import { createKbIndex } from "./search.js";

const layers = (topic: string): [string, string, string, string] => [
  `- In Studio, turn on the FIXTURE ${topic} Switch.`,
  `- The FIXTURE ${topic} element must be on the page.`,
  `- ${topic.toLowerCase()}.json lists the FIXTURE ${topic} ids.`,
  `- Send support the FIXTURE ${topic} id.`,
];
const card = (pageId: string, title: string, topic: string): SyntheticCard => ({
  pageId,
  title,
  layers: layers(topic),
});
const COVERAGE = { coverage: { min: 0.4, minIdf: 0.5, minTerms: 1 } };
const pack = (aptyVersion: "4.x" | "5.x" | "common", cards: SyntheticCard[]) =>
  syntheticPack(cards, COVERAGE, { schemaVersion: 2, aptyVersion } as never);

const FOUR = pack("4.x", [
  card("41", "FIXTURE beacon hides behind the menu", "Beacon"),
  card("42", "FIXTURE flow stops at the second step", "Flowstep"),
]);
const FIVE = pack("5.x", [
  card("51", "FIXTURE beacon hides behind the menu", "Beacon"),
  card("52", "FIXTURE checklist resets every week", "Checklist"),
]);
const COMMON = pack("common", [
  card("61", "FIXTURE extension blocked by policy", "Policy"),
]);

describe("createKbIndexSet", () => {
  it("searches one pack exactly as its own index does, each hit labelled with the version", () => {
    const one = createKbIndexSet([FIVE]);
    const alone = createKbIndex(FIVE);
    for (const query of [
      "beacon hides behind the menu",
      "checklist resets",
      "kubernetes",
    ]) {
      const result = one.search(query, { topK: 5 });
      expect({ ...result, mixedVersions: undefined }).toEqual({
        ...alone.search(query, { topK: 5 }),
        mixedVersions: undefined,
      });
      expect(result.hits.every((hit) => hit.aptyVersion === "5.x")).toBe(true);
    }
  });

  it("never returns a 5.x-only card to a 4.x tab, and adds the common cards", () => {
    const tab4 = createKbIndexSet([FOUR, COMMON]);
    const pages = (query: string) =>
      tab4
        .search(query, { topK: 10, onePerCard: true })
        .hits.map((h) => h.chunk.pageId);
    expect(pages("beacon hides behind the menu")).toEqual(["41"]);
    expect(tab4.search("checklist resets every week").status).toBe(
      "not_covered",
    );
    expect(pages("extension blocked by policy")).toEqual(["61"]);
  });

  it("labels both versions when the tab's is unknown and the top two cards differ", () => {
    const unknown = createKbIndexSet([FOUR, FIVE, COMMON]);
    const result = unknown.search("beacon hides behind the menu", {
      onePerCard: true,
      topK: 3,
    });
    expect(
      result.hits.slice(0, 2).map((h) => [h.chunk.pageId, h.aptyVersion]),
    ).toEqual([
      ["41", "4.x"],
      ["51", "5.x"],
    ]);
    expect(result.mixedVersions).toBe(true);
    expect(
      unknown.search("checklist resets every week", { onePerCard: true })
        .mixedVersions,
    ).toBe(false);
    expect(unknown.card("51")?.url).toContain("/pages/51");
    expect(unknown.cardChunks("42").map((c) => c.layer)).toEqual([1, 2, 3, 4]);
    expect(unknown.info.aptyVersions).toEqual(["4.x", "5.x", "common"]);
    expect(unknown.info.cardCount).toBe(5);
  });

  it("answers with another version's stub when it covers the question better than this version's cards", () => {
    const withStub = syntheticPack(
      [
        card("51", "FIXTURE beacon hides behind the menu", "Beacon"),
        {
          pageId: "59",
          title: "FIXTURE bulk export of guides times out",
          symptom: "Exporting many FIXTURE guides at once never finishes.",
          status: "stub",
        },
      ],
      COVERAGE,
      { schemaVersion: 2, aptyVersion: "5.x" } as never,
    );
    const weak = syntheticPack(
      [
        {
          pageId: "43",
          title: "FIXTURE guide list loads in the wrong order",
          layers: [
            "- In Studio, sort the FIXTURE guide list and export it again.",
            "- The FIXTURE list element must be on the page.",
            "- guides.json lists sortOrder (FIXTURE).",
            "- Send support the FIXTURE list id.",
          ],
        },
      ],
      { coverage: { min: 0.1, minIdf: 0, minTerms: 1 } },
      { schemaVersion: 2, aptyVersion: "4.x" } as never,
    );
    expect(
      createKbIndexSet([weak]).search("bulk export of guides never finishes")
        .status,
    ).toBe("ok");
    const set = createKbIndexSet([weak, withStub]);
    const result = set.search("bulk export of guides never finishes", {
      onePerCard: true,
    });
    expect(result.status).toBe("stub");
    expect(result.card?.pageId).toBe("59");
    expect(result.cardVersion).toBe("5.x");
  });

  it("is not covered when no pack covers the question, and empty with no pack", () => {
    expect(
      createKbIndexSet([FOUR, FIVE]).search("kubernetes helm chart"),
    ).toMatchObject({
      status: "not_covered",
      reason: "no_match",
    });
    expect(createKbIndexSet([]).search("beacon")).toMatchObject({
      status: "not_covered",
      reason: "no_match",
      hits: [],
    });
  });

  it("F1: a setting another pack's card holds is not an unknown setting", () => {
    const set = createKbIndexSet([FIVE, COMMON], { tabVersion: "5.x" });
    const result = set.search(
      "the checklist resets after I turn on the FIXTURE Policy Switch",
    );
    expect(result.status).toBe("ok");
    expect(result.hits[0]?.chunk.pageId).toBe("52");
    expect(set.search("turn on the FIXTURE Glow Pulse Switch").reason).toBe(
      "unknown_setting",
    );
  });

  it("F2: another pack's stub sharing one generic word does not beat a covering card", () => {
    const stubOnly = syntheticPack(
      [
        card("53", "FIXTURE checklist resets every week", "Checklist"),
        {
          pageId: "58",
          title: "FIXTURE analytics missing in the dashboard",
          symptom: "FIXTURE analytics never show in the reports.",
          status: "stub",
        },
      ],
      COVERAGE,
      { schemaVersion: 2, aptyVersion: "5.x" } as never,
    );
    const result = createKbIndexSet([FOUR, stubOnly]).search(
      "the beacon hides behind the menu and does not show",
      { onePerCard: true },
    );
    expect(result.status).toBe("ok");
    expect(result.hits[0]?.chunk.pageId).toBe("41");
  });

  it("F9: merges packs by rank, not by raw score, in pack order", () => {
    const filler = Array.from({ length: 30 }, (_, i) =>
      card(String(700 + i), `FIXTURE filler topic ${i} item`, `Filler${i}`),
    );
    const big = pack("5.x", [
      card("71", "FIXTURE gizmo tray rattles loudly", "Gizmo"),
      card("72", "FIXTURE gizmo dial sticks", "Dial"),
      ...filler,
    ]);
    const small = pack("4.x", [
      card("81", "FIXTURE gizmo tray rattles loudly", "Tray"),
    ]);
    const query = "gizmo tray rattles loudly";
    const unknown = createKbIndexSet([big, small]);
    const first = unknown.search(query, { topK: 3, onePerCard: true });
    expect(first.hits.slice(0, 2).map((h) => h.chunk.pageId)).toEqual([
      "81",
      "71",
    ]);
    expect(first.mixedVersions).toBe(true);
    for (let run = 0; run < 3; run++) {
      expect(unknown.search(query, { topK: 3, onePerCard: true })).toEqual(
        first,
      );
    }
    const tab5 = createKbIndexSet([big, small], { tabVersion: "5.x" });
    expect(
      tab5
        .search(query, { topK: 3, onePerCard: true })
        .hits.slice(0, 2)
        .map((h) => h.chunk.pageId),
    ).toEqual(["71", "81"]);
  });

  it("K24-2: reports the context words the top card's own pack left out", () => {
    const query = "FIXTURE beacon hides behind the menu on the ServiceNow form";
    const merged = createKbIndexSet([FOUR, FIVE, COMMON], {
      tabVersion: "4.x",
    }).search(query, { onePerCard: true });
    expect(merged.status).toBe("ok");
    expect(merged.hits[0]?.chunk.pageId).toBe("41");
    expect(merged.contextIgnored).toEqual(["servicenow", "form"]);
    expect(merged.contextIgnored).toEqual(
      createKbIndex(FOUR).search(query).contextIgnored,
    );
  });
});
