/**
 * The text analysis a schema v2 pack's index and its coverage decision
 * share, so a word is the same term on both sides.
 */
import { stem } from "./stem.js";

/** Function words and question words: they carry no topic, so they are neither indexed nor counted. */
const STOP_WORDS = new Set(
  `a about above after all also am an and any are as at be been before being below both but by
  can cannot could did do does doing done down during each either else even ever for from further get gets
  got had has have having he her here hers him his how however i if in into is it its itself just let me
  might more most must my myself no nor not now of off on once only or other our ours out over own please
  same she should so some such than that the their theirs them then there these they this those though
  through to too under until up upon us very was we were what whatever when where whether which while who
  whom whose why will with within without would yet you your yours yourself im ive dont doesnt didnt isnt
  cant wont`
    .split(/\s+/)
    .filter(Boolean),
);

const NEGATION = /n['’]t\b/g;
const POSSESSIVE = /['’]s\b/g;
const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

/** A term the index can hold: at least two characters, not a function word. */
export function keepTerm(term: string): boolean {
  return term.length >= 2 && !STOP_WORDS.has(term);
}

/** Lower case, "doesn't" as "does not", "user's" as "user". */
export function normalize(text: string): string {
  return text.toLowerCase().replace(NEGATION, " not").replace(POSSESSIVE, "");
}

const FILE_NAME =
  /(?<![\p{L}\p{N}_.-])[a-z0-9_]+(?:-[a-z0-9_]+)*\.(?:json|js)(?![\p{L}\p{N}_])/gu;
const FILE_ID =
  /^(.+?)-(?:\d+|id|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(json|js)$/;

/** `flow-123.json`, `flow-<uuid>.json` and `flow-ID.json` are one file: `flow-id.json`. */
export function normalizeFileName(name: string): string {
  const match = FILE_ID.exec(name);
  return match ? `${match[1]}-id.${match[2]}` : name;
}

const words = (text: string) =>
  text.split(WORD_SPLIT).filter(keepTerm).map(stem);

/**
 * The terms of a text, in order, repeats kept: what is indexed and
 * searched. Words are stemmed; a file name is kept whole, its id
 * normalized, and its parts follow it.
 */
export function analyze(text: string): string[] {
  const lower = normalize(text);
  const terms: string[] = [];
  let from = 0;
  for (const match of lower.matchAll(FILE_NAME)) {
    terms.push(...words(lower.slice(from, match.index)));
    const name = normalizeFileName(match[0]);
    terms.push(name, ...words(name));
    from = match.index + match[0].length;
  }
  terms.push(...words(lower.slice(from)));
  return terms;
}

/** The distinct terms of a query, in the order they first appear. */
export function queryTerms(text: string): string[] {
  return [...new Set(analyze(text))];
}

/** Levenshtein distance, or `max + 1` as soon as it must exceed `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length] ?? max + 1;
}

/** Proper nouns that are not Apty settings: a phrase of them is not checked against the cards. */
export const NOT_A_SETTING = new Set([
  "apty",
  "chrome",
  "google",
  "microsoft",
  "salesforce",
  "network",
  "console",
  "elements",
  "devtools",
  "i",
]);

const QUOTED =
  /"([^"\n]{2,80})"|“([^”\n]{2,80})”|(?:^|\s)'([^'\n]{2,80})'(?=[\s.,;:!?)]|$)/g;
const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;
const TITLE_WORD = /^\p{Lu}[\p{L}\p{N}-]*$/u;

/**
 * The phrases a question names as if they were settings: each quoted
 * phrase, and each run of two or more Title Case words, not counting a
 * sentence's first word or a proper noun such as "Chrome".
 */
export function namedPhrases(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(QUOTED)) {
    const phrase = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (phrase) found.push(phrase);
  }
  const unquoted = text.replace(QUOTED, " . ");
  for (const sentence of unquoted.split(SENTENCE_SPLIT)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    let run: string[] = [];
    const flush = () => {
      if (run.length >= 2) found.push(run.join(" "));
      run = [];
    };
    words.forEach((raw, i) => {
      const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      const title =
        i > 0 &&
        TITLE_WORD.test(word) &&
        !NOT_A_SETTING.has(word.toLowerCase());
      if (title) run.push(word);
      else flush();
      if (title && /[,;:!?]$/.test(raw)) flush();
    });
    flush();
  }
  return [...new Set(found)];
}

/** Whether `phrase`'s terms appear in a row in `terms`. */
export function containsPhrase(terms: string[], phrase: string): boolean {
  const wanted = analyze(phrase);
  if (wanted.length === 0) return true;
  outer: for (let i = 0; i + wanted.length <= terms.length; i++) {
    for (let j = 0; j < wanted.length; j++) {
      if (terms[i + j] !== wanted[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Synonym groups as the search uses them: a one-word member by its stem,
 * any other member (several words, or a hyphen) by its lower-case text.
 */
export interface SynonymTable {
  /** The groups a query or card text names, by a member's stem or text. */
  groupsIn(terms: readonly string[], text: string): Set<number>;
  /** The groups a term belongs to, as a one-word member. */
  groupsOf(term: string): readonly number[];
  /** A group's one-word members, stemmed. */
  words(group: number): readonly string[];
  /** A group's other members, lower case. */
  phrases(group: number): readonly string[];
}

const SINGLE_WORD = /^[\p{L}\p{N}]+$/u;

/** Whether `phrase` is in `text` with no letter or digit on either side. */
export function hasPhrase(text: string, phrase: string): boolean {
  let at = text.indexOf(phrase);
  while (at !== -1) {
    const before = text.charAt(at - 1);
    const after = text.charAt(at + phrase.length);
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) {
      return true;
    }
    at = text.indexOf(phrase, at + 1);
  }
  return false;
}

export function createSynonymTable(
  groups: readonly (readonly string[])[],
): SynonymTable {
  const wordsOf: string[][] = [];
  const phrasesOf: string[][] = [];
  const byWord = new Map<string, number[]>();
  groups.forEach((group, i) => {
    const single: string[] = [];
    const multi: string[] = [];
    for (const member of group) {
      const lower = member.trim().toLowerCase().replace(/\s+/g, " ");
      if (!lower) continue;
      if (SINGLE_WORD.test(lower)) {
        const term = stem(lower);
        single.push(term);
        byWord.set(term, [...(byWord.get(term) ?? []), i]);
      } else multi.push(lower);
    }
    wordsOf.push([...new Set(single)]);
    phrasesOf.push([...new Set(multi)]);
  });
  return {
    groupsIn(terms, text) {
      const found = new Set<number>();
      for (const term of terms) {
        for (const group of byWord.get(term) ?? []) found.add(group);
      }
      const lower = normalize(text).replace(/\s+/g, " ");
      phrasesOf.forEach((phrases, group) => {
        if (phrases.some((phrase) => hasPhrase(lower, phrase))) {
          found.add(group);
        }
      });
      return found;
    },
    groupsOf: (term) => byWord.get(term) ?? [],
    words: (group) => wordsOf[group] ?? [],
    phrases: (group) => phrasesOf[group] ?? [],
  };
}
