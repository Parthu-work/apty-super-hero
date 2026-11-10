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
function keepTerm(term: string): boolean {
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
function normalizeFileName(name: string): string {
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

/** A word as typed (lower case) and its term: what typo matching compares. */
export interface TypedWord {
  typed: string;
  term: string;
}

/** The words of a text as typed, with their stems; no file names, numbers or function words. */
export function typedWords(text: string): TypedWord[] {
  return normalize(text)
    .split(WORD_SPLIT)
    .filter((word) => keepTerm(word) && !/\d/.test(word))
    .map((typed) => ({ typed, term: stem(typed) }));
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

/** Browser and platform terms a question names that are never Apty settings. */
const BROWSER_TERMS = [
  "Developer Mode",
  "Service Worker",
  "Preserve Log",
  "Inspect Views",
  "Network Tab",
  "Console",
  "Elements",
  "DevTools",
  "Chrome",
  "Edge",
  "Google",
  "Microsoft",
  "Windows",
  "macOS",
];

/** Customer applications Apty runs on, never Apty settings. */
const CUSTOMER_APPLICATIONS = [
  "Salesforce",
  "Lightning",
  "Workday",
  "SAP",
  "ServiceNow",
  "Oracle",
  "Dynamics",
  "SuccessFactors",
];

/** Phrases, lower case, that are never Apty settings: a Title Case run made only of them is not checked. */
export const NOT_A_SETTING: ReadonlySet<string> = new Set(
  ["Apty", ...BROWSER_TERMS, ...CUSTOMER_APPLICATIONS].map((term) =>
    term.toLowerCase(),
  ),
);
const LONGEST_NOT_A_SETTING = Math.max(
  ...[...NOT_A_SETTING].map((phrase) => phrase.split(" ").length),
);

/** Words that name a setting: a Title Case run is checked only within three words of one. */
const SETTING_CUES = new Set(
  [
    "setting",
    "settings",
    "toggle",
    "option",
    "checkbox",
    "switch",
    "flag",
    "field",
    "enable",
    "disable",
    "set",
    "configure",
  ].map(stem),
);
/** Two-word cues, by the stems of their words: "turn on", "turned off". */
const SETTING_CUE_PAIRS = [
  ["turn", "on"],
  ["turn", "off"],
];
const CUE_DISTANCE = 3;

const QUOTED =
  /"([^"\n]{2,80})"|“([^”\n]{2,80})”|(?:^|\s)'([^'\n]{2,80})'(?=[\s.,;:!?)]|$)/g;
const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;
const TITLE_WORD = /^\p{Lu}[\p{L}\p{N}-]*$/u;

/** Whether the run's words are all covered by phrases that are never settings. */
function onlyNotASetting(words: string[]): boolean {
  let at = 0;
  outer: while (at < words.length) {
    for (let size = LONGEST_NOT_A_SETTING; size >= 1; size--) {
      const phrase = words
        .slice(at, at + size)
        .join(" ")
        .toLowerCase();
      if (at + size <= words.length && NOT_A_SETTING.has(phrase)) {
        at += size;
        continue outer;
      }
    }
    return false;
  }
  return true;
}

/** The positions of the setting cues among a sentence's words. */
function cuePositions(words: string[]): number[] {
  const stems = words.map((word) => stem(word.toLowerCase()));
  const found: number[] = [];
  stems.forEach((term, i) => {
    if (SETTING_CUES.has(term)) found.push(i);
    if (SETTING_CUE_PAIRS.some(([a, b]) => term === a && stems[i + 1] === b)) {
      found.push(i, i + 1);
    }
  });
  return found;
}

/**
 * The phrases a question names as if they were Apty settings: each quoted
 * phrase, and each run of two or more Title Case words (not a sentence's
 * first word) within three words of a setting cue such as "toggle",
 * "option" or "turn on". A run made only of browser, platform or customer
 * application names ("Developer Mode", "Salesforce Lightning") is never one.
 * `everyRun` drops the cue condition: an answer's grounding check (K18)
 * reads every Title Case run it names.
 */
export function namedPhrases(
  text: string,
  { everyRun = false }: { everyRun?: boolean } = {},
): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(QUOTED)) {
    const phrase = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (phrase) found.push(phrase);
  }
  const unquoted = text.replace(QUOTED, " . ");
  for (const sentence of unquoted.split(SENTENCE_SPLIT)) {
    const words: string[] = [];
    const breakAfter: boolean[] = [];
    for (const raw of sentence.split(/\s+/)) {
      const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (!word) continue;
      words.push(word);
      breakAfter.push(/[,;:!?]$/.test(raw));
    }
    const cues = cuePositions(words);
    let start = -1;
    const flush = (end: number) => {
      if (start >= 0 && end - start >= 2) {
        const run = words.slice(start, end);
        const nearCue =
          everyRun ||
          cues.some(
            (cue) => cue >= start - CUE_DISTANCE && cue < end + CUE_DISTANCE,
          );
        if (nearCue && !onlyNotASetting(run)) found.push(run.join(" "));
      }
      start = -1;
    };
    words.forEach((word, i) => {
      const title = i > 0 && TITLE_WORD.test(word) && word !== "I";
      if (title && start < 0) start = i;
      if (!title) flush(i);
      else if (breakAfter[i]) flush(i + 1);
    });
    flush(words.length);
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
 * Whether a phrase's terms appear in a row in any of `streams` (each card's
 * terms, in order): built once per index, each term's positions indexed.
 */
export function createPhraseLookup(
  streams: Iterable<readonly string[]>,
): (phrase: string) => boolean {
  const all = [...streams];
  const at = new Map<string, Array<[number, number]>>();
  all.forEach((terms, s) => {
    terms.forEach((term, i) => {
      const list = at.get(term);
      if (list) list.push([s, i]);
      else at.set(term, [[s, i]]);
    });
  });
  return (phrase) => {
    const wanted = analyze(phrase);
    if (wanted.length === 0) return true;
    return (at.get(wanted[0] as string) ?? []).some(([s, i]) =>
      wanted.every((term, j) => all[s]?.[i + j] === term),
    );
  };
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
