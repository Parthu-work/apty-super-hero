import {
  KB_APTY_VERSIONS,
  type KbAptyVersion,
  type KbCard,
  type KbChunk,
  type KbPack,
} from "./pack.js";
import {
  createKbIndex,
  type KbIndex,
  type KbIndexInfo,
  type KbSearchOptions,
  type KbSearchResult,
} from "./search.js";

const ALL_HITS = 20;

/**
 * The order packs take turns in a merged result: the tab's version, then
 * the common cards, then any other version (4.x before 5.x).
 */
function packOrder(
  version: KbAptyVersion,
  tabVersion: KbAptyVersion | "unknown",
): number {
  if (version === tabVersion) return 0;
  if (version === "common") return 1;
  return 2 + KB_APTY_VERSIONS.indexOf(version);
}

/**
 * One search over several packs (KB-RAG K12): a tab's version and the
 * common cards, or every loaded pack when the version is unknown. Each
 * pack is searched with its own index and settings, and the results are
 * merged the same way every time: when the best covered result (by
 * coverage) is a stub, that stub; otherwise the covered packs' hits by
 * rank (K21 F9): BM25 scores from separate indexes are not comparable, so
 * each pack's hits keep their own order and the packs take turns, in
 * `packOrder`; else the uncovered result that came closest. Page ids are
 * unique across spaces, so a card is in one pack only. Each hit carries its
 * pack's version, and `mixedVersions` says when the top two come from
 * different versions.
 */
export function createKbIndexSet(
  packs: readonly KbPack[],
  { tabVersion = "unknown" }: { tabVersion?: KbAptyVersion | "unknown" } = {},
): KbIndex {
  const ordered = [...packs].sort(
    (a, b) =>
      packOrder(a.aptyVersion, tabVersion) -
      packOrder(b.aptyVersion, tabVersion),
  );
  const indexes = ordered.map(createKbIndex);
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

  const holdsPhrase = (phrase: string) =>
    indexes.some((index) => index.holdsPhrase(phrase));

  function search(
    query: string,
    options: KbSearchOptions = {},
  ): KbSearchResult {
    const topK = options.topK ?? 3;
    const results = indexes.map((index) =>
      index.search(query, { holdsPhrase, ...options, topK: ALL_HITS }),
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
      const hits = roundRobin(covered.map((r) => r.hits)).slice(
        0,
        Math.max(1, Math.floor(topK)),
      );
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
    holdsPhrase,
    search,
    cardChunks: (pageId): KbChunk[] => owner(pageId)?.cardChunks(pageId) ?? [],
    card: (pageId): KbCard | undefined => owner(pageId)?.card(pageId),
  };
}

/** Each list's first item, then each list's second, and so on: lists in the order given. */
function roundRobin<T>(lists: readonly (readonly T[])[]): T[] {
  const merged: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let rank = 0; rank < longest; rank++) {
    for (const list of lists) {
      const item = list[rank];
      if (item !== undefined) merged.push(item);
    }
  }
  return merged;
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
