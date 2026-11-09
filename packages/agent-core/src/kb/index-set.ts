import type { KbAptyVersion, KbCard, KbChunk, KbPack } from "./pack.js";
import {
  compareHits,
  createKbIndex,
  type KbIndex,
  type KbIndexInfo,
  type KbSearchOptions,
  type KbSearchResult,
} from "./search.js";

const ALL_HITS = 20;

/**
 * One search over several packs (KB-RAG K12): a tab's version and the
 * common cards, or every loaded pack when the version is unknown. Each
 * pack is searched with its own index and settings, and the results are
 * merged the same way every time: when the best covered result (by
 * coverage) is a stub, that stub; otherwise the covered packs' hits by
 * score (ties by page id, then layer); else the uncovered result that came
 * closest. Page ids are unique across spaces, so a card
 * is in one pack only. Each hit carries its pack's version, and
 * `mixedVersions` says when the top two come from different versions.
 */
export function createKbIndexSet(packs: readonly KbPack[]): KbIndex {
  const indexes = packs.map(createKbIndex);
  const info: KbIndexInfo = {
    aptyVersions: packs.map((pack) => pack.aptyVersion),
    cardCount: sum(indexes.map((index) => index.info.cardCount)),
    stubCount: sum(indexes.map((index) => index.info.stubCount)),
    chunkCount: sum(indexes.map((index) => index.info.chunkCount)),
    mode: indexes.some((index) => index.info.mode === "hybrid")
      ? "hybrid"
      : "bm25",
    calibrated: indexes.every((index) => index.info.calibrated),
  };
  if (indexes.length === 1) {
    const [only] = indexes as [KbIndex];
    return {
      ...only,
      search: (query, options) => withMixed(only.search(query, options)),
    };
  }

  function search(
    query: string,
    options: KbSearchOptions = {},
  ): KbSearchResult {
    const topK = options.topK ?? 3;
    const results = indexes.map((index) =>
      index.search(query, { ...options, topK: ALL_HITS }),
    );
    const closest = (list: KbSearchResult[]) =>
      [...list].sort(
        (a, b) =>
          b.coverage - a.coverage ||
          Number(b.status === "ok") - Number(a.status === "ok") ||
          (a.card?.pageId ?? "").localeCompare(b.card?.pageId ?? ""),
      )[0];
    const best = closest(results.filter((r) => r.status !== "not_covered"));
    if (best?.status === "stub") return { ...best, mixedVersions: false };
    const covered = results.filter((r) => r.status === "ok");
    if (covered.length > 0) {
      const hits = covered
        .flatMap((r) => r.hits)
        .sort(compareHits)
        .slice(0, Math.max(1, Math.floor(topK)));
      return withMixed({
        status: "ok",
        hits,
        coverage: Math.max(...covered.map((r) => r.coverage)),
      });
    }
    return (
      closest(results) ?? {
        status: "not_covered",
        hits: [],
        coverage: 0,
        reason: "no_match",
      }
    );
  }

  const owner = (pageId: string) =>
    indexes.find((index) => index.card(pageId) !== undefined);

  return {
    info,
    vocabularyIdf: () =>
      indexes.flatMap((index) => index.vocabularyIdf()).sort((a, b) => a - b),
    search,
    cardChunks: (pageId): KbChunk[] => owner(pageId)?.cardChunks(pageId) ?? [],
    card: (pageId): KbCard | undefined => owner(pageId)?.card(pageId),
  };
}

function withMixed(result: KbSearchResult): KbSearchResult {
  const [first, second] = result.hits;
  return {
    ...result,
    mixedVersions:
      first !== undefined &&
      second !== undefined &&
      first.aptyVersion !== second.aptyVersion,
  };
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
