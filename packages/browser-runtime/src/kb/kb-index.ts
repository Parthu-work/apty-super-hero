import {
  createKbIndex,
  type KbIndex,
  type KbLayer,
  type KbNotCoveredReason,
  type KbSearchHit,
} from "@apty/agent-core";
import { createKbPackStore, type KbPackStore } from "../storage/kb-store.js";

/** The search index over the loaded pack, rebuilt only when another pack is loaded. */
export interface KbIndexSource {
  current(): Promise<KbIndex | null>;
}

/** @internal exported for tests, which give it a store of their own. */
export function createKbIndexSource(store: KbPackStore): KbIndexSource {
  let cached: { sha256: string; index: KbIndex } | undefined;
  return {
    async current() {
      const info = await store.info();
      if (!info) {
        cached = undefined;
        return null;
      }
      if (cached?.sha256 === info.sha256) return cached.index;
      const pack = await store.load();
      if (!pack) return null;
      cached = { sha256: pack.sha256, index: createKbIndex(pack) };
      return cached.index;
    },
  };
}

let shared: KbIndexSource | undefined;

/** The index over this browser's pack, shared by the tool, the verdict card and the local router. */
export function sharedKbIndexSource(): KbIndexSource {
  shared ??= createKbIndexSource(createKbPackStore());
  return shared;
}

const KB_RESULT_MAX_TOTAL_CHARS = 4000;

export interface KbToolHit {
  /** What the answer cites: `kb://<pageId>#L<layer>`. */
  cite: string;
  title: string;
  layer: KbLayer;
  heading: string;
  verifiedOn: string | null;
  /** The layer holds a NOT VERIFIED statement: say so where it is used. */
  notVerified: boolean;
  score: number;
  text: string;
}

/** A card that covers the question but whose text for its version is not written yet. */
export interface KbStubHit {
  /** `kb://<pageId>`: the card, with no layer. */
  cite: string;
  title: string;
  url: string;
  aptyVersion: string;
}

export interface KbToolResult {
  /** `non_english`: the local answer only, for a question the English cards cannot match. */
  status: "ok" | "not_covered" | "stub" | "no_pack" | "non_english";
  /** With `stub`: the card; say it exists, that its text is not written yet, and give its link. */
  stub?: KbStubHit;
  /** With `not_covered`: nothing matched, too little of the question matched, or it names a setting the best card lacks. */
  reason?: KbNotCoveredReason;
  /** With `unknown_setting`: the phrases no card has. */
  missingPhrases?: string[];
  results: KbToolHit[];
}

function kbCite(pageId: string, layer: number): string {
  return `kb://${pageId}#L${layer}`;
}

function toolHit(hit: KbSearchHit): KbToolHit {
  return {
    cite: kbCite(hit.chunk.pageId, hit.chunk.layer),
    title: hit.card.title,
    layer: hit.chunk.layer,
    heading: hit.chunk.heading,
    verifiedOn: hit.card.verifiedOn,
    notVerified: hit.chunk.notVerified,
    score: Math.round(hit.score * 1000) / 1000,
    text: hit.chunk.text,
  };
}

/**
 * What `search_kb` returns: the best chunks, each with its citation, its
 * card's "Verified on" line and its NOT VERIFIED mark, whole chunks only and
 * at most 4,000 characters of text in all.
 */
export function kbToolResult(
  index: KbIndex | null,
  query: string,
  options: {
    topK?: number;
    layers?: readonly KbLayer[];
    onePerCard?: boolean;
  } = {},
): KbToolResult {
  if (!index) return { status: "no_pack", results: [] };
  const found = index.search(query, options);
  if (found.status === "stub" && found.card) {
    return {
      status: "stub",
      stub: {
        cite: `kb://${found.card.pageId}`,
        title: found.card.title,
        url: found.card.url,
        aptyVersion: index.info.aptyVersion,
      },
      results: [],
    };
  }
  if (found.status === "not_covered") {
    return {
      status: "not_covered",
      ...(found.reason ? { reason: found.reason } : {}),
      ...(found.missingPhrases ? { missingPhrases: found.missingPhrases } : {}),
      results: [],
    };
  }
  const results: KbToolHit[] = [];
  let total = 0;
  for (const hit of found.hits) {
    if (total + hit.chunk.text.length > KB_RESULT_MAX_TOTAL_CHARS) break;
    total += hit.chunk.text.length;
    results.push(toolHit(hit));
  }
  return { status: "ok", results };
}
