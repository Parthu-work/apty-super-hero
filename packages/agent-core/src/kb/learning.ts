/**
 * The KB's learning loop on the device (KB-RAG K27, E7): finding a card by
 * its title for Wrong card, and the words SEs used that the right card does
 * not hold, proposed to the KB owner as synonyms. Proposals only: nothing
 * here changes a pack.
 */
import { analyze, typedWords } from "./text.js";

/** A card the picker can offer: its id, title and the version of its pack. */
export interface KbCardTitle {
  pageId: string;
  title: string;
  aptyVersion?: string;
}

const PLACEHOLDER = /<[^<>]*>|\[[^[\]]*\]/g;

/**
 * Cards whose title holds every word of `query` (in any order, by stem), or
 * whose id starts with it; titles that start with the query come first.
 */
export function searchCardTitles(
  cards: readonly KbCardTitle[],
  query: string,
  limit = 8,
): KbCardTitle[] {
  const text = query.trim().toLowerCase();
  if (!text) return cards.slice(0, limit);
  const wanted = typedWords(text).map((word) => word.term);
  const byId = /^\d+$/.test(text);
  const scored: Array<{ card: KbCardTitle; rank: number }> = [];
  for (const card of cards) {
    const title = card.title.toLowerCase();
    if (byId && card.pageId.startsWith(text)) {
      scored.push({ card, rank: card.pageId === text ? 0 : 1 });
      continue;
    }
    if (title.includes(text)) {
      scored.push({ card, rank: title.startsWith(text) ? 2 : 3 });
      continue;
    }
    if (wanted.length === 0) continue;
    const terms = new Set(analyze(card.title));
    if (wanted.every((term) => terms.has(term))) {
      scored.push({ card, rank: 4 });
    }
  }
  return scored
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.card.title.localeCompare(b.card.title) ||
        a.card.pageId.localeCompare(b.card.pageId),
    )
    .slice(0, limit)
    .map(({ card }) => card);
}

/** A wrong-card mark whose right card and question are known. */
export interface SynonymSource {
  question: string;
  rightCardId: string;
  aptyVersion?: string;
}

/** Words from SEs' questions that the right card does not hold. */
export interface SynonymProposal {
  cardId: string;
  aptyVersion?: string;
  /** Each word as typed, with how many questions used it; most used first. */
  words: Array<{ word: string; count: number }>;
}

/**
 * For each right card, the words of the questions marked wrong against it
 * that its text (`cardText`) does not hold, by stem. A card `cardText`
 * does not know is left out: there is nothing to compare with. Redaction
 * placeholders and numbers are never proposed.
 */
export function proposeSynonyms(
  sources: readonly SynonymSource[],
  cardText: (pageId: string, aptyVersion?: string) => string | undefined,
): SynonymProposal[] {
  const byCard = new Map<
    string,
    { cardId: string; aptyVersion?: string; counts: Map<string, number> }
  >();
  const termsOf = new Map<string, Set<string>>();
  for (const { question, rightCardId, aptyVersion } of sources) {
    const key = `${aptyVersion ?? ""}:${rightCardId}`;
    let held = termsOf.get(key);
    if (!held) {
      const text = cardText(rightCardId, aptyVersion);
      if (text === undefined) continue;
      held = new Set(analyze(text));
      termsOf.set(key, held);
    }
    const missing = new Set(
      typedWords(question.replace(PLACEHOLDER, " "))
        .filter(({ typed, term }) => typed.length >= 3 && !held.has(term))
        .map(({ typed }) => typed),
    );
    if (missing.size === 0) continue;
    const entry = byCard.get(key) ?? {
      cardId: rightCardId,
      ...(aptyVersion ? { aptyVersion } : {}),
      counts: new Map<string, number>(),
    };
    for (const word of missing) {
      entry.counts.set(word, (entry.counts.get(word) ?? 0) + 1);
    }
    byCard.set(key, entry);
  }
  return [...byCard.values()]
    .map(({ counts, ...card }) => ({
      ...card,
      words: [...counts]
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)),
    }))
    .sort(
      (a, b) =>
        (a.aptyVersion ?? "").localeCompare(b.aptyVersion ?? "") ||
        a.cardId.localeCompare(b.cardId),
    );
}
