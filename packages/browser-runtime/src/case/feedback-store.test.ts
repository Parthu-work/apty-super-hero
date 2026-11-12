import { closeCase, newCase } from "@apty/agent-core";
import { describe, expect, it } from "vitest";
import { createCaseStore, memoryCaseRecords } from "../storage/case-store.js";
import {
  feedbackCsv,
  feedbackQuestions,
  recordOutcome,
  recordWrongCard,
} from "./feedback-store.js";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const store = () =>
  createCaseStore({ records: memoryCaseRecords(), now: () => NOW });
const record = () => ({
  ...newCase("conv", NOW, { random: () => 0 }),
  aptyVersion: "4.x" as const,
  decisions: [
    {
      at: NOW.toISOString(),
      route: "model" as const,
      version: "4.x" as const,
      versionSource: "user" as const,
      packs: [],
      kb: {
        kind: "not_covered" as const,
        reason: "low_coverage" as const,
        coverage: 0.42,
        min: 0.5,
        version: "4.x" as const,
      },
    },
  ],
});

describe("wrong-card feedback (KB-RAG K25, L3)", () => {
  it("a Wrong card mark writes a row with the case, version, pack, cards, outcome, coverage and reason", async () => {
    const cases = store();
    const row = await recordWrongCard(cases, {
      record: record(),
      shownCardId: "4002",
      shownLayer: 1,
      rightCardId: "4003",
      pack: {
        builtAt: "2026-11-01T00:00:00.000Z",
        sha256: "0123456789abcdef0123",
      },
      question: "the tour is gone for jane.doe@customer.example",
      now: NOW,
    });
    expect(row).toEqual({
      at: NOW.toISOString(),
      caseId: "CASE-20261112-0000",
      aptyVersion: "4.x",
      packBuilt: "2026-11-01",
      packSha256: "0123456789ab",
      shownCardId: "4002",
      shownLayer: 1,
      rightCardId: "4003",
      outcome: "open",
      coverage: 0.42,
      reason: "low_coverage",
      question: expect.not.stringContaining("jane.doe@customer.example"),
    });
    expect(await cases.feedback()).toHaveLength(1);
  });

  it("closing a case records its outcome and the SE's answer", async () => {
    const cases = store();
    const closed = closeCase(
      { ...record(), finding: { ruleId: "CNV-03", cardPageId: "4001" } },
      "resolved",
      NOW,
      { findingRight: "no", rightCardId: "4003" },
    );
    expect(await recordOutcome(cases, closed, NOW)).toMatchObject({
      caseId: "CASE-20261112-0000",
      shownCardId: "4001",
      rightCardId: "4003",
      outcome: "resolved",
    });
  });

  it("the tracking sheet has the exact columns, quotes what needs it, and never runs a formula", () => {
    const csv = feedbackCsv([
      {
        at: NOW.toISOString(),
        caseId: "CASE-1",
        aptyVersion: "4.x",
        packBuilt: "2026-11-01",
        shownCardId: "4002",
        shownLayer: 1,
        rightCardId: "4003",
        outcome: "resolved",
        coverage: 0.42,
        reason: "low_coverage",
        note: 'said "no", then =SUM(A1)',
      },
      { at: NOW.toISOString(), note: "=HYPERLINK()" },
    ]);
    expect(csv.split("\n")[0]).toBe(
      "date,case id,Apty version,pack built,card shown,right card,outcome,coverage,reason,note",
    );
    expect(csv.split("\n")[1]).toBe(
      '2026-11-12,CASE-1,4.x,2026-11-01,4002#L1,4003,resolved,0.42,low_coverage,"said ""no"", then =SUM(A1)"',
    );
    expect(csv.split("\n")[2]).toBe("2026-11-12,,,,,,,,,'=HYPERLINK()");
  });

  it("the kb:eval questions hold only included questions with a known right card", () => {
    const rows = [
      { at: "a", rightCardId: "4003", question: "the tour is gone" },
      { at: "b", rightCardId: "4004" },
      { at: "c", question: "no right card" },
    ];
    expect(feedbackQuestions(rows, { includeQuestions: false })).toEqual([]);
    expect(feedbackQuestions(rows, { includeQuestions: true })).toEqual([
      {
        id: "field-001",
        category: "field",
        q: "the tour is gone",
        expectedPageIds: ["4003"],
      },
    ]);
  });
});
