import MiniSearch from "minisearch";
import {
  decodeVectors,
  type KbAptyVersion,
  type KbCard,
  type KbChunk,
  type KbLayer,
  type KbPack,
} from "./pack.js";
import { stem } from "./stem.js";
import { KB_SYNONYM_GROUPS, SYNONYM_MATCH } from "./synonyms.js";
import {
  analyze,
  createPhraseLookup,
  createSynonymTable,
  editDistance,
  hasPhrase,
  namedPhrases,
  normalize,
  queryTerms,
  type SynonymTable,
  type TypedWord,
  typedWords,
} from "./text.js";

export interface KbSearchOptions {
  /** How many results; 1 to 20, default 3. */
  topK?: number;
  /** Only these layers. */
  layers?: readonly KbLayer[];
  /** Keep only each card's best chunk. */
  onePerCard?: boolean;
  /** The query embedded with the pack's dense model, for hybrid ranking. */
  queryVector?: Float32Array;
  /**
   * Whether any card being searched holds a phrase; an index set passes
   * one over all its packs, so a setting another pack's card names is known.
   */
  holdsPhrase?: (phrase: string) => boolean;
}

export interface KbSearchHit {
  chunk: KbChunk;
  card: KbCard;
  score: number;
  /** The version of the pack the card comes from. */
  aptyVersion: KbAptyVersion;
}

export type KbNotCoveredReason =
  | "no_match"
  | "low_coverage"
  | "unknown_setting";

export interface KbSearchResult {
  /**
   * `not_covered`: nothing matched, the top card covers too little of the
   * question, or it names a setting the card does not have. `stub`: the
   * card that covers it is not written yet for this version (`card`).
   */
  status: "ok" | "not_covered" | "stub";
  hits: KbSearchHit[];
  /** With `stub`: the card, with no text, and its pack's version. */
  card?: KbCard;
  cardVersion?: KbAptyVersion;
  /** Searching several versions' packs: the top two hits are for different versions. */
  mixedVersions?: boolean;
  /**
   * The share of the question's weight the top card matches, 0 to 1: each
   * term weighs its idf, and counts in full when the card has it, half when
   * only a typo or a prefix of it matches.
   */
  coverage: number;
  reason?: KbNotCoveredReason;
  /** With `unknown_setting`: the setting-like phrases the question names that no card searched holds. */
  missingPhrases?: string[];
}

/** When the top card covers a question (schema 2); calibrated per pack by `eval-kb.mjs`. */
export interface KbCoverageSettings {
  /** The lowest coverage that counts as covered. */
  min: number;
  /** A matched term counts toward `minTerms` only with an idf at least this. */
  minIdf: number;
  /** How many matched terms need `minIdf`. */
  minTerms: number;
}

export const KB_COVERAGE_DEFAULTS: KbCoverageSettings = {
  min: 0.5,
  minIdf: 1.5,
  minTerms: 1,
};

export interface KbIndexInfo {
  /** The Apty versions the cards are for. */
  aptyVersions: KbAptyVersion[];
  cardCount: number;
  /** Cards not written yet for this version (schema 2). */
  stubCount: number;
  chunkCount: number;
  mode: "bm25" | "hybrid";
  /** Whether the pack carries a calibrated threshold; without one, any match counts as covered. */
  calibrated: boolean;
}

