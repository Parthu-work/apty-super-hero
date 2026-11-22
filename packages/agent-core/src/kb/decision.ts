/**
 * What decided a chat turn (KB-RAG K25, A2): which route answered, the tab's
 * Apty version and how it was known, the packs searched and the KB's
 * outcome. Ids, numbers and codes only: never card text or the question.
 * Kept with the turn in the side panel; nothing sends it anywhere.
 */
import type { KbAptyVersion } from "./pack.js";
import type { KbNotCoveredReason } from "./search.js";

export type TurnRoute = "check" | "kb" | "file_fetch" | "model";
export type TabVersion = "4.x" | "5.x" | "unknown";
/** `question`: a content file the question named (KB-RAG K29, B3). */
export type TabVersionSource = "files" | "user" | "question" | "unknown";

/** A pack a search read: its version and the first 12 hex characters of its sha256. */
export interface DecisionPack {
  version: KbAptyVersion;
  sha256: string;
  keyId?: string | null;
  expiresAt?: string | null;
}

export type KbDecision =
  | { kind: "answer"; status: string; pageIds: string[] }
  | { kind: "how_to" }
  | { kind: "non_english" }
  | { kind: "no_pack"; version: TabVersion; delivery?: KbDeliveryFailure }
  | {
      kind: "not_covered";
      reason: KbNotCoveredReason;
      coverage: number;
      min: number;
      topPageId?: string;
      /** K27, E7: the cards offered to the SE as "closest, may not match". */
      closestPageIds?: string[];
      version: TabVersion;
    }
  | { kind: "error"; code: string }
  | {
      kind: "pack_unusable";
      reason:
        | "expired"
        | "not_yet_valid"
        | "unsigned"
        | "untrusted"
        | "revoked";
      version: KbAptyVersion;
      date: string | null;
      delivery?: KbDeliveryFailure;
    };

/** K26 (D4): the version's pack is delivered by the policy and its last check failed, with the outcome code. */
export interface KbDeliveryFailure {
  version: KbAptyVersion;
  outcome: string;
}

/** The first 12 hex characters of a pack's sha256: enough to tell packs apart in a report. */
export function packIdOf(sha256: string): string {
  return sha256.slice(0, 12);
}

export interface TurnDecision {
  route: TurnRoute;
  version: TabVersion;
  versionSource: TabVersionSource;
  packs: DecisionPack[];
  kb?: KbDecision;
  /** With `check`: the check pack that answered. */
  checkPackId?: string;
  /**
   * A model turn that explained the check results and KB cards already in
   * the conversation (K27, E6), under `KB_EXPLAIN_INSTRUCTION`.
   */
  grounding?: "conversation";
}

/**
 * Added to the system prompt of a model turn the KB returned no card for
 * (KB-RAG K27, F2): the model must not state an Apty fact it was not given.
 */
export const KB_NO_CARD_INSTRUCTION =
  "The Apty KB has no card for this. Do not describe Apty settings, menus, paths, prices or features. Say you do not know, and suggest the KB owner or Studio and Admin.";

/**
 * Added instead of `KB_NO_CARD_INSTRUCTION` to a model turn in a
 * conversation that already holds check results or KB cards (K27, E6): the
 * model explains them and asks the next question, and states no Apty fact
 * they do not hold. It names nothing: the results and card ids are already
 * in the history, and card text only when the KB egress filter lets it.
 */
export const KB_EXPLAIN_INSTRUCTION =
  "This conversation already holds Apty check results and KB cards. Use them to explain what was found, then ask the one next question that moves the problem forward. State an Apty setting, menu, path, price or feature only when a check result or KB card text you were given holds it. A card whose text was withheld is named by its id (kb://<id>), never described. For anything they do not cover, say you do not know, and suggest the KB owner or Studio and Admin.";
