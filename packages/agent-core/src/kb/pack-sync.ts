/**
 * What automatic KB pack delivery (KB-RAG K26, D2) records and how a check
 * ends: types and pure rules, shared by the fetcher in the browser and the
 * UI that shows its outcome.
 */
import type { KbPackSourceVersion } from "../config/org-policy.js";
import type { KbImportResult, KbReplaceStop } from "./pack.js";

type ImportRefusal = Extract<KbImportResult, { ok: false }>["code"];

/** How one check of one source ended; each has its own message in the UI. */
export type KbSyncOutcome =
  | "updated"
  | "unchanged"
  | "not_modified"
  | "older"
  | `http_${number}`
  | "network"
  | "timeout"
  | "wrong_type"
  | Exclude<ImportRefusal, KbReplaceStop | "read_failed">
  | KbReplaceStop;

/** What is kept per version under `sync:<version>`: no body, no query, no cookie. */
export interface KbSyncRecord {
  version: KbPackSourceVersion;
  /** The source's host, for Options; never its path or query. */
  host: string;
  lastCheckAt: string;
  lastSuccessAt?: string;
  etag?: string;
  lastModified?: string;
  outcome: KbSyncOutcome;
  httpStatus?: number;
  /** The stored pack's sha256 after this check. */
  sha256?: string;
  /** Failed checks in a row, for the backoff; 0 after a success. */
  failures: number;
}

/** One row of the send record for a pack request (D2 step 7). */
export interface KbSyncSendRow {
  at: string;
  version: KbPackSourceVersion;
  origin: string;
  status: number | null;
  outcome: KbSyncOutcome;
}

export interface KbSyncResult {
  version: KbPackSourceVersion;
  outcome: KbSyncOutcome | "deferred";
  httpStatus?: number;
}

export type KbSyncReason = "startup" | "alarm" | "manual";

export interface KbPackSync {
  /** Checks every sourced version, one sync at a time; a call during a sync joins it. */
  syncAll(options: { reason: KbSyncReason }): Promise<KbSyncResult[]>;
}

/** The outcomes after which the stored pack is the source's current one. */
const SUCCESS = new Set<KbSyncOutcome>([
  "updated",
  "unchanged",
  "not_modified",
]);

export function isKbSyncSuccess(outcome: KbSyncOutcome): boolean {
  return SUCCESS.has(outcome);
}

const BACKOFF_FIRST_MS = 5 * 60_000;
const HOUR_MS = 3_600_000;

/** How long a version waits after `failures` failed checks in a row: 5 minutes, doubling, capped at the check interval. */
export function kbSyncBackoffMs(failures: number, checkHours: number): number {
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_FIRST_MS * 2 ** (failures - 1), checkHours * HOUR_MS);
}