export interface KbIndex {
  info: KbIndexInfo;
  /** Each indexed term's idf, `ln(1 + N / (1 + df))`, sorted: what calibration picks `minIdf` from. */
  vocabularyIdf(): number[];
  search(query: string, options?: KbSearchOptions): KbSearchResult;
  /** Whether any card's title, symptom or text holds the phrase's terms in a row. */
  holdsPhrase(phrase: string): boolean;
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

const SEPARATOR = /[\s,;:–—-]/;

/** The text without separators at either end; linear, as a heading comes from an imported pack. */
function trimSeparators(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && SEPARATOR.test(text.charAt(start))) start++;
  while (end > start && SEPARATOR.test(text.charAt(end - 1))) end--;
  return text.slice(start, end);
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
    .replace(new RegExp(escapeRegExp(card.title), "i"), "");
  const trimmed = trimSeparators(rest);
  return sharedDescriptions.has(`${chunk.layer}:${trimmed.toLowerCase()}`)
    ? ""
    : trimmed;
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
    const rest = trimSeparators(
      chunk.heading
        .replace(LAYER_PREFIX, "")
        .replace(new RegExp(escapeRegExp(card.title), "i"), ""),
    ).toLowerCase();
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
 * The schema 1 index, unchanged: keyword search is BM25 (MiniSearch)
 * over the card title (boost 3), the heading (1.5) and the text, with prefix
 * and light fuzzy matching; with the pack's vectors and a query vector, the
 * keyword and dense rankings are fused (reciprocal rank fusion, k = 60).
 * The same pack and query always give the same ranking: ties go to the
 * lower page id, then the lower layer. Chunks are unique by page and layer.
 */
function createLegacyIndex(pack: KbPack, coverageOf: CoverageOf): KbIndex {
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
    aptyVersions: [pack.aptyVersion],
    cardCount: cards.size,
    stubCount: 0,
    chunkCount: chunks.length,
    mode: hybrid ? "hybrid" : "bm25",
    calibrated: pack.retrieval.threshold !== undefined,
  };

  function hit(chunk: KbChunk, score: number): KbSearchHit {
    return {
      chunk,
      card: cards.get(chunk.pageId) as KbCard,
      score,
      aptyVersion: pack.aptyVersion,
    };
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

    const coverage = coverageOf(query, ranked[0] ?? keyword[0]);
    if (!covered || ranked.length === 0) {
      return {
        status: "not_covered",
        hits: [],
        coverage,
        reason: keyword.length === 0 ? "no_match" : "low_coverage",
      };
    }
    if (options.onePerCard) {
      const best = new Set<string>();
      ranked = ranked.filter((h) => {
        if (best.has(h.chunk.pageId)) return false;
        best.add(h.chunk.pageId);
        return true;
      });
    }
    return { status: "ok", hits: ranked.slice(0, topK), coverage };
  }

  return {
    info,
    vocabularyIdf: () => [],
    holdsPhrase: () => false,
    search,
    cardChunks: (pageId) =>
      chunks
        .filter((chunk) => chunk.pageId === pageId)
        .sort((a, b) => a.layer - b.layer),
    card: (pageId) => cards.get(pageId),
  };
}

type CoverageOf = (query: string, top: KbSearchHit | undefined) => number;

interface Assessment {
  coverage: number;
  /** Matched terms with an idf of at least `minIdf`. */
  strongTerms: number;
  /** The question's terms with an idf of at least `minIdf`, matched or not. */
  strongQueryTerms: number;
  /** The question's terms the card matches, in full, by synonym or approximately. */
  matched: string[];
}

/** Words most symptoms share (stemmed): a stub needs a match beyond them. */
const GENERIC_SYMPTOM_TERMS: ReadonlySet<string> = new Set(
  [
    "show",
    "appear",
    "work",
    "load",
    "open",
    "display",
    "see",
    "missing",
    "not",
    "never",
    "error",
    "issue",
    "problem",
    "page",
    "user",
  ].map(stem),
);
/** A stub has no layer text, so its title and symptom must carry at least this much of the question. */
const STUB_MIN_COVERAGE = 0.5;
const STUB_MIN_STRONG_TERMS = 2;

/**
 * A typo or a prefix (K21 F5). Fuzzy matching is decided on the word as
 * typed, not on its stem: 5 to 7 letters allow one edit, 8 or more two; a
 * word the KB holds, or one of 4 letters or fewer, is never fuzzy-matched.
 * A prefix matches from four characters.
 */
const FUZZY_MIN_CHARS = 5;
const FUZZY_TWO_EDITS_CHARS = 8;
const PREFIX_MIN_CHARS = 4;
const APPROXIMATE_MATCH = 0.5;

