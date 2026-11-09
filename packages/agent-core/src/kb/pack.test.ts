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
  KB_PACK_LIMITS,
  type KbPack,
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
    expect(result).toEqual({ ok: true, pack });
  });

  it("reads a schema 2 pack with its coverage settings, and refuses settings out of range", async () => {
    const pack = syntheticPack(
      [CARD],
      { coverage: { min: 0.45, minIdf: 2.1, minTerms: 1 } },
      { schemaVersion: 2 },
    );
    expect(await parse(pack)).toEqual({ ok: true, pack });
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
