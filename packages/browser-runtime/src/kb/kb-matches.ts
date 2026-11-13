/**
 * The KB matches card (KB-RAG K6, K16): for any message no check pack
 * claims, the loaded pack's best cards, one chunk each, answered with no
 * model call when the pack covers it (or a stub when only a card not yet
 * written does). A bare "how do I configure X" with no symptom is not a KB
 * question (D-KB1): it is left to the model. A question mostly outside the
 * Latin script cannot match the English cards: with no model to take it,
 * the user is told so.
 *
 * Every search ends in a typed outcome (KB-RAG K25, A2), so the chat can
 * say why no card was shown: no pack, not covered with its numbers, or an
 * error with its code. Nothing is swallowed.
 */
import { type KbDecision, kbSourceTag, packIdOf } from "@apty/agent-core";
import {
  type KbIndexSource,
  type KbTabVersion,
  type KbToolResult,
  type KbUnusablePack,
  kbToolResultOf,
  sharedKbIndexSource,
  unusablePackOf,
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

/** A pack a search read: its version and sha256 prefix. */
export interface KbSearchedPack {
  version: string;
  sha256: string;
  keyId?: string | null;
  expiresAt?: string | null;
}

export type KbOutcome =
  | { kind: "answer"; result: KbToolResult; packs: KbSearchedPack[] }
  | { kind: "how_to" }
  | { kind: "non_english" }
  | { kind: "no_pack"; version: KbTabVersion }
  | {
      kind: "not_covered";
      reason: NonNullable<KbToolResult["reason"]>;
      coverage: number;
      min: number;
      topPageId?: string;
      version: KbTabVersion;
      packs: KbSearchedPack[];
    }
  | {
      kind: "error";
      code: "pack_read_failed" | "search_failed";
      message: string;
    }
  | {
      kind: "pack_unusable";
      reason: KbUnusablePack["reason"];
      version: KbUnusablePack["aptyVersion"];
      date: string | null;
    };

function failed(
  code: "pack_read_failed" | "search_failed",
  error: unknown,
): KbOutcome {
  console.error(`[kb] ${code}`, error);
  return {
    kind: "error",
    code,
    message: error instanceof Error ? error.name : "Error",
  };
}

/** The pack's best cards, a stub, the English-cards notice, or why there is no card. */
export async function localKbMatches(
  text: string,
  source: KbIndexSource = sharedKbIndexSource(),
  { modelAvailable = false, version = "unknown" }: KbMatchesOptions = {},
): Promise<KbOutcome> {
  if (isBareHowTo(text)) return { kind: "how_to" };
  let index: Awaited<ReturnType<KbIndexSource["current"]>>;
  try {
    index = await source.current(version);
  } catch (error) {
    return failed("pack_read_failed", error);
  }
  if (!index) {
    let blocked: KbUnusablePack | undefined;
    try {
      blocked = unusablePackOf((await source.unusable?.(version)) ?? []);
    } catch (error) {
      return failed("pack_read_failed", error);
    }
    return blocked
      ? {
          kind: "pack_unusable",
          reason: blocked.reason,
          version: blocked.aptyVersion,
          date: blocked.date,
        }
      : { kind: "no_pack", version };
  }
  const packs = index.info.packs.map((pack) => ({
    version: pack.aptyVersion,
    sha256: packIdOf(pack.sha256),
    keyId: pack.keyId,
    expiresAt: pack.expiresAt,
  }));
  if (isMostlyNonLatin(text)) {
    return modelAvailable
      ? { kind: "non_english" }
      : {
          kind: "answer",
          result: { status: "non_english", ...kbSourceTag([]), results: [] },
          packs,
        };
  }
  try {
    const query = text.slice(0, MAX_QUERY_CHARS);
    const found = index.search(query, { topK: KB_MATCHES, onePerCard: true });
    const result = kbToolResultOf(found);
    if (
      result.status === "stub" ||
      result.status === "not_in_version" ||
      (result.status === "ok" && result.results.length > 0)
    ) {
      return { kind: "answer", result, packs };
    }
    return {
      kind: "not_covered",
      reason: found.reason ?? "no_match",
      coverage: Math.round(found.coverage * 100) / 100,
      min: found.min ?? 0,
      ...(found.topPageId ? { topPageId: found.topPageId } : {}),
      version,
      packs,
    };
  } catch (error) {
    return failed("search_failed", error);
  }
}

/** The outcome's answer, when it has one. */
export function kbAnswerOf(outcome: KbOutcome): KbToolResult | undefined {
  return outcome.kind === "answer" ? outcome.result : undefined;
}

/** The outcome as the decision record holds it: ids, numbers and codes only. */
export function kbDecisionOf(outcome: KbOutcome): KbDecision {
  switch (outcome.kind) {
    case "answer":
      return {
        kind: "answer",
        status: outcome.result.status,
        pageIds: outcome.result.cards.map((card) => card.pageId),
      };
    case "not_covered":
      return {
        kind: "not_covered",
        reason: outcome.reason,
        coverage: outcome.coverage,
        min: outcome.min,
        ...(outcome.topPageId ? { topPageId: outcome.topPageId } : {}),
        version: outcome.version,
      };
    case "error":
      return { kind: "error", code: outcome.code };
    default:
      return outcome;
  }
}
