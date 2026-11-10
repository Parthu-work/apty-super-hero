/**
 * What a chat message asks of the KB (KB-RAG K16): whether it reports a
 * symptom, whether it is a bare "how do I configure X", which is not a KB
 * question (D-KB1), and whether it is written mostly outside the Latin script,
 * which English cards cannot match.
 */
import { kbTerms, stem } from "@apty/agent-core";

const NEGATION =
  /n['’]t\b|\b(?:not|cannot|never|no longer)\b|不|没有|无法|错误|失败|消失/i;

const SYMPTOM_STEMS = new Set(
  [
    "stop",
    "fail",
    "error",
    "broken",
    "missing",
    "blank",
    "empty",
    "twice",
    "wrong",
    "hidden",
    "disappear",
    "stuck",
    "crash",
    "flicker",
    "jump",
    "slow",
    "lag",
    "laggy",
    "freeze",
    "frozen",
    "hang",
    "repeat",
    "again",
    "invisible",
    "unreadable",
    "crop",
    "duplicate",
    "late",
    "inconsistent",
    "differ",
    "different",
    "reject",
    "skip",
  ].map(stem),
);

const SYMPTOM_PHRASES =
  /\bnothing happens\b|\bdoes nothing\b|\bstill show|\bno \w+ (?:appears?|shows?)\b|\bevery user\b|\bfor everyone\b|\bonly some\b|\bcut off\b/i;

/** Whether the message reports something not working. */
export function hasSymptomWord(text: string): boolean {
  return (
    NEGATION.test(text) ||
    SYMPTOM_PHRASES.test(text) ||
    kbTerms(text).some((term) => SYMPTOM_STEMS.has(term))
  );
}

const HOW_TO =
  /^\s*(?:(?:please|hi|hello|hey)\b[\s,!.]*)?(?:how (?:do|can|should|would) (?:i|we|you)\b|how to\b|can (?:i|we)\b|where (?:is|are) (?:the )?(?:setting|option|toggle|switch)s?\b|where (?:do|can) (?:i|we) (?:configure|set|change|find|turn)\b|what is the setting for\b)/i;

/**
 * A how-to with no symptom: "how do I configure X", "where is the setting
 * for Y". The KB answers symptoms, not how-to questions (D-KB1), so no KB
 * card answers them and they do not pull `search_kb` in.
 */
export function isBareHowTo(text: string): boolean {
  return HOW_TO.test(text) && !hasSymptomWord(text);
}

const LETTER = /\p{L}/gu;
const LATIN = /\p{Script=Latin}/u;

/** More than half the message's letters are outside the Latin script. */
export function isMostlyNonLatin(text: string): boolean {
  const letters = text.match(LETTER) ?? [];
  if (letters.length === 0) return false;
  const nonLatin = letters.filter((letter) => !LATIN.test(letter)).length;
  return nonLatin * 2 > letters.length;
}
