import { describe, expect, it } from "vitest";
import {
  encodeVectors,
  nodeSha256,
  syntheticPack,
  webSha256,
} from "./kb-test-utils.js";
import {
  canonicalJson,
  decodeVectors,
  describeKbPack,
  KB_PACK_LIMITS,
  type KbPack,
  kbCardLocation,
  kbCardUrl,
  parseKbPack,
} from "./pack.js";

const CARD = {
  pageId: "101",
  title: "FIXTURE banner never glows",
  layers: [
    "- In Studio, turn on the FIXTURE Glowing Banner setting.",
    "- The FIXTURE page must show the banner slot.",
    "- NOT VERIFIED: glow.json lists glowIds (FIXTURE).",
    "- Send support: the FIXTURE version.",
  ] as [string, string, string, string],
};

const parse = (value: unknown) =>
  parseKbPack(typeof value === "string" ? value : JSON.stringify(value), {
    sha256: webSha256,
  });

/** The pack as parseKbPack returns it: every card with a status and a symptom. */
const asRead = (pack: KbPack): KbPack => ({
  ...pack,
  cards: pack.cards.map((card) => ({
    ...card,
    status: card.status ?? "full",
    symptom: card.symptom ?? null,
  })),
});

async function reseal(pack: Record<string, unknown>) {
  const { sha256: _old, ...rest } = pack;
  return { ...rest, sha256: await nodeSha256(canonicalJson(rest)) };
}

describe("canonicalJson and the checksum", () => {
  it("matches the builder's pinned vector, with Web Crypto and Node alike", async () => {
    // The same vector is pinned in tooling/scripts/kb/build-kb-pack.test.mjs.
    const text = canonicalJson({
      z: 1,
      a: { y: "é", b: [true] },
      u: undefined,
    });
    expect(text).toBe('{"a":{"b":[true],"y":"é"},"z":1}');
    const expected =
      "07fffc8e05a1ca99dcc9aee6659de41c76190270b19b59e1ea7a0bfd11a5ebe3";
    expect(await webSha256(text)).toBe(expected);
    expect(await nodeSha256(text)).toBe(expected);
  });
});

