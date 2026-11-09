import { createHash } from "node:crypto";
import { canonicalJson, KB_PACK_KIND, type KbPack } from "./pack.js";

export interface SyntheticCard {
  pageId: string;
  title: string;
  /** The four layers' text; FIXTURE content only. */
  layers: [string, string, string, string];
  headings?: [string, string, string, string];
  verifiedOn?: string | null;
}

export const nodeSha256 = async (text: string) =>
  createHash("sha256").update(text).digest("hex");

export const webSha256 = async (text: string) => {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const DEFAULT_HEADINGS = (title: string): [string, string, string, string] => [
  `Layer 1: ${title}, Studio and Admin configuration checks`,
  `Layer 2: ${title}, page and element checks`,
  `Layer 3: ${title}, network data to look at`,
  `Layer 4: ${title}, when to contact support`,
];

/** A synthetic pack, checksummed, with `retrieval` overrides; schema 1 unless `extra` says otherwise; never real card text. */
export function syntheticPack(
  cards: SyntheticCard[],
  retrieval: Partial<KbPack["retrieval"]> = {},
  extra: Partial<KbPack> = {},
): KbPack {
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
      verifiedOn:
        card.verifiedOn === undefined
          ? "Verified on: FIXTURE code, 2026-01-01."
          : card.verifiedOn,
      notVerifiedCount: card.layers.filter((text) =>
        text.includes("NOT VERIFIED"),
      ).length,
      url: `https://fixture.atlassian.net/wiki/spaces/FX/pages/${card.pageId}`,
      updatedAt: "2026-02-01T00:00:00.000Z",
    })),
    chunks: cards.flatMap((card) =>
      card.layers.map((text, i) => ({
        id: `${card.pageId}#L${i + 1}`,
        pageId: card.pageId,
        layer: (i + 1) as 1 | 2 | 3 | 4,
        heading: (card.headings ?? DEFAULT_HEADINGS(card.title))[i] as string,
        text,
        notVerified: text.includes("NOT VERIFIED"),
      })),
    ),
    ...extra,
  } as Omit<KbPack, "sha256">;
  const sha256 = createHash("sha256").update(canonicalJson(body)).digest("hex");
  return { ...body, sha256 } as KbPack;
}

export function encodeVectors(vectors: number[][]): string {
  const flat = new Float32Array(vectors.flat());
  return Buffer.from(flat.buffer).toString("base64");
}
