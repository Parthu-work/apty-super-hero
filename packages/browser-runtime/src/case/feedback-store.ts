/**
 * Wrong-card feedback and case outcomes for the KB owner (KB-RAG K25, L3):
 * each row holds ids, numbers and codes; the SE's question only Strict-
 * redacted, and exported only when they tick "Include my question". Kept
 * in apty-cases-db on this device; the exports are files the SE reviews,
 * then copies or downloads. Nothing is sent.
 */
import type { CaseRecord } from "@apty/agent-core";
import { redactTextStrict } from "../runtime/redaction-mode.js";
import type { CaseStore, FeedbackRow } from "../storage/case-store.js";

/** The pack a card came from, as the row names it. */
export interface FeedbackPack {
  builtAt: string;
  sha256: string;
}

/** A Wrong card mark on a KB matches hit or a verdict excerpt. */
export async function recordWrongCard(
  store: CaseStore,
  {
    record,
    shownCardId,
    shownLayer,
    rightCardId,
    aptyVersion,
    pack,
    question,
    now = new Date(),
  }: {
    record?: CaseRecord;
    shownCardId: string;
    shownLayer?: number;
    rightCardId?: string;
    aptyVersion?: string;
    pack?: FeedbackPack;
    question?: string;
    now?: Date;
  },
): Promise<FeedbackRow> {
  const kb = [...(record?.decisions ?? [])].reverse().find((d) => d.kb)?.kb;
  const row: FeedbackRow = {
    at: now.toISOString(),
    ...(record ? { caseId: record.id } : {}),
    ...(aptyVersion || record?.aptyVersion
      ? { aptyVersion: aptyVersion ?? record?.aptyVersion }
      : {}),
    ...(pack
      ? {
          packBuilt: pack.builtAt.slice(0, 10),
          packSha256: pack.sha256.slice(0, 12),
        }
      : {}),
    shownCardId,
    ...(shownLayer ? { shownLayer } : {}),
    ...(rightCardId && /^\d+$/.test(rightCardId) ? { rightCardId } : {}),
    ...(record ? { outcome: record.outcome } : {}),
    ...(kb?.kind === "not_covered"
      ? { coverage: kb.coverage, reason: kb.reason }
      : {}),
    ...(question ? { question: redactTextStrict(question).slice(0, 300) } : {}),
  };
  await store.addFeedback(row);
  return row;
}

/** A closed case's answer: whether the finding was right, and which card was. */
export async function recordOutcome(
  store: CaseStore,
  record: CaseRecord,
  now = new Date(),
): Promise<FeedbackRow> {
  const row: FeedbackRow = {
    at: now.toISOString(),
    caseId: record.id,
    ...(record.aptyVersion ? { aptyVersion: record.aptyVersion } : {}),
    ...(record.finding?.cardPageId
      ? { shownCardId: record.finding.cardPageId }
      : {}),
    ...(record.rightCardId ? { rightCardId: record.rightCardId } : {}),
    outcome: record.outcome,
    ...(record.note
      ? { note: redactTextStrict(record.note).slice(0, 1000) }
      : {}),
  };
  await store.addFeedback(row);
  return row;
}

const CSV_COLUMNS = [
  "date",
  "case id",
  "Apty version",
  "pack built",
  "card shown",
  "right card",
  "outcome",
  "coverage",
  "reason",
  "note",
] as const;

function csvCell(value: string | number | undefined): string {
  const text = value === undefined ? "" : String(value);
  // A leading =, +, - or @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The tracking sheet: one row per feedback entry, in time order. */
export function feedbackCsv(rows: readonly FeedbackRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.at.slice(0, 10),
        row.caseId,
        row.aptyVersion,
        row.packBuilt,
        row.shownCardId
          ? `${row.shownCardId}${row.shownLayer ? `#L${row.shownLayer}` : ""}`
          : undefined,
        row.rightCardId,
        row.outcome,
        row.coverage,
        row.reason,
        row.note,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Questions for kb:eval: entries whose right card is known and whose question the SE included. */
export function feedbackQuestions(
  rows: readonly FeedbackRow[],
  { includeQuestions }: { includeQuestions: boolean },
): Array<{
  id: string;
  category: "field";
  q: string;
  expectedPageIds: string[];
}> {
  if (!includeQuestions) return [];
  return rows
    .filter((row) => row.rightCardId && row.question)
    .map((row, i) => ({
      id: `field-${String(i + 1).padStart(3, "0")}`,
      category: "field" as const,
      q: row.question as string,
      expectedPageIds: [row.rightCardId as string],
    }));
}
