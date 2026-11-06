import MiniSearch from "minisearch";
import {
  decodeVectors,
  type KbCard,
  type KbChunk,
  type KbLayer,
  type KbPack,
} from "./pack.js";

export interface KbSearchOptions {
  /** How many results; 1 to 20, default 3. */
  topK?: number;
  /** Only these layers. */
  layers?: readonly KbLayer[];
  /** Keep only each card's best chunk. */
  onePerCard?: boolean;
  /** The query embedded with the pack's dense model, for hybrid ranking. */
  queryVector?: Float32Array;
}

export interface KbSearchHit {
  chunk: KbChunk;
  card: KbCard;
  score: number;
}

export interface KbSearchResult {
  /** `not_covered`: nothing matched, or nothing reached the pack's calibrated threshold. */
  status: "ok" | "not_covered";
  hits: KbSearchHit[];
}

export interface KbIndexInfo {
  cardCount: number;
  chunkCount: number;
  mode: "bm25" | "hybrid";
  /** Whether the pack carries a calibrated threshold; without one, any match counts as covered. */
  calibrated: boolean;
}

export interface KbIndex {
  info: KbIndexInfo;
  search(query: string, options?: KbSearchOptions): KbSearchResult;
  /** A card's own chunks, by layer: for a finding that already names its card. */
  cardChunks(pageId: string): KbChunk[];
  card(pageId: string): KbCard | undefined;
}

const RRF_K = 60;
const MAX_TOP_K = 20;
const LAYER_PREFIX = /^Layer\s+\d+\s*:\s*/i;
const BOILERPLATE_LINE = /^(?:-\s*)?(?:Verified on|Send support)\s*:/i;
const NOT_VERIFIED_MARK = /\bNOT VERIFIED\b:?/g;
const STOP_WORDS = new Set(
  "a an and are as at be by do does for from how i in is it its me my of on or our so that the this to was we what when where which why will with you your".split(
    " ",
  ),
);

function processTerm(term: string): string | null {
  const lower = term.toLowerCase();
  return lower.length < 2 || STOP_WORDS.has(lower) ? null : lower;
}

function comparePageIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