describe("parseKbPack", () => {
  it("accepts a well-formed pack", async () => {
    const pack = syntheticPack([CARD], { threshold: 1.2 });
    const result = await parse(pack);
    expect(result).toEqual({ ok: true, pack: asRead(pack) });
  });

  it("reads a schema 2 pack with its coverage settings, and refuses settings out of range", async () => {
    const pack = syntheticPack(
      [CARD],
      { coverage: { min: 0.45, minIdf: 2.1, minTerms: 1 } },
      { schemaVersion: 2 },
    );
    expect(await parse(pack)).toEqual({ ok: true, pack: asRead(pack) });
    const wrong = syntheticPack(
      [CARD],
      { coverage: { min: 1.5, minIdf: 2.1, minTerms: 1 } },
      { schemaVersion: 2 },
    );
    expect(await parse(wrong)).toMatchObject({
      code: "invalid",
      detail: expect.stringMatching(/^retrieval\.coverage\.min/),
    });
  });

  it("accepts stub and routing cards without chunks, and refuses chunks on them", async () => {
    const stub = {
      pageId: "102",
      title: "FIXTURE gadgets cannot be exported",
      status: "stub" as const,
    };
    const pack = syntheticPack([CARD, stub], {}, { schemaVersion: 2 });
    expect(await parse(pack)).toEqual({ ok: true, pack: asRead(pack) });
    const withChunks = syntheticPack(
      [CARD, { ...stub, layers: CARD.layers }],
      {},
      { schemaVersion: 2 },
    );
    expect(await parse(withChunks)).toMatchObject({
      code: "invalid",
      detail: "card 102 is a stub and has chunks",
    });
  });

  it("reads a schema 1 pack as a 5.x pack of full cards with no symptom, keeping its checksum and threshold", async () => {
    const v1 = syntheticPack([CARD], { threshold: 2.5 });
    const result = await parse(v1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.aptyVersion).toBe("5.x");
    expect(result.pack.schemaVersion).toBe(1);
    expect(result.pack.retrieval.threshold).toBe(2.5);
    expect(result.pack.sha256).toBe(v1.sha256);
    expect(result.pack.cards[0]).toMatchObject({
      status: "full",
      symptom: null,
    });
  });

  it("reads a 4.x and a common pack, and refuses another version", async () => {
    for (const aptyVersion of ["4.x", "common"]) {
      const pack = syntheticPack([CARD], {}, {
        schemaVersion: 2,
        aptyVersion,
      } as never);
      const result = await parse(pack);
      expect(result.ok && result.pack.aptyVersion).toBe(aptyVersion);
      expect(result.ok && describeKbPack(result.pack, "x").aptyVersion).toBe(
        aptyVersion,
      );
    }
    const other = syntheticPack([CARD], {}, {
      schemaVersion: 2,
      aptyVersion: "6.x",
    } as never);
    expect(await parse(other)).toMatchObject({ code: "invalid" });
  });

  it("names each kind of bad file", async () => {
    const pack = syntheticPack([CARD]);
    expect(await parse("{not json")).toEqual({ ok: false, code: "not_json" });
    expect(await parse("[1]")).toMatchObject({ code: "wrong_kind" });
    expect(await parse({ ...pack, kind: "other" })).toMatchObject({
      code: "wrong_kind",
    });
    expect(await parse({ ...pack, schemaVersion: 3 })).toMatchObject({
      code: "wrong_schema_version",
    });
    const tampered = structuredClone(pack);
    (tampered.chunks[0] as { text: string }).text = "FIXTURE edited";
    expect(await parse(tampered)).toEqual({
      ok: false,
      code: "checksum_mismatch",
    });
  });

  it("refuses a pack over the size or chunk limit before trusting it", async () => {
    const huge = `{"pad":"${"x".repeat(KB_PACK_LIMITS.maxBytes)}"}`;
    expect(await parse(huge)).toEqual({ ok: false, code: "too_large" });
    const many = syntheticPack(
      Array.from({ length: 1251 }, (_, i) => ({
        ...CARD,
        pageId: String(i + 1),
      })),
    );
    expect(many.chunks.length).toBeGreaterThan(KB_PACK_LIMITS.maxChunks);
    expect(await parse(many)).toEqual({ ok: false, code: "too_large" });
  });

  it("refuses a pack whose shape or references do not hold, with the reason", async () => {
    const pack = syntheticPack([CARD]);
    const longText = structuredClone(pack) as KbPack;
    (longText.chunks[1] as { text: string }).text = "x".repeat(1001);
    expect(await parse(await reseal(longText as never))).toMatchObject({
      code: "invalid",
      detail: expect.stringMatching(/^chunks\.1\.text/),
    });

    const orphan = structuredClone(pack) as KbPack;
    (orphan.chunks[0] as { pageId: string; id: string }).pageId = "999";
    (orphan.chunks[0] as { id: string }).id = "999#L1";
    expect(await parse(await reseal(orphan as never))).toEqual({
      ok: false,
      code: "invalid",
      detail: "chunk 999#L1 names no card",
    });

    const misnamed = structuredClone(pack) as KbPack;
    (misnamed.chunks[0] as { id: string }).id = "101#L3";
    expect(await parse(await reseal(misnamed as never))).toMatchObject({
      detail: "chunk 101#L3 does not match its page and layer",
    });

    const badUrl = structuredClone(pack) as KbPack;
    (badUrl.cards[0] as { url: string }).url = "javascript:alert(1)";
    expect(await parse(await reseal(badUrl as never))).toMatchObject({
      code: "invalid",
      detail: expect.stringMatching(/^cards\.0\.url/),
    });

    const count = structuredClone(pack) as KbPack;
    count.source.cardCount = 5;
    expect(await parse(await reseal(count as never))).toMatchObject({
      detail: "source.cardCount does not match the cards",
    });
  });

  it("checks that the vectors match the chunks and dims, and decodes them in chunk order", async () => {
    const vectors = [
      [1, 0],
      [0, 1],
      [0.5, 0.5],
      [0, 0],
    ];
    const pack = syntheticPack(
      [CARD],
      { dense: { model: "FIXTURE-model", dims: 2 } },
      { vectors: encodeVectors(vectors) },
    );
    const result = await parse(pack);
    expect(result.ok).toBe(true);
    expect(decodeVectors(pack).map((v) => [...v])).toEqual(vectors);

    const short = syntheticPack(
      [CARD],
      { dense: { model: "FIXTURE-model", dims: 2 } },
      { vectors: encodeVectors(vectors.slice(0, 3)) },
    );
    expect(await parse(short)).toMatchObject({
      detail: "vectors do not match the chunks and dims",
    });
    const missing = syntheticPack([CARD], {
      dense: { model: "FIXTURE-model", dims: 2 },
    });
    expect(await parse(missing)).toMatchObject({
      detail: "dense retrieval without vectors",
    });
  });
});

describe("kbCardUrl", () => {
  it("links to the card's own page, and without one to its version's space", () => {
    expect(
      kbCardUrl("1509786000", {
        url: "https://apty.atlassian.net/wiki/spaces/A4PKH/pages/1509786000",
      }),
    ).toBe("https://apty.atlassian.net/wiki/spaces/A4PKH/pages/1509786000");
    expect(kbCardUrl("1509786000", { aptyVersion: "4.x" })).toBe(
      "https://apty.atlassian.net/wiki/spaces/A4PKH/pages/1509786000",
    );
    expect(kbCardUrl("1496645690")).toBe(
      "https://apty.atlassian.net/wiki/spaces/JA/pages/1496645690",
    );
    expect(
      kbCardUrl("7", { site: "fixture.atlassian.net", space: "A4X" }),
    ).toBe("https://fixture.atlassian.net/wiki/spaces/A4X/pages/7");
    expect(
      kbCardUrl("7", {
        site: "evil.example/x?",
        space: "A4X",
        aptyVersion: "4.x",
      }),
    ).toBe("https://apty.atlassian.net/wiki/spaces/A4PKH/pages/7");
    expect(
      kbCardLocation({
        url: "https://fixture.atlassian.net/wiki/spaces/A4X/pages/7",
      }),
    ).toEqual({ site: "fixture.atlassian.net", space: "A4X" });
  });
});