const maxEdits = (typed: string) =>
  typed.length >= FUZZY_TWO_EDITS_CHARS
    ? 2
    : typed.length >= FUZZY_MIN_CHARS
      ? 1
      : 0;

/**
 * What the coverage decision reads: each term's document frequency over
 * the chunks (a card's title and symptom count once, with its lowest
 * layer) and each card's own terms, in order, and its text.
 */
function corpusOf(
  chunks: KbChunk[],
  cards: Map<string, KbCard>,
  indexedText: (chunk: KbChunk) => { heading: string; text: string },
  synonyms: SynonymTable,
) {
  const lowest = lowestLayers(chunks);
  const df = new Map<string, number>();
  /** Each word as the cards spell it, before stemming, and its stem. */
  const typedVocabulary = new Map<string, string>();
  const addTyped = (text: string) => {
    for (const { typed, term } of typedWords(text)) {
      typedVocabulary.set(typed, term);
    }
  };
  const cardTerms = new Map<string, string[]>();
  const cardText = new Map<string, string>();
  for (const chunk of chunks) {
    const card = cards.get(chunk.pageId) as KbCard;
    const { heading, text } = indexedText(chunk);
    const own =
      lowest.get(chunk.pageId) === chunk.layer
        ? `${card.title}\n${card.symptom ?? ""}`
        : "";
    const terms = analyze(`${own}\n${heading}\n${text}`);
    addTyped(`${own}\n${heading}\n${text}`);
    for (const term of new Set(terms)) df.set(term, (df.get(term) ?? 0) + 1);
    cardTerms.set(chunk.pageId, [
      ...(cardTerms.get(chunk.pageId) ?? []),
      ...terms,
    ]);
    cardText.set(
      chunk.pageId,
      `${cardText.get(chunk.pageId) ?? ""}\n${normalize(`${own}\n${heading}\n${text}`).replace(/\s+/g, " ")}`,
    );
  }
  let documents = chunks.length;
  for (const card of cards.values()) {
    if (cardTerms.has(card.pageId)) continue;
    const own = `${card.title}\n${card.symptom ?? ""}`;
    const terms = analyze(own);
    addTyped(own);
    for (const term of new Set(terms)) df.set(term, (df.get(term) ?? 0) + 1);
    cardTerms.set(card.pageId, terms);
    cardText.set(card.pageId, normalize(own).replace(/\s+/g, " "));
    documents++;
  }
  const cardSets = new Map(
    [...cardTerms].map(([pageId, terms]) => [pageId, new Set(terms)]),
  );
  const n = documents;
  const idf = (term: string) => Math.log(1 + n / (1 + (df.get(term) ?? 0)));

  const stems = [...df.keys()].filter((term) => !/[\d.]/.test(term));
  const typoCache = new Map<string, readonly string[]>();

  /**
   * The terms a typed word may be a typo of: the stems of the card words
   * within its edit distance, as typed, and the stems within that distance
   * of its own stem. None for a word the KB holds or a short word.
   */
  function typosOf({ typed, term }: TypedWord): readonly string[] {
    const cached = typoCache.get(typed);
    if (cached) return cached;
    const max = maxEdits(typed);
    const found = new Set<string>();
    if (max > 0 && !typedVocabulary.has(typed) && !df.has(term)) {
      for (const [word, wordTerm] of typedVocabulary) {
        if (editDistance(typed, word, max) <= max) found.add(wordTerm);
      }
      for (const candidate of stems) {
        if (editDistance(term, candidate, max) <= max) found.add(candidate);
      }
    }
    const list = [...found].sort();
    typoCache.set(typed, list);
    return list;
  }

  /** Each query term's possible typos, from every way it was typed. */
  function typosIn(query: string): Map<string, readonly string[]> {
    const byTerm = new Map<string, Set<string>>();
    for (const word of typedWords(query)) {
      for (const candidate of typosOf(word)) {
        const set = byTerm.get(word.term) ?? new Set<string>();
        set.add(candidate);
        byTerm.set(word.term, set);
      }
    }
    return new Map([...byTerm].map(([term, set]) => [term, [...set].sort()]));
  }

  function approximate(
    term: string,
    own: Set<string>,
    typos: readonly string[],
  ): boolean {
    if (typos.some((candidate) => own.has(candidate))) return true;
    if (term.length < PREFIX_MIN_CHARS) return false;
    for (const candidate of own) {
      if (candidate.startsWith(term)) return true;
    }
    return false;
  }

  /** Whether the card holds another member of one of `groups`. */
  function synonymIn(groups: Iterable<number>, pageId: string): boolean {
    const own = cardSets.get(pageId) ?? new Set<string>();
    const text = cardText.get(pageId) ?? "";
    for (const group of groups) {
      if (synonyms.words(group).some((word) => own.has(word))) return true;
      if (synonyms.phrases(group).some((phrase) => hasPhrase(text, phrase))) {
        return true;
      }
    }
    return false;
  }

  const holdsPhrase = createPhraseLookup(cardTerms.values());

  return {
    vocabulary: df,
    idf,
    holdsPhrase,
    typosIn,
    vocabularyIdf: () => [...df.keys()].map(idf).sort((a, b) => a - b),
    assess(query: string, pageId: string, minIdf: number): Assessment {
      const own = cardSets.get(pageId) ?? new Set<string>();
      const terms = queryTerms(query);
      const typos = typosIn(query);
      const lower = normalize(query).replace(/\s+/g, " ");
      let weighted = 0;
      let total = 0;
      let strongTerms = 0;
      let strongQueryTerms = 0;
      const matched: string[] = [];
      for (const term of terms) {
        const weight = idf(term);
        const inPhrase = [...synonyms.groupsIn([], lower)].filter((group) =>
          synonyms
            .phrases(group)
            .some(
              (phrase) =>
                hasPhrase(lower, phrase) && analyze(phrase).includes(term),
            ),
        );
        const match = own.has(term)
          ? 1
          : synonymIn([...synonyms.groupsOf(term), ...inPhrase], pageId)
            ? SYNONYM_MATCH
            : approximate(term, own, typos.get(term) ?? [])
              ? APPROXIMATE_MATCH
              : 0;
        weighted += weight * match;
        total += weight;
        if (weight >= minIdf) strongQueryTerms++;
        if (match > 0) matched.push(term);
        if (match > 0 && weight >= minIdf) strongTerms++;
      }
      return {
        coverage: total === 0 ? 0 : weighted / total,
        strongTerms,
        strongQueryTerms,
        matched,
      };
    },
  };
}

