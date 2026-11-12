import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  canonicalJson,
  KB_PACK_KIND,
  kbSignedMessage,
  type TrustedPackKey,
} from "@apty/agent-core";
import type { KbRecords } from "../storage/kb-store.js";
import { createKbPackAssessor, type KbPackAssessor } from "./kb-trust.js";

export function memoryRecords(): KbRecords {
  const data = new Map<string, unknown>();
  return {
    get: async (key) => structuredClone(data.get(key)) as never,
    putAll: async (entries) => {
      for (const [key, value] of entries) data.set(key, structuredClone(value));
    },
    moveAll: async (puts, deletes) => {
      for (const [key, value] of puts) data.set(key, structuredClone(value));
      for (const key of deletes) data.delete(key);
    },
  };
}

export interface FixtureCard {
  pageId: string;
  title: string;
  /** Layer 1 to 4 text; FIXTURE content only. A stub or routing card has none. */
  layers?: [string, string, string, string];
  status?: "full" | "stub" | "routing";
  symptom?: string | null;
}

/** A synthetic pack file's text, checksummed like the builder's. */
export function fixturePackText(
  cards: FixtureCard[],
  retrieval: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
  space = "FX",
): string {
  const body = {
    kind: KB_PACK_KIND,
    schemaVersion: 1,
    builtAt: "2026-03-01T00:00:00.000Z",
    builder: "build-kb-pack 1.0.0",
    source: {
      site: "fixture.atlassian.net",
      space: "FX",
      label: "rag-card",
      cardCount: cards.length,
    },
    aptyVersion: "5.x",
    retrieval: { bm25: true, ...retrieval },
    cards: cards.map((card) => ({
      pageId: card.pageId,
      title: card.title,
      group: "FIXTURE group",
      verifiedOn: "Verified on: FIXTURE code, 2026-01-01.",
      notVerifiedCount: (card.layers ?? []).filter((t) =>
        t.includes("NOT VERIFIED"),
      ).length,
      ...(card.status ? { status: card.status } : {}),
      ...(card.symptom !== undefined ? { symptom: card.symptom } : {}),
      url: `https://fixture.atlassian.net/wiki/spaces/${space}/pages/${card.pageId}`,
      updatedAt: "2026-02-01T00:00:00.000Z",
    })),
    chunks: cards.flatMap((card) =>
      (card.layers ?? []).map((text, i) => ({
        id: `${card.pageId}#L${i + 1}`,
        pageId: card.pageId,
        layer: i + 1,
        heading: `Layer ${i + 1}: ${card.title}, part ${i + 1}`,
        text,
        notVerified: text.includes("NOT VERIFIED"),
      })),
    ),
    ...extra,
  };
  const sha256 = createHash("sha256").update(canonicalJson(body)).digest("hex");
  return JSON.stringify({ ...body, sha256 });
}

export const FIXTURE_CARDS: FixtureCard[] = [
  {
    pageId: "101",
    title: "FIXTURE banner never glows",
    layers: [
      "- In Studio, turn on the FIXTURE Glowing Banner setting.",
      "- The FIXTURE banner slot must be on the page.",
      "- NOT VERIFIED: glow.json lists glowIds (FIXTURE).",
      "- Contact support when the banner still does not glow.",
    ],
  },
  {
    pageId: "202",
    title: "FIXTURE tooltip opens twice",
    layers: [
      "- In Studio, clear the FIXTURE Double Trigger setting.",
      "- The FIXTURE anchor element must be unique on the page.",
      "- tooltip.json lists triggerCount (FIXTURE).",
      "- Contact support when it still opens twice.",
    ],
  },
];

/** A card whose text is not written yet (schema 2). */
export const FIXTURE_STUB: FixtureCard = {
  pageId: "303",
  title: "FIXTURE gadget export never finishes",
  symptom: "Exporting FIXTURE gadgets hangs and never completes.",
  status: "stub",
};

/** The fixture cards and the stub as a schema 2 pack, with settings a two-card pack can reach. */
export function fixtureV2PackText(cards = [...FIXTURE_CARDS, FIXTURE_STUB]) {
  return fixturePackText(
    cards,
    { coverage: { min: 0.5, minIdf: 1, minTerms: 1 } },
    { schemaVersion: 2 },
  );
}

/** A schema 2 pack of `version`'s cards in `space`, with settings a small pack can reach. */
export function versionPackText(
  version: "4.x" | "5.x" | "common",
  cards: FixtureCard[],
  space: string,
) {
  return fixturePackText(
    cards,
    { coverage: { min: 0.4, minIdf: 0.5, minTerms: 1 } },
    { schemaVersion: 2, aptyVersion: version },
    space,
  );
}

/**
 * Judges packs as a policy with `allowUnsignedPacks: true` does (the K23
 * transition), for tests about retrieval rather than trust; the trust
 * tests build their own assessor with keys made in the test.
 */
export const unsignedAllowed: KbPackAssessor = createKbPackAssessor({
  policy: async () => ({
    kind: "active",
    policy: { allowUnsignedPacks: true },
  }),
});

/** A P-256 key made in the test, as a trusted key entry and its private half. */
export function testSigningKey(name = "FIXTURE test key") {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const der = publicKey.export({ type: "spki", format: "der" });
  return {
    key: {
      keyId: createHash("sha256").update(der).digest("hex").slice(0, 16),
      spki: der.toString("base64"),
      name,
    } satisfies TrustedPackKey,
    privateKey,
  };
}

/** A schema 3 pack of the fixture cards, valid until `expiresAt`, signed by `signer` (or unsigned). */
export function signedPackText(
  signer: ReturnType<typeof testSigningKey> | null,
  {
    cards = FIXTURE_CARDS,
    expiresAt = "2099-01-01T00:00:00.000Z",
    builtAt = "2026-03-01T00:00:00.000Z",
    site,
  }: {
    cards?: FixtureCard[];
    expiresAt?: string;
    builtAt?: string;
    site?: string;
  } = {},
): string {
  const unsigned = JSON.parse(
    fixturePackText(
      cards,
      { coverage: { min: 0.5, minIdf: 1, minTerms: 1 } },
      { schemaVersion: 3, expiresAt, builtAt },
    ),
  );
  const { sha256: _old, ...body } = unsigned;
  if (site) body.source = { ...body.source, site };
  const sha256 = createHash("sha256").update(canonicalJson(body)).digest("hex");
  if (!signer) return JSON.stringify({ ...body, sha256 });
  const value = sign("sha256", kbSignedMessage(sha256, signer.key.keyId), {
    key: signer.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64");
  return JSON.stringify({
    ...body,
    sha256,
    signature: { alg: "ES256", keyId: signer.key.keyId, value },
  });
}
