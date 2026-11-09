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
});
