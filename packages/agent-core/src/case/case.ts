/**
 * A case for every debugging session (KB-RAG K25, L1): one record per
 * conversation of what was asked, which version and checks, what was found
 * and shown, and how it ended. Pure; the store and the recorder live in the
 * browser runtime. A record holds ids, numbers, codes and the SE's own
 * Strict-redacted symptom: never KB card text, file bodies or screenshots.
 */
import type { TurnDecision } from "../kb/decision.js";

export type CaseOutcome =
  | "open"
  | "resolved"
  | "escalated"
  | "not_covered"
  | "abandoned";

export const CASE_OUTCOMES: readonly CaseOutcome[] = [
  "open",
  "resolved",
  "escalated",
  "not_covered",
  "abandoned",
];

/** One check run in the case: the pack, when, its verdict status and the rules that fired. */
export interface CaseCheck {
  packId: string;
  at: string;
  status: string;
  ruleIds: string[];
}

export interface CaseFinding {
  ruleId: string;
  /** The cause's key: the rule's own summary key, never card text. */
  cause?: string;
  cardPageId?: string;
  confidence?: string;
  /** "from code, not runtime-verified" or "NOT VERIFIED". */
  verification?: string;
}

/** KB cards shown in the case: ids and layers, with the pack's version and sha256 prefix. */
export interface CaseKbShown {
  at: string;
  cards: Array<{ pageId: string; layer?: number }>;
  status: string;
  packs: Array<{ version: string; sha256: string }>;
}

export interface CaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  conversationId: string;
  /** The tab's host, on the device only (a support bundle names its origin without the customer part, L2). */
  tabHost?: string;
  /** The SE's first symptom message, Strict-redacted, at most 300 characters. */
  symptom?: string;
  aptyVersion?: "4.x" | "5.x" | "unknown";
  versionSource?: "files" | "user" | "unknown";
  mode?: string;
  environment?: string;
  clientVersion?: string;
  checks: CaseCheck[];
  finding?: CaseFinding;
  kbShown: CaseKbShown[];
  decisions: Array<TurnDecision & { at: string }>;
  outcome: CaseOutcome;
  /** L3: whether the finding was right, and which card was, when the SE said so. */
  findingRight?: "yes" | "partly" | "no";
  rightCardId?: string;
  /** The SE's own note, at most 1,000 characters. */
  note?: string;
}

export const CASE_SYMPTOM_MAX = 300;
export const CASE_NOTE_MAX = 1000;
export const CASE_RETENTION_DAYS = { default: 90, min: 1, max: 365 } as const;
/** A case still open on a host within this long is offered to continue. */
export const CASE_CONTINUE_HOURS = 24;

/** Crockford base32: no I, L, O or U. */
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** `CASE-<yyyymmdd>-<4 base32 characters>`. */
export function newCaseId(now: Date, random: () => number = Math.random) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  let tail = "";
  for (let i = 0; i < 4; i++) {
    tail += BASE32[Math.floor(random() * BASE32.length) % BASE32.length];
  }
  return `CASE-${day}-${tail}`;
}

/**
 * Whether a turn opens a case: it ran a check, showed a KB card, or the
 * message names a symptom. A plain how-to (D-KB1) or a casual message does
 * not.
 */
export function turnStartsCase(
  decision: TurnDecision | undefined,
  symptom: boolean,
): boolean {
  if (!decision) return symptom;
  if (decision.route === "check") return true;
  if (decision.route === "kb") return true;
  if (decision.kb?.kind === "how_to") return false;
  return symptom;
}

/** What a turn adds to the case. */
export interface CaseTurn {
  at: string;
  decision?: TurnDecision;
  /** The SE's message, already Strict-redacted; kept only as the first symptom. */
  symptom?: string;
  check?: CaseCheck & {
    finding?: CaseFinding;
    mode?: string;
    environment?: string;
    clientVersion?: string;
  };
  kb?: Omit<CaseKbShown, "at">;
}

/** The case after `turn`: never shortens what was recorded, and keeps the first symptom. */
export function withTurn(record: CaseRecord, turn: CaseTurn): CaseRecord {
  const next: CaseRecord = { ...record, updatedAt: turn.at };
  if (!next.symptom && turn.symptom) {
    next.symptom = turn.symptom.slice(0, CASE_SYMPTOM_MAX);
  }
  if (turn.decision) {
    next.decisions = [...record.decisions, { ...turn.decision, at: turn.at }];
    if (turn.decision.version !== "unknown" || !next.aptyVersion) {
      next.aptyVersion = turn.decision.version;
      next.versionSource = turn.decision.versionSource;
    }
  }
  if (turn.check) {
    const { finding, mode, environment, clientVersion, ...check } = turn.check;
    next.checks = [...record.checks, check];
    if (finding) next.finding = finding;
    if (mode) next.mode = mode;
    if (environment) next.environment = environment;
    if (clientVersion) next.clientVersion = clientVersion;
  }
  if (turn.kb && turn.kb.cards.length > 0) {
    next.kbShown = [...record.kbShown, { ...turn.kb, at: turn.at }];
  }
  return next;
}

/** A new case for a conversation. */
export function newCase(
  conversationId: string,
  now: Date,
  { tabHost, random }: { tabHost?: string; random?: () => number } = {},
): CaseRecord {
  const at = now.toISOString();
  return {
    id: newCaseId(now, random),
    createdAt: at,
    updatedAt: at,
    conversationId,
    ...(tabHost ? { tabHost } : {}),
    checks: [],
    kbShown: [],
    decisions: [],
    outcome: "open",
  };
}

/** The case closed with `outcome`, and the SE's answers when given. */
export function closeCase(
  record: CaseRecord,
  outcome: Exclude<CaseOutcome, "open">,
  now: Date,
  {
    findingRight,
    rightCardId,
    note,
  }: Pick<CaseRecord, "findingRight" | "rightCardId" | "note"> = {},
): CaseRecord {
  const at = now.toISOString();
  return {
    ...record,
    outcome,
    closedAt: at,
    updatedAt: at,
    ...(findingRight ? { findingRight } : {}),
    ...(rightCardId && /^\d+$/.test(rightCardId) ? { rightCardId } : {}),
    ...(note ? { note: note.slice(0, CASE_NOTE_MAX) } : {}),
  };
}

/** Whether a case is past its retention: last updated more than `days` ago. */
export function caseExpired(
  record: Pick<CaseRecord, "updatedAt">,
  now: Date,
  days: number,
): boolean {
  const updated = Date.parse(record.updatedAt);
  return Number.isNaN(updated) || now.getTime() - updated > days * 86_400_000;
}

/** The open case on `host` updated within the last 24 hours, newest first, to offer to continue. */
export function caseToContinue(
  records: readonly CaseRecord[],
  host: string | undefined,
  now: Date,
  exceptConversationId?: string,
): CaseRecord | undefined {
  if (!host) return undefined;
  return records
    .filter(
      (record) =>
        record.outcome === "open" &&
        record.tabHost === host &&
        record.conversationId !== exceptConversationId &&
        now.getTime() - Date.parse(record.updatedAt) <=
          CASE_CONTINUE_HOURS * 3_600_000,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
