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
export type TabVersionSource = "files" | "user" | "unknown";

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
}
