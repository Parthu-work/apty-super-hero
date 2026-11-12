import {
  createKbIndexSet,
  type KbAptyVersion,
  type KbIndex,
  type KbLayer,
  type KbNotCoveredReason,
  type KbPack,
  type KbSearchHit,
  type KbSearchResult,
  type KbSourceTag,
  kbCardLocation,
  kbSourceTag,
} from "@apty/agent-core";
import { createKbPackStore, type KbPackStore } from "../storage/kb-store.js";

/** The Apty version a tab runs, as far as the Agent knows. */
export type KbTabVersion = "4.x" | "5.x" | "unknown";

/** The search index over the loaded packs a tab's version reads, rebuilt only when those packs change. */
export interface KbIndexSource {
  /** The tab's version and the common cards, or every loaded pack for `unknown` (the default). */
  current(version?: KbTabVersion): Promise<KbIndex | null>;
}

/** @internal exported for tests, which give it a store of their own. */
export function createKbIndexSource(store: KbPackStore): KbIndexSource {
  const cached = new Map<KbTabVersion, { key: string; index: KbIndex }>();
  return {
    async current(version = "unknown") {
      const infos = (await store.info()).filter(
        (info) =>
          version === "unknown" ||
          info.aptyVersion === version ||
          info.aptyVersion === "common",
      );
      if (infos.length === 0) {
        cached.delete(version);
        return null;
      }
      const key = infos.map((info) => info.sha256).join(",");
      const hit = cached.get(version);
      if (hit?.key === key) return hit.index;
      const packs = (
        await Promise.all(infos.map((info) => store.load(info.aptyVersion)))
      ).filter((pack): pack is KbPack => pack !== null);
      if (packs.length === 0) return null;
      const index = createKbIndexSet(packs, { tabVersion: version });
      cached.set(version, { key, index });
      return index;
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
  /** The card's Confluence site and space (its link is built from them, `kbCardUrl`), in its version's space. */
  site: string;
  space: string;
  aptyVersion: KbAptyVersion;
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
  site: string;
  space: string;
  aptyVersion: string;
}

/**
 * Every result carries the KB source tag (KB-RAG K22, hard rule 3): the
 * outbound filter and the MCP bridge withhold the text of a tagged result
 * unless the policy lets it go.
 */
export interface KbToolResult extends KbSourceTag {
  /** `non_english`: the local answer only, for a question the English cards cannot match. */
  status: "ok" | "not_covered" | "stub" | "no_pack" | "non_english";
  /** With `stub`: the card; say it exists, that its text is not written yet, and give its link. */
  stub?: KbStubHit;
  /** With `not_covered`: nothing matched, too little of the question matched, or it names a setting the best card lacks. */
  reason?: KbNotCoveredReason;
  /** With `unknown_setting`: the phrases no card has. */
  missingPhrases?: string[];
  /** The top two cards are for different Apty versions: ask which one the tenant runs. */
  mixedVersions?: boolean;
  results: KbToolHit[];
}

function kbCite(pageId: string, layer: number): string {
  return `kb://${pageId}#L${layer}`;
}

function toolHit(hit: KbSearchHit): KbToolHit {
  return {
    cite: kbCite(hit.chunk.pageId, hit.chunk.layer),
    title: hit.card.title,
    ...kbCardLocation(hit.card),
    aptyVersion: hit.aptyVersion,
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
  if (!index) return { status: "no_pack", ...kbSourceTag([]), results: [] };
  return kbToolResultOf(index.search(query, options));
}

/** A search's result as `search_kb` returns it. */
export function kbToolResultOf(found: KbSearchResult): KbToolResult {
  if (found.status === "stub" && found.card) {
    return {
      status: "stub",
      ...kbSourceTag([{ pageId: found.card.pageId }]),
      stub: {
        cite: `kb://${found.card.pageId}`,
        title: found.card.title,
        ...kbCardLocation(found.card),
        aptyVersion: found.cardVersion ?? "5.x",
      },
      mixedVersions: false,
      results: [],
    };
  }
  if (found.status === "not_covered") {
    return {
      status: "not_covered",
      ...kbSourceTag([]),
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
  return {
    status: "ok",
    ...kbSourceTag(
      found.hits
        .slice(0, results.length)
        .map((hit) => ({ pageId: hit.chunk.pageId, layer: hit.chunk.layer })),
    ),
    mixedVersions: found.mixedVersions ?? false,
    results,
  };
}
