/**
 * Self-retrieval (KB-RAG K25, A3; shared with Options in K27, E9): each
 * card's title, and its Symptom line when it has one, searched as a
 * question with the pack's own settings. Routing pages are not answers and
 * are left out. `pnpm kb:eval --self-check` and Options read the same report.
 */
import type { KbPack } from "./pack.js";
import {
  createKbIndex,
  KB_COVERAGE_DEFAULTS,
  type KbCoverageSettings,
  type KbNotCoveredReason,
} from "./search.js";

const RANK_DEPTH = 10;

/** A card's own status coming back counts as finding it (a stub, a "not in this version" card). */
const OWN_STATUS: Partial<Record<string, string>> = {
  stub: "stub",
  absent: "not_in_version",
};

const round = (n: number) => Math.round(n * 1000) / 1000;

export interface KbSelfCheckTotals {
  of: number;
  rank1: number;
  top3: number;
}

export interface KbSelfCheckQuery {
  pageId: string;
  kind: "title" | "symptom";
  /** The card's own rank, 1-based; 0 when it is not in the top 10. */
  rank: number;
  status: string;
  reason?: KbNotCoveredReason;
  coverage: number;
  min: number;
  topPageId: string | null;
}

export interface KbSelfCheckReport {
  cards: number;
  routing: number;
  coverage: KbCoverageSettings;
  titles: KbSelfCheckTotals;
  symptoms: KbSelfCheckTotals;
  /** Page ids whose title does not find its own card in the top 3. */
  failingTitles: string[];
  queries: KbSelfCheckQuery[];
}

/** What Options shows: counts and page ids, no card text. */
export type KbSelfCheckSummary = Pick<
  KbSelfCheckReport,
  "cards" | "routing" | "titles" | "symptoms" | "failingTitles"
>;

export function kbSelfCheck(pack: KbPack): KbSelfCheckReport {
  const index = createKbIndex(pack);
  const settings = {
    ...KB_COVERAGE_DEFAULTS,
    ...(pack.retrieval.coverage ?? {}),
  };
  const queries: KbSelfCheckQuery[] = [];
  for (const card of pack.cards) {
    if (card.status === "routing") continue;
    const asked: Array<[KbSelfCheckQuery["kind"], string]> = [
      ["title", card.title],
    ];
    if (card.symptom) asked.push(["symptom", card.symptom]);
    for (const [kind, text] of asked) {
      const result = index.search(text, { topK: RANK_DEPTH, onePerCard: true });
      const ranked =
        result.card && result.status !== "ok"
          ? [result.card.pageId]
          : result.hits.map((hit) => hit.chunk.pageId);
      const position = ranked.indexOf(card.pageId);
      const ownStatus = card.status ? OWN_STATUS[card.status] : undefined;
      const found =
        position >= 0 &&
        (ownStatus ? result.status === ownStatus : result.status === "ok");
      queries.push({
        pageId: card.pageId,
        kind,
        rank: found ? position + 1 : 0,
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
        coverage: round(result.coverage),
        min: settings.min,
        topPageId: ranked[0] ?? result.topPageId ?? null,
      });
    }
  }
  const totals = (kind: KbSelfCheckQuery["kind"]): KbSelfCheckTotals => {
    const list = queries.filter((q) => q.kind === kind);
    return {
      of: list.length,
      rank1: list.filter((q) => q.rank === 1).length,
      top3: list.filter((q) => q.rank >= 1 && q.rank <= 3).length,
    };
  };
  return {
    cards: pack.cards.length,
    routing: pack.cards.filter((card) => card.status === "routing").length,
    coverage: settings,
    titles: totals("title"),
    symptoms: totals("symptom"),
    failingTitles: queries
      .filter((q) => q.kind === "title" && (q.rank < 1 || q.rank > 3))
      .map((q) => q.pageId),
    queries,
  };
}

export function kbSelfCheckSummary(
  report: KbSelfCheckReport,
): KbSelfCheckSummary {
  const { cards, routing, titles, symptoms, failingTitles } = report;
  return { cards, routing, titles, symptoms, failingTitles };
}