function lowestLayers(chunks: KbChunk[]): Map<string, number> {
  const lowest = new Map<string, number>();
  for (const chunk of chunks) {
    const seen = lowest.get(chunk.pageId);
    if (seen === undefined || chunk.layer < seen) {
      lowest.set(chunk.pageId, chunk.layer);
    }
  }
  return lowest;
}

const LAYER_HINTS: [KbLayer, RegExp][] = [
  [
    3,
    /network tab|\bstatus\b|\b[1-5]\d\d\b|\bresponses?\b|\bresponded\b|\brequests?\b|\bpayloads?\b|\.json\b|\bhar\b|\bmeans?\b|\breturn(?:s|ed|ing)?\b/g,
  ],
  [
    2,
    /\bconsole\b|\belements?\b|\bdevtools\b|\bselectors?\b|\bxpath\b|\bdom\b|\binspect/g,
  ],
  [1, /\bstudio\b|\badmin\b|\bsettings?\b|\bconfigur|\bpublish|\btoggles?\b/g],
  [4, /\bsupport\b|\btickets?\b|\bescalat|\bcontact|\bsend (?:it )?to\b/g],
];
const LAYER_HINT_BOOST = 1.3;
const FILE_IN_QUERY = /\.(?:json|js)\b/;

/**
 * The card layer a question asks about: the one whose words it uses most
 * (network data, then Console and Elements, then settings, then support on
 * a tie); with none, a question about a file asks for layer 3 and any
 * other for layer 1.
 */
