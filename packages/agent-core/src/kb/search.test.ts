import { describe, expect, it } from "vitest";
import {
  encodeVectors,
  type SyntheticCard,
  syntheticPack,
} from "./kb-test-utils.js";
import { createKbIndex } from "./search.js";

function card(
  pageId: string,
  title: string,
  layers: [string, string, string, string],
): SyntheticCard {
  return { pageId, title, layers };
}

const SEND = "- Send support: the FIXTURE version and a screenshot.";
const CARDS = [
  card("101", "FIXTURE banner never glows", [
    "- In Studio, turn on the FIXTURE Glowing Banner setting.",
    "- The FIXTURE banner slot must be on the page.",
    "- NOT VERIFIED: glow.json lists glowIds (FIXTURE).",
    `- Contact support when the banner still does not glow.\n${SEND}`,
  ]),
  card("202", "FIXTURE tooltip opens twice", [
    "- In Studio, clear the FIXTURE Double Trigger setting.",
    "- The FIXTURE anchor element must be unique on the page.",
    "- tooltip.json lists triggerCount (FIXTURE).",
    `- Contact support when it still opens twice.\n${SEND}`,
  ]),
  card("303", "FIXTURE survey is blank", [
    "- In Admin, set the FIXTURE Survey Locale for the user's language.",
    "- The FIXTURE survey frame must load.",
    "- survey.json lists questions per locale (FIXTURE).",
    `- Contact support when the survey stays blank.\n${SEND}`,
  ]),
];

const ids = (result: ReturnType<ReturnType<typeof createKbIndex>["search"]>) =>
  result.hits.map((hit) => hit.chunk.id);

describe("createKbIndex search", () => {
  const index = createKbIndex(syntheticPack(CARDS));

  it("ranks the card whose title matches first, and the layer that holds the words", () => {
    const result = index.search("banner does not glow");
    expect(result.status).toBe("ok");
    expect(result.hits[0]?.chunk.pageId).toBe("101");
    expect(index.search("Double Trigger setting").hits[0]?.chunk.id).toBe(
      "202#L1",
    );
    expect(index.search("triggerCount").hits[0]?.chunk.id).toBe("202#L3");
  });

  it("matches a prefix and a small typo", () => {
    expect(index.search("tooltp opens").hits[0]?.chunk.pageId).toBe("202");
    expect(index.search("surv").hits[0]?.chunk.pageId).toBe("303");
  });

  it("gives the same ranking every time, for the same pack and query", () => {
    const again = createKbIndex(syntheticPack(CARDS));
    for (const query of ["FIXTURE setting", "page", "contact"]) {
      expect(again.search(query, { topK: 10 })).toEqual(
        index.search(query, { topK: 10 }),
      );
    }
  });

  it("breaks ties by page id, then layer", () => {
    const same = "- FIXTURE identical words here.";
    const twins = createKbIndex(
      syntheticPack([
        card("20", "FIXTURE twin", [same, same, "- other one", "- other two"]),
        card("3", "FIXTURE twin", [same, same, "- other one", "- other two"]),
      ]),
    );
    expect(ids(twins.search("identical words", { topK: 4 }))).toEqual([
      "3#L1",
      "3#L2",
      "20#L1",
      "20#L2",
    ]);
  });

  it("keeps only the layers asked for", () => {
    const result = index.search("FIXTURE setting", { layers: [3], topK: 5 });
    expect(result.hits.every((hit) => hit.chunk.layer === 3)).toBe(true);
    expect(index.search("Double Trigger", { layers: [2] }).status).toBe(
      "not_covered",
    );
  });

  it("does not match on boilerplate every card shares", () => {
    expect(index.search("screenshot").status).toBe("not_covered");
    expect(index.search("verified").status).toBe("not_covered");
    expect(index.search("network data to look at").status).toBe("not_covered");
  });

  it("caps topK, and keeps one chunk per card when asked", () => {
    expect(index.search("FIXTURE", { topK: 2 }).hits).toHaveLength(2);
    expect(index.search("FIXTURE", { topK: 0 }).hits).toHaveLength(1);
    const cards = index.search("FIXTURE", { topK: 10, onePerCard: true });
    expect(cards.hits.map((hit) => hit.chunk.pageId)).toEqual([
      ...new Set(cards.hits.map((hit) => hit.chunk.pageId)),
    ]);
    expect(cards.hits).toHaveLength(3);
  });

  it("is not covered when nothing matches, or the top score is below the pack's threshold", () => {
    expect(index.search("kubernetes helm chart")).toEqual({
      status: "not_covered",
      hits: [],
    });
    const top = index.search("banner does not glow").hits[0]?.score ?? 0;
    const strict = createKbIndex(syntheticPack(CARDS, { threshold: top + 1 }));
    expect(strict.info.calibrated).toBe(true);
    expect(strict.search("banner does not glow").status).toBe("not_covered");
    const lenient = createKbIndex(syntheticPack(CARDS, { threshold: top }));
    const kept = lenient.search("banner does not glow", { topK: 10 });
    expect(kept.status).toBe("ok");
    expect(kept.hits.every((hit) => hit.score >= top)).toBe(true);
  });

  it("indexes each (page, layer) once and reads a card's chunks by layer", () => {
    const pack = syntheticPack(CARDS.slice(0, 1));
    const duplicated = {
      ...pack,
      chunks: [...pack.chunks, { ...pack.chunks[0], text: "- FIXTURE copy" }],
    } as typeof pack;
    const once = createKbIndex(duplicated);
    expect(once.info).toEqual({
      cardCount: 1,
      chunkCount: 4,
      mode: "bm25",
      calibrated: false,
    });
    expect(once.search("copy").status).toBe("not_covered");
    expect(once.cardChunks("101").map((chunk) => chunk.layer)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(once.cardChunks("999")).toEqual([]);
    expect(once.card("101")?.title).toBe("FIXTURE banner never glows");
  });
});

describe("hybrid ranking", () => {
  // 202#L1 points the same way as the query; 303#L1 nearly; the rest away.
  const vectors = CARDS.flatMap((c) =>
    [1, 2, 3, 4].map((layer) =>
      layer !== 1
        ? [0, 1]
        : c.pageId === "202"
          ? [1, 0]
          : c.pageId === "303"
            ? [0.95, 0.312]
            : [0, 1],
    ),
  );
  const pack = syntheticPack(
    CARDS,
    { dense: { model: "FIXTURE-model", dims: 2, threshold: 0.9 } },
    { vectors: encodeVectors(vectors) },
  );
  const index = createKbIndex(pack);
  const queryVector = new Float32Array([1, 0]);

  it("covers a query only the dense ranking matches", () => {
    expect(index.info.mode).toBe("hybrid");
    expect(index.search("kubernetes").status).toBe("not_covered");
    const dense = index.search("kubernetes", { queryVector, topK: 5 });
    expect(ids(dense)).toEqual(["202#L1", "303#L1"]);
  });

  it("fuses the keyword and dense rankings by reciprocal rank", () => {
    const keywordOnly = index.search("survey blank", { topK: 5 });
    expect(keywordOnly.hits.every((hit) => hit.chunk.pageId === "303")).toBe(
      true,
    );
    const fused = index.search("survey blank", { queryVector, topK: 2 });
    expect(ids(fused)).toEqual(["303#L1", "202#L1"]);
    expect(fused.hits[1]?.score).toBeCloseTo(1 / 61);
  });
});
