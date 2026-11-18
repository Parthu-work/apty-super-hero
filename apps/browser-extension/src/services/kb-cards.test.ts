import { describe, expect, it, vi } from "vitest";
import { loadKbCatalog } from "./kb-cards";

const pack = (aptyVersion: string, sha256: string, cards: string[][]) => ({
  aptyVersion,
  sha256,
  cards: cards.map(([pageId, title, symptom]) => ({
    pageId,
    title,
    symptom: symptom ?? null,
    url: `https://fixture.atlassian.invalid/wiki/spaces/FX/pages/${pageId}`,
  })),
  chunks: cards.map(([pageId]) => ({
    pageId,
    layer: 1,
    text: `FIXTURE layer text for ${pageId}`,
  })),
});

function store(packs: ReturnType<typeof pack>[]) {
  return {
    info: vi.fn(async () =>
      packs.map(({ aptyVersion, sha256 }) => ({ aptyVersion, sha256 })),
    ),
    load: vi.fn(
      async (version: string) =>
        packs.find((p) => p.aptyVersion === version) ?? null,
    ),
  };
}

describe("loadKbCatalog (KB-RAG K27, E7)", () => {
  it("lists every loaded pack's cards with their version and link, and reads a card's text by version", async () => {
    const catalog = await loadKbCatalog(
      store([
        pack("4.x", "a".repeat(64), [["401", "FIXTURE beacon hides"]]),
        pack("5.x", "b".repeat(64), [
          ["501", "FIXTURE tooltip opens twice", "FIXTURE hint pops twice"],
        ]),
      ]) as never,
    );
    expect(catalog.cards).toEqual([
      {
        pageId: "401",
        title: "FIXTURE beacon hides",
        aptyVersion: "4.x",
        url: "https://fixture.atlassian.invalid/wiki/spaces/FX/pages/401",
      },
      {
        pageId: "501",
        title: "FIXTURE tooltip opens twice",
        aptyVersion: "5.x",
        url: "https://fixture.atlassian.invalid/wiki/spaces/FX/pages/501",
      },
    ]);
    expect(catalog.text("501", "5.x")).toBe(
      "FIXTURE tooltip opens twice\nFIXTURE hint pops twice\nFIXTURE layer text for 501",
    );
    expect(catalog.text("501")).toContain("FIXTURE hint pops twice");
    expect(catalog.text("501", "4.x")).toBeUndefined();
    expect(catalog.text("999")).toBeUndefined();
  });

  it("reads the packs again only when a pack changes", async () => {
    const one = pack("5.x", "c".repeat(64), [["501", "FIXTURE one"]]);
    const packs = store([one]);
    await loadKbCatalog(packs as never);
    await loadKbCatalog(packs as never);
    expect(packs.load).toHaveBeenCalledTimes(1);
    one.sha256 = "d".repeat(64);
    one.cards = [
      { ...one.cards[0], title: "FIXTURE two" } as (typeof one.cards)[number],
    ];
    expect((await loadKbCatalog(packs as never)).cards[0]?.title).toBe(
      "FIXTURE two",
    );
  });
});
