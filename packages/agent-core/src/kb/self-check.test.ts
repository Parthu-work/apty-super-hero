import { describe, expect, it } from "vitest";
import { syntheticPack } from "./kb-test-utils.js";
import { kbSelfCheck, kbSelfCheckSummary } from "./self-check.js";

const layers = (topic: string): [string, string, string, string] => [
  `FIXTURE ${topic} studio toggle checks for the ${topic} rule`,
  `FIXTURE ${topic} element selector checks on the ${topic} page`,
  `FIXTURE ${topic} network payload checks for the ${topic} request`,
  `FIXTURE ${topic} support escalation for the ${topic} case`,
];

const PACK = syntheticPack(
  [
    {
      pageId: "9101",
      title: "Quokka banner does not render",
      layers: layers("quokka banner"),
      symptom: "The quokka banner never renders on the page",
    },
    {
      pageId: "9102",
      title: "Narwhal launcher opens twice",
      layers: layers("narwhal launcher"),
    },
    {
      pageId: "9103",
      title: "Start here: FIXTURE routing",
      status: "routing",
    },
    {
      pageId: "9104",
      title: "What is it for",
      layers: layers("zebrafish tooltip"),
    },
  ],
  {},
  { schemaVersion: 2 },
);

describe("the pack self-check (KB-RAG K27, E9)", () => {
  it("asks each card's title and symptom line, leaving routing cards out", () => {
    const report = kbSelfCheck(PACK);
    expect(report.cards).toBe(4);
    expect(report.routing).toBe(1);
    expect(report.titles.of).toBe(3);
    expect(report.symptoms.of).toBe(1);
    expect(report.queries.map((q) => q.pageId)).not.toContain("9103");
  });

  it("names the titles that do not find their own card in the top 3", () => {
    const report = kbSelfCheck(PACK);
    expect(report.failingTitles).toEqual(["9104"]);
    expect(report.titles.top3).toBe(2);
    expect(report.symptoms.top3).toBe(1);
  });

  it("is deterministic, and its summary holds counts and ids only", () => {
    const report = kbSelfCheck(PACK);
    expect(kbSelfCheck(PACK)).toEqual(report);
    const summary = kbSelfCheckSummary(report);
    expect(summary).toEqual({
      cards: 4,
      routing: 1,
      titles: report.titles,
      symptoms: report.symptoms,
      failingTitles: ["9104"],
    });
    expect(JSON.stringify(summary)).not.toMatch(
      /quokka|narwhal|zebrafish|what is it/i,
    );
  });
});
