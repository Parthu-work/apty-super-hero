/**
 * The KB matches card (KB-RAG K6, K16): for any message no check pack
 * claims, the loaded pack's best cards, one chunk each, answered with no
 * model call when the pack covers it (or a stub when only a card not yet
 * written does). A bare "how do I configure X" with no symptom is not a KB
 * question (D-KB1): it is left to the model. A question mostly outside the Latin
 * script cannot match the English cards: with no model to take it, the
 * user is told so.
 */
import {
  type KbIndexSource,
  type KbTabVersion,
  type KbToolResult,
  kbToolResult,
  sharedKbIndexSource,
} from "./kb-index.js";
import { isBareHowTo, isMostlyNonLatin } from "./kb-intent.js";

const MAX_QUERY_CHARS = 300;
const KB_MATCHES = 3;

export interface KbMatchesOptions {
  /** A model is configured, so a question the cards cannot match goes to it. */
  modelAvailable?: boolean;
  /** The tab's Apty version: its pack and the common cards, or every pack when unknown. */
  version?: KbTabVersion;
}

/** The pack's best cards, a stub, the English-cards notice, or undefined: a bare how-to, no pack, not covered, or the pack cannot be read. */
export async function localKbMatches(
  text: string,
  source: KbIndexSource = sharedKbIndexSource(),
  { modelAvailable = false, version = "unknown" }: KbMatchesOptions = {},
): Promise<KbToolResult | undefined> {
  if (isBareHowTo(text)) return undefined;
  try {
    const index = await source.current(version);
    if (!index) return undefined;
    if (isMostlyNonLatin(text)) {
      return modelAvailable
        ? undefined
        : { status: "non_english", results: [] };
    }
    const result = kbToolResult(index, text.slice(0, MAX_QUERY_CHARS), {
      topK: KB_MATCHES,
      onePerCard: true,
    });
    return result.status === "stub" ||
      (result.status === "ok" && result.results.length > 0)
      ? result
      : undefined;
  } catch {
    return undefined;
  }
}
