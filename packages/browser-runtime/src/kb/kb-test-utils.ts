import { createHash } from "node:crypto";
import { canonicalJson, KB_PACK_KIND } from "@apty/agent-core";
import type { KbRecords } from "../storage/kb-store.js";

export function memoryRecords(): KbRecords {
  const data = new Map<string, unknown>();
  return {
    get: async (key) => structuredClone(data.get(key)) as never,
    put: async (key, value) => {
      data.set(key, structuredClone(value));
    },
    delete: async (key) => {
      data.delete(key);
    },
  };
}

export interface FixtureCard {
  pageId: string;
  title: string;
  /** Layer 1 to 4 text; FIXTURE content only. */
  layers: [string, string, string, string];
}

/** A synthetic pack file's text, checksummed like the builder's. */
export function fixturePackText(
  cards: FixtureCard[],
  retrieval: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
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
      notVerifiedCount: card.layers.filter((t) => t.includes("NOT VERIFIED"))
        .length,
      url: `https://fixture.atlassian.net/wiki/spaces/FX/pages/${card.pageId}`,
      updatedAt: "2026-02-01T00:00:00.000Z",
    })),
    chunks: cards.flatMap((card) =>
      card.layers.map((text, i) => ({
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
