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
  versionSource?: "files" | "user" | "question" | "unknown";
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
  /** K26 (C4): the last DOM Config run held while the case was open. */
  domConfig?: CaseDomConfig;
  /** K27, R4: when the case got its first answer from a check or a KB card, and which. */
  firstVerdictAt?: string;
  firstVerdictRoute?: "check" | "kb";
}

/** A DOM Config run in a case: counts and the export's hash; the settings file only as the export holds it. */
export interface CaseDomConfig {
  runId: string;
  at: string;
  pages: number;
  rules: number;
  warnings: number;
  /** SHA-256 of the exported Apty settings file, once it was exported. */
  exportSha256?: string;
  /** The exported Apty settings file (`toAptyDomConfig`), at most 64 KB; it leaves only when the SE ticks it in a support bundle. */
  settingsFile?: string;
}

export const CASE_DOM_CONFIG_FILE_MAX = 64 * 1024;

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
    const route = turn.decision.route;
    if (!next.firstVerdictAt && (route === "check" || route === "kb")) {
      next.firstVerdictAt = turn.at;
      next.firstVerdictRoute = route;
    }
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

/** K27, E5: the SE's right-or-wrong mark on the case's finding, before the case closes. */
export function markFinding(
  record: CaseRecord,
  findingRight: NonNullable<CaseRecord["findingRight"]>,
  now: Date,
): CaseRecord {
  return { ...record, findingRight, updatedAt: now.toISOString() };
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

const SITE_KEY = /^site-[0-9a-f]{8}$/;

/**
 * A short key for a tab's host (K27, F4): a check or KB answer carries it
 * instead of the host, so the answer never holds the customer's address;
 * the panel matches it to a case's host on the device. A key stays as is.
 */
export function siteKeyOf(host: string): string {
  if (SITE_KEY.test(host)) return host;
  let hash = 0x811c9dc5;
  for (const char of host.toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `site-${hash.toString(16).padStart(8, "0")}`;
}

/** Whether two tab hosts, or site keys, are different sites; an unknown one matches any (K27, F4). */
export function otherSite(
  a: string | undefined,
  b: string | undefined,
): boolean {
  return a !== undefined && b !== undefined && siteKeyOf(a) !== siteKeyOf(b);
}

/**
 * The name the panel shows for `host` when site aliases are on (K27, F4):
 * `customer-a`, `customer-b`, … in the order the hosts were first seen in
 * `records` (oldest first); a host with no case yet takes the next letter.
 */
export function hostAlias(
  host: string,
  records: readonly Pick<CaseRecord, "tabHost" | "createdAt">[],
): string {
  const seen: string[] = [];
  for (const record of [...records].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )) {
    if (record.tabHost && !seen.includes(record.tabHost)) {
      seen.push(record.tabHost);
    }
  }
  const index = seen.includes(host) ? seen.indexOf(host) : seen.length;
  let name = "";
  for (let n = index; ; n = Math.floor(n / 26) - 1) {
    name = String.fromCharCode(97 + (n % 26)) + name;
    if (n < 26) break;
  }
  return `customer-${name}`;
}

/** K27, R4: the pilot's measures for one Apty version, from the device's cases and feedback. */
export interface PilotMeasures {
  version: "4.x" | "5.x" | "unknown";
  cases: number;
  /** Cases a KB card answered first. */
  kbAnswered: number;
  /** Cases a check answered first. */
  checkAnswered: number;
  /** Cases with a turn the KB did not cover, or closed as not covered. */
  notCovered: number;
  /** Wrong card reports. */
  wrongCard: number;
  resolved: number;
  escalated: number;
  /** Median seconds from the case's first message to its first verdict; null with none. */
  medianSecondsToVerdict: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return Math.round(value);
}

/**
 * Counts by version and outcome, and the median time to a first verdict
 * (K27, R4). Ids and numbers only; nothing here is sent anywhere.
 */
export function pilotMeasures(
  records: readonly CaseRecord[],
  wrongCards: readonly { aptyVersion?: string }[],
): PilotMeasures[] {
  const versions = ["4.x", "5.x", "unknown"] as const;
  const versionOf = (v: string | undefined) =>
    v === "4.x" || v === "5.x" ? v : "unknown";
  return versions
    .map((version) => {
      const cases = records.filter((r) => versionOf(r.aptyVersion) === version);
      const seconds = cases.flatMap((r) =>
        r.firstVerdictAt
          ? [
              (Date.parse(r.firstVerdictAt) - Date.parse(r.createdAt)) / 1000,
            ].filter((n) => Number.isFinite(n) && n >= 0)
          : [],
      );
      return {
        version,
        cases: cases.length,
        kbAnswered: cases.filter((r) => r.firstVerdictRoute === "kb").length,
        checkAnswered: cases.filter((r) => r.firstVerdictRoute === "check")
          .length,
        notCovered: cases.filter(
          (r) =>
            r.outcome === "not_covered" ||
            r.decisions.some((d) => d.kb?.kind === "not_covered"),
        ).length,
        wrongCard: wrongCards.filter(
          (w) => versionOf(w.aptyVersion) === version,
        ).length,
        resolved: cases.filter((r) => r.outcome === "resolved").length,
        escalated: cases.filter((r) => r.outcome === "escalated").length,
        medianSecondsToVerdict: median(seconds),
      };
    })
    .filter((m) => m.cases > 0 || m.wrongCard > 0);
}

/** The measures as CSV: a header row and one row per version, numbers only. */
export function pilotMeasuresCsv(measures: readonly PilotMeasures[]): string {
  const header = [
    "Apty version",
    "cases",
    "KB card answered",
    "check answered",
    "not covered",
    "wrong card",
    "resolved",
    "escalated",
    "median seconds to first verdict",
  ];
  const rows = measures.map((m) =>
    [
      m.version,
      m.cases,
      m.kbAnswered,
      m.checkAnswered,
      m.notCovered,
      m.wrongCard,
      m.resolved,
      m.escalated,
      m.medianSecondsToVerdict ?? "",
    ].join(","),
  );
  return `${[header.join(","), ...rows].join("\n")}\n`;
}
