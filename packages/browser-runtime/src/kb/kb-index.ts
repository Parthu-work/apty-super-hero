import {
  createKbIndex,
  type KbIndex,
  type KbLayer,
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

export interface KbToolResult {
  status: "ok" | "not_covered" | "no_pack";
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
  if (found.status === "not_covered") {
    return { status: "not_covered", results: [] };
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