export function layerHint(query: string): KbLayer {
  const lower = query.toLowerCase();
  let best: KbLayer | undefined;
  let bestCount = 0;
  for (const [layer, pattern] of LAYER_HINTS) {
    const count = lower.match(pattern)?.length ?? 0;
    if (count > bestCount) {
      best = layer;
      bestCount = count;
    }
  }
  return best ?? (FILE_IN_QUERY.test(lower) ? 3 : 1);
}

function uniqueChunks(pack: KbPack) {
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
  return { cards, chunks, vectorsByChunk };
}

function onePerCardOnly(hits: KbSearchHit[]): KbSearchHit[] {
  const best = new Set<string>();
  return hits.filter((h) => {
    if (best.has(h.chunk.pageId)) return false;
    best.add(h.chunk.pageId);
    return true;
  });
}

const splitQuery = (text: string) => text.split(" ").filter(Boolean);
const asIs = (term: string) => term;

/**
 * Whether a stub matches the question itself, not one generic shared word
 * (K21 F2): its title and symptom cover at least `max(min, 0.5)` of it, it
 * matches two terms with an idf of at least `minIdf` (or the only one the
 * question has), and one matched term is not a generic symptom word.
 */
function stubMatches(
  assessment: Assessment,
  settings: KbCoverageSettings,
): boolean {
  const { coverage, strongTerms, strongQueryTerms, matched } = assessment;
  return (
    coverage >= Math.max(settings.min, STUB_MIN_COVERAGE) &&
    strongTerms >=
      Math.min(STUB_MIN_STRONG_TERMS, Math.max(1, strongQueryTerms)) &&
    matched.some((term) => !GENERIC_SYMPTOM_TERMS.has(term))
  );
}

/**
 * The schema 2 index. BM25 (MiniSearch) ranks a chunk by its card's score
 * over the title (boost 2) and the symptom line (2.5), indexed once per
 * card, plus its own score over the heading (1.5) and the text, the layer
 * the question asks about (`layerHint`) boosted 1.3 there, so the hint
 * chooses among a card's layers without being outweighed by what all of
 * them share. Terms are stemmed and synonyms count 0.8. A length-independent
 * coverage decides whether the top card covers the question at all:
 * `coverage = Σ idf(t)·match(t) / Σ idf(t)` over the question's distinct
 * terms, with `idf(t) = ln(1 + N / (1 + df(t)))`, so a word no card holds
 * weighs most. The question is covered when coverage reaches
 * `coverage.min` and `coverage.minTerms` matched terms have an idf of at
 * least `coverage.minIdf`, and some card holds every setting-like phrase
 * the question names (`namedPhrases`).
 */