function compareHits(a: KbSearchHit, b: KbSearchHit): number {
  return (
    b.score - a.score ||
    comparePageIds(a.chunk.pageId, b.chunk.pageId) ||
    a.chunk.layer - b.chunk.layer
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * What a heading adds beyond the boilerplate: the "Layer N:" prefix, the
 * card's own title (indexed on its own) and a layer description shared by
 * most cards are dropped.
 */
function headingTerms(
  chunk: KbChunk,
  card: KbCard,
  sharedDescriptions: Set<string>,
): string {
  const rest = chunk.heading
    .replace(LAYER_PREFIX, "")
    .replace(new RegExp(escapeRegExp(card.title), "i"), "")
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "");
  return sharedDescriptions.has(`${chunk.layer}:${rest.toLowerCase()}`)
    ? ""
    : rest;
}

/** A layer description in more than half of the cards appears in every card, in effect. */
function sharedLayerDescriptions(
  chunks: KbChunk[],
  cards: Map<string, KbCard>,
): Set<string> {
  const counts = new Map<string, number>();
  for (const chunk of chunks) {
    const card = cards.get(chunk.pageId);
    if (!card) continue;
    const rest = chunk.heading
      .replace(LAYER_PREFIX, "")
      .replace(new RegExp(escapeRegExp(card.title), "i"), "")
      .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "")
      .toLowerCase();
    const key = `${chunk.layer}:${rest}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const shared = new Set<string>();
  if (cards.size < 2) return shared;
  for (const [key, count] of counts) {
    if (count > cards.size / 2) shared.add(key);
  }
  return shared;
}

function bodyTerms(text: string): string {
  return text
    .split("\n")
    .filter((line) => !BOILERPLATE_LINE.test(line))
    .join("\n")
    .replace(NOT_VERIFIED_MARK, " ");
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/**
 * A search index over a parsed pack. Keyword search is BM25 (MiniSearch)
 * over the card title (boost 3), the heading (1.5) and the text, with prefix
 * and light fuzzy matching; with the pack's vectors and a query vector, the
 * keyword and dense rankings are fused (reciprocal rank fusion, k = 60).
 * The same pack and query always give the same ranking: ties go to the
 * lower page id, then the lower layer. Chunks are unique by page and layer.
 */
export function createKbIndex(pack: KbPack): KbIndex {
  const cards = new Map(pack.cards.map((card) => [card.pageId, card]));
  const seen = new Set<string>();
  const chunks: KbChunk[] = [];
  const vectorsByChunk = new Map<string, Float32Array>();
  const vectors = decodeVectors(pack);
  pack.chunks.forEach((chunk, i) => {
    if (seen.has(chunk.id) || !cards.has(chunk.pageId)) return;
    seen.add(chunk.id);
    chunks.push(chunk);
    const vector = vectors[i];
    if (vector) vectorsByChunk.set(chunk.id, vector);
  });
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const shared = sharedLayerDescriptions(chunks, cards);

  const mini = new MiniSearch<{
    id: string;
    title: string;
    heading: string;
    text: string;
  }>({
    fields: ["title", "heading", "text"],
    processTerm,
    searchOptions: {
      boost: { title: 3, heading: 1.5 },
      prefix: (term) => term.length >= 3,
      fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
      processTerm,
    },
  });
  mini.addAll(
    chunks.map((chunk) => {
      const card = cards.get(chunk.pageId) as KbCard;
      return {
        id: chunk.id,
        title: card.title,
        heading: headingTerms(chunk, card, shared),
        text: bodyTerms(chunk.text),
      };
    }),
  );

  const dense = pack.retrieval.dense;
  const hybrid = dense !== undefined && vectorsByChunk.size === chunks.length;
  const info: KbIndexInfo = {
    cardCount: cards.size,
    chunkCount: chunks.length,
    mode: hybrid ? "hybrid" : "bm25",
    calibrated: pack.retrieval.threshold !== undefined,
  };

  function hit(chunk: KbChunk, score: number): KbSearchHit {
    return { chunk, card: cards.get(chunk.pageId) as KbCard, score };
  }

  function search(
    query: string,
    options: KbSearchOptions = {},
  ): KbSearchResult {
    const topK = Math.min(
      MAX_TOP_K,
      Math.max(1, Math.floor(options.topK ?? 3)),
    );
    const allowed = options.layers ? new Set(options.layers) : undefined;
    const inLayers = (chunk: KbChunk) => !allowed || allowed.has(chunk.layer);

    const keyword = mini
      .search(query)
      .map((result) => {
        const chunk = byId.get(String(result.id));
        return chunk && inLayers(chunk) ? hit(chunk, result.score) : undefined;
      })
      .filter((h): h is KbSearchHit => h !== undefined)
      .sort(compareHits);
    const threshold = pack.retrieval.threshold;
    let covered =
      keyword.length > 0 &&
      (threshold === undefined || (keyword[0]?.score ?? 0) >= threshold);

    let ranked = covered
      ? keyword.filter((h) => threshold === undefined || h.score >= threshold)
      : [];

    if (hybrid && options.queryVector) {
      const queryVector = options.queryVector;
      const semantic = chunks
        .filter(inLayers)
        .map((chunk) =>
          hit(
            chunk,
            cosine(queryVector, vectorsByChunk.get(chunk.id) as Float32Array),
          ),
        )
        .sort(compareHits);
      const denseThreshold = dense?.threshold;
      const denseCovered =
        semantic.length > 0 &&
        denseThreshold !== undefined &&
        (semantic[0]?.score ?? -1) >= denseThreshold;
      covered = covered || denseCovered;
      const denseRanked = denseCovered
        ? semantic.filter((h) => h.score >= (denseThreshold as number))
        : [];
      const fused = new Map<string, number>();
      for (const list of [ranked, denseRanked]) {
        list.forEach((h, rank) => {
          fused.set(
            h.chunk.id,
            (fused.get(h.chunk.id) ?? 0) + 1 / (RRF_K + rank + 1),
          );
        });
      }
      ranked = [...fused]
        .map(([id, score]) => hit(byId.get(id) as KbChunk, score))
        .sort(compareHits);
    }

    if (!covered || ranked.length === 0) {
      return { status: "not_covered", hits: [] };
    }
    if (options.onePerCard) {
      const best = new Set<string>();
      ranked = ranked.filter((h) => {
        if (best.has(h.chunk.pageId)) return false;
        best.add(h.chunk.pageId);
        return true;
      });
    }
    return { status: "ok", hits: ranked.slice(0, topK) };
  }

  return {
    info,
    search,
    cardChunks: (pageId) =>
      chunks
        .filter((chunk) => chunk.pageId === pageId)
        .sort((a, b) => a.layer - b.layer),
    card: (pageId) => cards.get(pageId),
  };
}
