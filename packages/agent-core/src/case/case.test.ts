import { describe, expect, it } from "vitest";
import { parseOrgPolicy } from "../config/org-policy.js";
import type { TurnDecision } from "../kb/decision.js";
import {
  type CaseRecord,
  caseExpired,
  caseToContinue,
  closeCase,
  hostAlias,
  markFinding,
  newCase,
  newCaseId,
  otherSite,
  pilotMeasures,
  pilotMeasuresCsv,
  siteKeyOf,
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

  it("marks an open case's finding right or wrong before it closes, and closing keeps the mark (K27, E5)", () => {
    const later = new Date("2026-11-12T11:00:00.000Z");
    const marked = markFinding(newCase("c", NOW), "no", later);
    expect(marked).toMatchObject({
      outcome: "open",
      findingRight: "no",
      updatedAt: later.toISOString(),
    });
    expect(closeCase(marked, "resolved", later).findingRight).toBe("no");
    expect(
      closeCase(marked, "resolved", later, { findingRight: "yes" })
        .findingRight,
    ).toBe("yes");
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

describe("sites (KB-RAG K27, F4)", () => {
  const at = (day: number, tabHost?: string) => ({
    createdAt: `2026-11-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    ...(tabHost ? { tabHost } : {}),
  });

  it("names hosts customer-a, customer-b in the order first seen, and a new one the next letter", () => {
    const records = [at(3, "two.example.com"), at(1, "one.example.com"), at(5)];
    expect(hostAlias("one.example.com", records)).toBe("customer-a");
    expect(hostAlias("two.example.com", records)).toBe("customer-b");
    expect(hostAlias("three.example.com", records)).toBe("customer-c");
    const many = Array.from({ length: 27 }, (_, i) =>
      at(1, `h${String(i).padStart(2, "0")}.example.com`),
    );
    expect(hostAlias("h26.example.com", many)).toBe("customer-aa");
  });

  it("treats an unknown host as the same site, and a host and its key as one", () => {
    expect(otherSite("a.example.com", "b.example.com")).toBe(true);
    expect(otherSite("a.example.com", "a.example.com")).toBe(false);
    expect(otherSite(undefined, "b.example.com")).toBe(false);
    const key = siteKeyOf("a.example.com");
    expect(key).toMatch(/^site-[0-9a-f]{8}$/);
    expect(key).not.toContain("example");
    expect(siteKeyOf(key)).toBe(key);
    expect(otherSite("A.example.com", key)).toBe(false);
    expect(otherSite("b.example.com", key)).toBe(true);
  });
});

describe("pilot measures (KB-RAG K27, R4)", () => {
  const at = (minutes: number) =>
    new Date(Date.UTC(2026, 10, 12, 10, minutes)).toISOString();
  const caseWith = (
    id: string,
    version: "4.x" | "5.x",
    route: "check" | "kb" | "model",
    verdictMinute: number,
    outcome: CaseRecord["outcome"] = "open",
  ): CaseRecord => {
    const start = newCase(id, new Date(at(0)), { random: () => 0 });
    const turned = withTurn(start, {
      at: at(verdictMinute),
      decision: {
        route,
        version,
        versionSource: "files",
        packs: [],
        ...(route === "model"
          ? {
              kb: {
                kind: "not_covered" as const,
                reason: "no_match" as const,
                coverage: 0,
                min: 0.5,
                version,
              },
            }
          : {}),
      },
    });
    return { ...turned, id, outcome };
  };

  it("records the first verdict once, with its route, and never from the model", () => {
    const first = caseWith("c1", "4.x", "kb", 2);
    expect(first).toMatchObject({
      firstVerdictAt: at(2),
      firstVerdictRoute: "kb",
    });
    const later = withTurn(first, {
      at: at(5),
      decision: {
        route: "check",
        version: "4.x",
        versionSource: "files",
        packs: [],
      },
    });
    expect(later.firstVerdictAt).toBe(at(2));
    expect(caseWith("c2", "4.x", "model", 1).firstVerdictAt).toBeUndefined();
  });

  it("counts by version and outcome and takes the median time to a first verdict", () => {
    const measures = pilotMeasures(
      [
        caseWith("a", "4.x", "kb", 1, "resolved"),
        caseWith("b", "4.x", "check", 3, "escalated"),
        caseWith("c", "4.x", "kb", 10),
        caseWith("d", "4.x", "model", 1, "not_covered"),
        caseWith("e", "5.x", "kb", 2),
      ],
      [{ aptyVersion: "4.x" }, { aptyVersion: "5.x" }, { aptyVersion: "5.x" }],
    );
    expect(measures).toEqual([
      {
        version: "4.x",
        cases: 4,
        kbAnswered: 2,
        checkAnswered: 1,
        notCovered: 1,
        wrongCard: 1,
        resolved: 1,
        escalated: 1,
        medianSecondsToVerdict: 180,
      },
      {
        version: "5.x",
        cases: 1,
        kbAnswered: 1,
        checkAnswered: 0,
        notCovered: 0,
        wrongCard: 2,
        resolved: 0,
        escalated: 0,
        medianSecondsToVerdict: 120,
      },
    ]);
    const csv = pilotMeasuresCsv(measures);
    expect(csv.split("\n")[0]).toBe(
      "Apty version,cases,KB card answered,check answered,not covered,wrong card,resolved,escalated,median seconds to first verdict",
    );
    expect(csv).toContain("4.x,4,2,1,1,1,1,1,180");
  });
});
