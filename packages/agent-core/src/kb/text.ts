/**
 * The text analysis a schema v2 pack's index and its coverage decision
 * share, so a word is the same term on both sides.
 */

/** Function words and question words: they carry no topic, so they are neither indexed nor counted. */
const STOP_WORDS = new Set(
  `a about above after again all also am an and any are as at be been before being below both but by
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
function normalize(text: string): string {
  return text.toLowerCase().replace(NEGATION, " not").replace(POSSESSIVE, "");
}

/** The terms of a text, in order, repeats kept: what is indexed and searched. */
export function analyze(text: string): string[] {
  return normalize(text).split(WORD_SPLIT).filter(keepTerm);
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
