import { describe, expect, it } from "vitest";
import { answerLookup, normalizedName, routeLookup } from "./lookup";
import type { ClientEvidence } from "./types";

const ok = (name: string, json: unknown) => ({
  name,
  status: "ok" as const,
  json,
});

const FIVE_X: ClientEvidence = {
  connection: { ok: true },
  observedNames: ["workflow.json", "segment.json", "app-urls.json"],
  envId: "env-e1",
  files: {
    "workflow.json": ok("workflow.json", [
      { sourceId: "wf-1", name: "Alpha Ledger Page", hideFromWidget: false },
      {
        sourceId: "wf-2",
        name: "Alpha Ledger Page Tour",
        hideFromWidget: true,
      },
      { sourceId: "wf-3", name: "Beta Intake", hideFromWidget: false },
    ]),
    "segment.json": ok("segment.json", [
      { id: "s-1", name: "All Users", isActive: true, workflowIds: ["wf-1"] },
      { id: "s-2", name: "Managers", isActive: false, workflowIds: ["wf-3"] },
    ]),
    "app-urls.json": ok("app-urls.json", [
      { environments: [{ id: "e1", name: "Production", order: 1 }] },
    ]),
  },
};

const FOUR_X: ClientEvidence = {
  connection: { ok: true },
  observedNames: ["flow.json", "segments.json", "rules.json"],
  files: {
    "flow.json": ok("flow.json", [
      { id: 11, name: { en: "Alpha Ledger Page" }, hideInWidget: false },
      { id: 12, name: { en: "Beta Intake" }, hideInWidget: 1 },
    ]),
    "segments.json": ok("segments.json", [
      { id: 21, name: "All Users", flows: [11] },
    ]),
  },
};

const GL =
  "check if Alpha Ledger Page workflow is present in all-users segment";

describe("routeLookup (KB-RAG K27, E4)", () => {
  it.each([
    [
      GL,
      { kind: "membership", item: "Alpha Ledger Page", segment: "all-users" },
    ],
    [
      'is workflow "Beta Intake" in segment Managers?',
      { kind: "membership", item: "Beta Intake", segment: "Managers" },
    ],
    ["show workflow Beta Intake", { kind: "show", item: "Beta Intake" }],
    ["which environment is this tab", { kind: "environment" }],
    ["which workflows are hidden from the widget?", { kind: "hidden" }],
  ])("%s", (message, expected) => {
    expect(routeLookup(message)).toEqual(expected);
  });

  it("leaves symptoms and how-tos alone", () => {
    for (const message of [
      "My workflow 'Take a tour' is not visible in the widget",
      "the tooltip flickers",
      "how do I add a workflow to a segment",
    ]) {
      expect(routeLookup(message), message).toBeUndefined();
    }
  });

  it("compares names ignoring case and punctuation", () => {
    expect(normalizedName("all-users")).toBe(normalizedName("All Users"));
  });
});

describe("answerLookup (KB-RAG K27, E4)", () => {
  it.each([
    ["5.x", FIVE_X, "workflow.json", "segment.json", "@yes"],
    ["4.x", FOUR_X, "flow.json", "segments.json", "@unknown"],
  ] as const)("%s: answers the General Ledger question in a table, from the files", (version, evidence, itemFile, segmentFile, on) => {
    const result = answerLookup(routeLookup(GL) as never, evidence);
    expect(result).toMatchObject({
      aptyVersion: version,
      status: "answered",
      source: "client",
      headline: '"Alpha Ledger Page" is in the "All Users" segment.',
      columns: ["workflow", "segment", "listed", "segmentOn"],
      rows: [["Alpha Ledger Page", "All Users", "@yes", on]],
      files: [itemFile, segmentFile],
    });
  });

  it("says when the workflow is not listed, and names the segment as the files spell it", () => {
    const result = answerLookup(
      { kind: "membership", item: "beta intake", segment: "all_users" },
      FIVE_X,
    );
    expect(result.headline).toBe(
      '"Beta Intake" is not in the "All Users" segment.',
    );
  });

  it("asks one question when two workflows match, and never guesses when none does", () => {
    const two = answerLookup({ kind: "show", item: "Alpha Ledger" }, FIVE_X);
    expect(two).toMatchObject({
      status: "ambiguous",
      ask: {
        what: "workflow",
        options: ["Alpha Ledger Page", "Alpha Ledger Page Tour"],
      },
    });
    const none = answerLookup(
      { kind: "membership", item: "Gamma", segment: "All Users" },
      FIVE_X,
    );
    expect(none).toMatchObject({
      status: "not_found",
      headline: 'No workflow named "Gamma" is in workflow.json.',
      rows: [],
    });
  });

  it("lists the workflows hidden from the widget, and the environment, in each version", () => {
    expect(answerLookup({ kind: "hidden" }, FIVE_X).rows).toEqual([
      ["Alpha Ledger Page Tour", "wf-2"],
    ]);
    expect(answerLookup({ kind: "hidden" }, FOUR_X).rows).toEqual([
      ["Beta Intake", "12"],
    ]);
    expect(answerLookup({ kind: "environment" }, FIVE_X)).toMatchObject({
      status: "answered",
      rows: [["Production", "e1"]],
    });
    expect(answerLookup({ kind: "environment" }, FOUR_X).status).toBe(
      "not_found",
    );
  });

  it("says the file could not be read rather than answer without it", () => {
    const missing = answerLookup(
      { kind: "show", item: "Beta Intake" },
      { ...FIVE_X, files: {} },
    );
    expect(missing).toMatchObject({ status: "no_files", rows: [] });
  });
});
