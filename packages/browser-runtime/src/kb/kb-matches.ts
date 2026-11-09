/**
 * The KB matches card (KB-RAG K6): for a symptom no check pack claims, the
 * loaded pack's best cards, one chunk each, answered with no model call.
 * A bare "how do I configure X" with no symptom is left to the model or
 * Ask Dapty (D-KB1).
 */
import {
  type KbIndexSource,
  type KbToolResult,
  kbToolResult,
  sharedKbIndexSource,
} from "./kb-index.js";

const SYMPTOM =
  /n't\b|\b(?:not|cannot|never|no longer|stopped|stops|fail(?:s|ed|ing)?|errors?|broken|missing|blank|empty|twice|wrong|hidden|disappear(?:s|ed)?|stuck|crash(?:es|ed)?)\b|不|没有|无法|错误|失败|消失/i;

const MAX_QUERY_CHARS = 300;
const KB_MATCHES = 3;

/**
 * Whether the message reports something not working, rather than asking how
 * to set something up.
 * @internal exported for tests.
 */
export function isKbSymptom(text: string): boolean {
  return SYMPTOM.test(text);
}

/** The pack's best cards for a symptom, or undefined: no symptom, no pack, nothing above the threshold, or the pack cannot be read. */
export async function localKbMatches(
  text: string,
  source: KbIndexSource = sharedKbIndexSource(),
): Promise<KbToolResult | undefined> {
  if (!isKbSymptom(text)) return undefined;
  try {
    const result = kbToolResult(
      await source.current(),
      text.slice(0, MAX_QUERY_CHARS),
      { topK: KB_MATCHES, onePerCard: true },
    );
    return result.status === "stub" ||
      (result.status === "ok" && result.results.length > 0)
      ? result
      : undefined;
  } catch {
    return undefined;
  }
}