function createV2Index(pack: KbPack): KbIndex {
  const { cards, chunks, vectorsByChunk } = uniqueChunks(pack);
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const shared = sharedLayerDescriptions(chunks, cards);
  const indexedText = (chunk: KbChunk) => ({
    heading: headingTerms(chunk, cards.get(chunk.pageId) as KbCard, shared),
    text: bodyTerms(chunk.text),
  });
  const synonyms = createSynonymTable([
    ...KB_SYNONYM_GROUPS,
    ...(pack.retrieval.synonyms ?? []),
  ]);
  const corpus = corpusOf(chunks, cards, indexedText, synonyms);
  const settings = pack.retrieval.coverage ?? KB_COVERAGE_DEFAULTS;

  const searchOptions = {
    tokenize: splitQuery,
    processTerm: asIs,
    prefix: (term: string) => term.length >= PREFIX_MIN_CHARS,
    fuzzy: false,
  };
  /** Which card: its title and symptom line, once per card. */
  const cardIndex = new MiniSearch<{
    id: string;
    title: string;
    symptom: string;
  }>({
    fields: ["title", "symptom"],
    tokenize: analyze,
    processTerm: asIs,
    searchOptions: { ...searchOptions, boost: { title: 2, symptom: 2.5 } },
  });
  cardIndex.addAll(
    [...cards.values()].map((card) => ({
      id: card.pageId,
      title: card.title,
      symptom: card.symptom ?? "",
    })),
  );
  /** Which layer: the chunk's heading and text. */
  const chunkIndex = new MiniSearch<{
    id: string;
    heading: string;
    text: string;
  }>({
    fields: ["heading", "text"],
    tokenize: analyze,
    processTerm: asIs,
    searchOptions: { ...searchOptions, boost: { heading: 1.5 } },
  });
  chunkIndex.addAll(
    chunks.map((chunk) => ({ id: chunk.id, ...indexedText(chunk) })),
  );
  const chunksOf = new Map<string, KbChunk[]>();
  for (const chunk of chunks) {
    chunksOf.set(chunk.pageId, [...(chunksOf.get(chunk.pageId) ?? []), chunk]);
  }

  /**
   * The terms to search, each with its weight: the question's own (1), the
   * other members of the synonym groups it names (0.8), and the card terms
   * a typed word may be a typo of (0.5, as in coverage).
   */
  function expand(query: string, terms: string[]): Map<string, number> {
    const weights = new Map(terms.map((term) => [term, 1]));
    const add = (term: string, weight: number) => {
      if ((weights.get(term) ?? 0) < weight) weights.set(term, weight);
    };
    for (const group of synonyms.groupsIn(terms, query)) {
      for (const word of synonyms.words(group)) add(word, SYNONYM_MATCH);
    }
    for (const typos of corpus.typosIn(query).values()) {
      for (const candidate of typos) add(candidate, APPROXIMATE_MATCH);
    }
    return weights;
  }

  const dense = pack.retrieval.dense;
  const hybrid = dense !== undefined && vectorsByChunk.size === chunks.length;
  const hit = (chunk: KbChunk, score: number): KbSearchHit => ({
    chunk,
    card: cards.get(chunk.pageId) as KbCard,
    score,
    aptyVersion: pack.aptyVersion,
  });

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
    const terms = queryTerms(query);
    const searched = expand(query, terms);
    const hinted = layerHint(query);

    const scores = new Map<string, number>();
    const chunklessScores = new Map<string, number>();
    if (terms.length > 0) {
      const options = {
        boostTerm: (term: string) => searched.get(term) ?? 1,
      };
      const text = [...searched.keys()].join(" ");
      for (const result of cardIndex.search(text, options)) {
        const pageId = String(result.id);
        const own = chunksOf.get(pageId);
        if (!own) chunklessScores.set(pageId, result.score);
        for (const chunk of own ?? []) {
          scores.set(chunk.id, (scores.get(chunk.id) ?? 0) + result.score);
        }
      }
      for (const result of chunkIndex.search(text, options)) {
        const chunk = byId.get(String(result.id)) as KbChunk;
        const boost = chunk.layer === hinted ? LAYER_HINT_BOOST : 1;
        scores.set(
          chunk.id,
          (scores.get(chunk.id) ?? 0) + result.score * boost,
        );
      }
    }
    const preferHinted = (a: KbSearchHit, b: KbSearchHit) =>
      b.score - a.score ||
      comparePageIds(a.chunk.pageId, b.chunk.pageId) ||
      Number(b.chunk.layer === hinted) - Number(a.chunk.layer === hinted) ||
      a.chunk.layer - b.chunk.layer;
    const keyword = [...scores]
      .map(([id, score]) => hit(byId.get(id) as KbChunk, score))
      .filter((h) => inLayers(h.chunk))
      .sort(preferHinted);

    let ranked = keyword;
    let denseCovered = false;
    if (hybrid && options.queryVector) {
      const queryVector = options.queryVector;
      const denseThreshold = dense?.threshold;
      const semantic = chunks
        .filter(inLayers)
        .map((chunk) =>
          hit(
            chunk,
            cosine(queryVector, vectorsByChunk.get(chunk.id) as Float32Array),
          ),
        )
        .filter(
          (h) => denseThreshold !== undefined && h.score >= denseThreshold,
        )
        .sort(compareHits);
      denseCovered = semantic.length > 0;
      const fused = new Map<string, number>();
      for (const list of [keyword, semantic]) {
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

    const top = ranked[0];
    const stub = [...chunklessScores]
      .filter(([pageId]) => cards.get(pageId)?.status === "stub")
      .sort(([a, x], [b, y]) => y - x || comparePageIds(a, b))[0];
    const stubFirst =
      stub !== undefined &&
      (!top || stub[1] > top.score) &&
      stubMatches(corpus.assess(query, stub[0], settings.minIdf), settings)
        ? (cards.get(stub[0]) as KbCard)
        : undefined;
    if (!top && !stubFirst) {
      return {
        status: "not_covered",
        hits: [],
        coverage: 0,
        reason: "no_match",
      };
    }
    const { coverage, strongTerms } = corpus.assess(
      query,
      stubFirst?.pageId ?? (top as KbSearchHit).chunk.pageId,
      settings.minIdf,
    );
    const holds = options.holdsPhrase ?? corpus.holdsPhrase;
    const missingPhrases = namedPhrases(query).filter(
      (phrase) => !holds(phrase),
    );
    if (missingPhrases.length > 0) {
      return {
        status: "not_covered",
        hits: [],
        coverage,
        reason: "unknown_setting",
        missingPhrases,
      };
    }
    const covered =
      denseCovered ||
      (coverage >= settings.min && strongTerms >= settings.minTerms);
    if (!covered) {
      return {
        status: "not_covered",
        hits: [],
        coverage,
        reason: "low_coverage",
      };
    }
    if (stubFirst) {
      return {
        status: "stub",
        hits: [],
        coverage,
        card: stubFirst,
        cardVersion: pack.aptyVersion,
      };
    }
    const hits = options.onePerCard ? onePerCardOnly(ranked) : ranked;
    return { status: "ok", hits: hits.slice(0, topK), coverage };
  }

  return {
    info: {
      aptyVersions: [pack.aptyVersion],
      cardCount: cards.size,
      stubCount: [...cards.values()].filter((card) => card.status === "stub")
        .length,
      chunkCount: chunks.length,
      mode: hybrid ? "hybrid" : "bm25",
      calibrated: pack.retrieval.coverage !== undefined,
    },
    vocabularyIdf: corpus.vocabularyIdf,
    holdsPhrase: corpus.holdsPhrase,
    search,
    cardChunks: (pageId) =>
      chunks
        .filter((chunk) => chunk.pageId === pageId)
        .sort((a, b) => a.layer - b.layer),
    card: (pageId) => cards.get(pageId),
  };
}

/**
 * A search index over a parsed pack. A schema 1 pack searches exactly as
 * it did (BM25, its calibrated score threshold); a schema 2 pack ranks by
 * BM25 and decides "not covered" by coverage. Either way the same pack and
 * query give the same result: ties go to the lower page id, then the lower
 * layer, and chunks are unique by page and layer.
 */
export function createKbIndex(pack: KbPack): KbIndex {
  if (pack.schemaVersion === 2) return createV2Index(pack);
  const { cards, chunks } = uniqueChunks(pack);
  const shared = sharedLayerDescriptions(chunks, cards);
  const corpus = corpusOf(
    chunks,
    cards,
    (chunk) => ({
      heading: headingTerms(chunk, cards.get(chunk.pageId) as KbCard, shared),
      text: bodyTerms(chunk.text),
    }),
    createSynonymTable(KB_SYNONYM_GROUPS),
  );
  const index = createLegacyIndex(pack, (query, top) =>
    top ? corpus.assess(query, top.chunk.pageId, 0).coverage : 0,
  );
  return {
    ...index,
    vocabularyIdf: corpus.vocabularyIdf,
    holdsPhrase: corpus.holdsPhrase,
  };
}
