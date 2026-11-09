/**
 * A light, deterministic English stemmer for KB search: index and query
 * terms go through it alike, so "flickers", "flickering" and "flickered"
 * are one term. It only has to map a word and its inflections to the same
 * stem, not to a dictionary word. Tokens with digits or dots (`flow.json`,
 * `403`, `f5`) are never stemmed.
 */
const VOWEL = /[aeiouy]/;
const UNDOUBLED = /([b-df-hj-km-np-rtv-y])\1$/;

const hasVowel = (text: string) => VOWEL.test(text);

/** Drops one of a doubled final consonant ("stopped" and "running" end as "stop" and "run"); l, s and z stay doubled ("install", "miss", "buzz"). */
function undouble(stem: string): string {
  return UNDOUBLED.test(stem) ? stem.slice(0, -1) : stem;
}

function plural(word: string): string {
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (/(?:[sxz]|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (/(?:ss|us|is)$/.test(word)) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function verb(word: string): string {
  if (word.endsWith("ied") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ing")) {
    const rest = word.slice(0, -3);
    if (rest.length >= 2 && hasVowel(rest)) return undouble(rest);
  }
  if (word.endsWith("ed") && !word.endsWith("eed")) {
    const rest = word.slice(0, -2);
    if (rest.length >= 2 && hasVowel(rest)) return undouble(rest);
  }
  return word;
}

function suffix(word: string, ending: string, minStem: number): string {
  if (!word.endsWith(ending)) return word;
  const rest = word.slice(0, -ending.length);
  return rest.length >= minStem && hasVowel(rest) ? rest : word;
}

function degree(word: string): string {
  for (const ending of ["est", "er"]) {
    const rest = suffix(word, ending, 4);
    if (rest !== word) return undouble(rest);
  }
  return word;
}

function finalE(word: string): string {
  return word.length >= 3 && word.endsWith("e") && !word.endsWith("ee")
    ? word.slice(0, -1)
    : word;
}

export function stem(term: string): string {
  if (term.length <= 3 || /[\d.]/.test(term)) return term;
  return finalE(degree(suffix(verb(plural(term)), "ly", 4)));
}
