import { describe, expect, it } from "vitest";
import { parseOrgPolicy } from "../config/org-policy.js";
import type { TurnDecision } from "../kb/decision.js";
import {
  caseExpired,
  caseToContinue,
  closeCase,
  newCase,
  newCaseId,
  turnStartsCase,
  withTurn,
} from "./case.js";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const decision = (
  route: TurnDecision["route"],
  kb?: TurnDecision["kb"],
): TurnDecision => ({
  route,
  version: "4.x",
  versionSource: "files",
  packs: [{ version: "4.x", sha256: "0123456789ab" }],
  ...(kb ? { kb } : {}),
});

describe("case ids (KB-RAG K25, L1)", () => {
  it("is CASE-<yyyymmdd>-<4 base32 characters>", () => {
    expect(newCaseId(NOW, () => 0)).toBe("CASE-20261112-0000");
    expect(newCaseId(NOW, () => 0.999)).toBe("CASE-20261112-ZZZZ");
    expect(newCaseId(NOW)).toMatch(/^CASE-20261112-[0-9A-HJKMNP-TV-Z]{4}$/);
  });
});

describe("when a case starts", () => {
  it("on a check, a KB card or a symptom; not on a how-to or a casual message", () => {
    expect(turnStartsCase(decision("check"), false)).toBe(true);
    expect(turnStartsCase(decision("kb"), false)).toBe(true);
    expect(
      turnStartsCase(
        decision("model", {
          kind: "not_covered",
          reason: "low_coverage",
          coverage: 0.2,
          min: 0.5,
          version: "4.x",
        }),
        true,
      ),
    ).toBe(true);
    expect(turnStartsCase(decision("model", { kind: "how_to" }), true)).toBe(
      false,
    );
    expect(
      turnStartsCase(
        decision("model", { kind: "no_pack", version: "4.x" }),
        false,
      ),
    ).toBe(false);
    expect(turnStartsCase(undefined, false)).toBe(false);
  });
});

describe("withTurn", () => {
  it("fills every field from a check run and a KB answer, keeping the first symptom", () => {
    let record = newCase("conv-1", NOW, {
      tabHost: "crm.example.com",
      random: () => 0,
    });
    record = withTurn(record, {
      at: "2026-11-12T10:01:00.000Z",
      decision: decision("check"),
      symptom: "the FIXTURE tour is not visible",
      check: {
        packId: "content-not-visible",
        at: "2026-11-12T10:01:00.000Z",
        status: "cause_found",
        ruleIds: ["CNV-03"],
        finding: {
          ruleId: "CNV-03",
          cause: "hiddenFromWidget",
          cardPageId: "4001",
          confidence: "likely",
          verification: "from code, not runtime-verified",
        },
        mode: "Extension",
        environment: "Production",
        clientVersion: "4.12.0",
      },
    });
    record = withTurn(record, {
      at: "2026-11-12T10:02:00.000Z",
      decision: decision("kb", {
        kind: "answer",
        status: "ok",
        pageIds: ["4002"],
      }),
      symptom: "a later message",
      kb: {
        cards: [{ pageId: "4002", layer: 1 }],
        status: "ok",
        packs: [{ version: "4.x", sha256: "0123456789ab" }],
      },
    });
    expect(record).toMatchObject({
      id: "CASE-20261112-0000",
      conversationId: "conv-1",
      tabHost: "crm.example.com",
      symptom: "the FIXTURE tour is not visible",
      aptyVersion: "4.x",
      versionSource: "files",
      mode: "Extension",
      environment: "Production",
      clientVersion: "4.12.0",
      checks: [
        {
          packId: "content-not-visible",
          status: "cause_found",
          ruleIds: ["CNV-03"],
        },
      ],
      finding: { ruleId: "CNV-03", cardPageId: "4001" },
      kbShown: [{ cards: [{ pageId: "4002", layer: 1 }] }],
      outcome: "open",
      updatedAt: "2026-11-12T10:02:00.000Z",
    });
    expect(record.decisions).toHaveLength(2);
  });

  it("cuts a symptom to 300 characters", () => {
    const record = withTurn(newCase("c", NOW), {
      at: NOW.toISOString(),
      symptom: "x".repeat(400),
    });
    expect(record.symptom).toHaveLength(300);
  });
});

describe("closing, retention and continuity", () => {
  it("closes with the outcome, the SE's answers and a note of at most 1,000 characters", () => {
    const closed = closeCase(newCase("c", NOW), "resolved", NOW, {
      findingRight: "no",
      rightCardId: "4003",
      note: "n".repeat(1200),
    });
    expect(closed).toMatchObject({
      outcome: "resolved",
      closedAt: NOW.toISOString(),
      findingRight: "no",
      rightCardId: "4003",
    });
    expect(closed.note).toHaveLength(1000);
    expect(
      closeCase(newCase("c", NOW), "escalated", NOW, {
        rightCardId: "not an id",
      }).rightCardId,
    ).toBeUndefined();
  });

  it("expires a case not updated for more than the retention days", () => {
    expect(
      caseExpired({ updatedAt: "2026-08-13T10:01:00.000Z" }, NOW, 91),
    ).toBe(false);
    expect(
      caseExpired({ updatedAt: "2026-08-13T10:01:00.000Z" }, NOW, 90),
    ).toBe(true);
  });

  it("offers the newest open case on the same host from the last 24 hours, not this conversation's", () => {
    const open = {
      ...newCase("a", NOW, { tabHost: "crm.example.com" }),
      updatedAt: "2026-11-12T08:00:00.000Z",
    };
    const older = {
      ...open,
      id: "CASE-old",
      updatedAt: "2026-11-11T09:00:00.000Z",
    };
    const closed = { ...open, id: "CASE-closed", outcome: "resolved" as const };
    expect(
      caseToContinue([older, closed, open], "crm.example.com", NOW)?.id,
    ).toBe(open.id);
    expect(caseToContinue([open], "crm.example.com", NOW, "a")).toBeUndefined();
    expect(caseToContinue([open], "other.example.com", NOW)).toBeUndefined();
  });

  it("caseRetentionDays is a policy key from 1 to 365", () => {
    expect(parseOrgPolicy({ caseRetentionDays: 30 })).toEqual({
      ok: true,
      policy: { caseRetentionDays: 30 },
    });
    expect(parseOrgPolicy({ caseRetentionDays: 0 }).ok).toBe(false);
    expect(parseOrgPolicy({ caseRetentionDays: 400 }).ok).toBe(false);
  });
});
