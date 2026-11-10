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

/**
 * Comparatives and superlatives, mapped to their adjective (K21 F6). -er
 * and -est are stripped only for these: as a general rule they merged
 * nouns with unrelated words ("player" with "play", "header" with "head").
 */
const ADJECTIVES =
  `slow fast late early large big small old new long short high low wide
  narrow dark light quick easy hard`.split(/\s+/);

function degreesOf(adjective: string): string[] {
  if (adjective.endsWith("e")) return [`${adjective}r`, `${adjective}st`];
  if (adjective.endsWith("y")) {
    const rest = adjective.slice(0, -1);
    return [`${rest}ier`, `${rest}iest`];
  }
  const forms = [`${adjective}er`, `${adjective}est`];
  if (/[^aeiou][aeiou][b-df-hj-np-tv-z]$/.test(adjective)) {
    const last = adjective.slice(-1);
    forms.push(`${adjective}${last}er`, `${adjective}${last}est`);
  }
  return forms;
}

const COMPARATIVES = new Map(
  ADJECTIVES.flatMap((adjective) =>
    degreesOf(adjective).map((form) => [form, adjective] as const),
  ),
);

function finalE(word: string): string {
  return word.length >= 3 && word.endsWith("e") && !word.endsWith("ee")
    ? word.slice(0, -1)
    : word;
}

export function stem(term: string): string {
  const word = COMPARATIVES.get(term) ?? term;
  if (word.length <= 3 || /[\d.]/.test(word)) return word;
  return finalE(suffix(verb(plural(word)), "ly", 4));
}
