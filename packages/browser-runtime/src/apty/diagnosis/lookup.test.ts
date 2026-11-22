import { describe, expect, it } from "vitest";
import {
  answerLookup,
  lookupTranscript,
  normalizedName,
  routeLookup,
} from "./lookup";
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
      ask: { what: "workflow" },
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

const M = {
  kind: "membership",
  item: "Alpha Ledger Page",
  segment: "All Users",
};

describe("routeLookup: how SEs ask (KB-RAG K28, F1)", () => {
  it.each([
    ["is Alpha Ledger Page in All Users segment", M],
    ["is Alpha Ledger Page workflow in All Users", M],
    ["does the Alpha Ledger Page workflow belong to the All Users segment", M],
    ["is the Alpha Ledger Page workflow assigned to All Users", M],
    ["is Alpha Ledger Page part of the All Users segment", M],
    ["does the All Users segment include Alpha Ledger Page", M],
    ["does All Users segment contain the Alpha Ledger Page workflow", M],
    ["is workflow Alpha Ledger Page visible to the All Users segment", M],
    [
      "check if Alpha Ledger Page is present in the all users segment",
      { ...M, segment: "all users" },
    ],
    [
      "from flows.json check if Alpha Ledger Page is present in All Users Segment in segments.json",
      M,
    ],
    [
      "which workflows are in All Users",
      { kind: "segmentMembers", segment: "All Users" },
    ],
    [
      "list the workflows in the All Users segment",
      { kind: "segmentMembers", segment: "All Users" },
    ],
    [
      "which segments is Alpha Ledger Page workflow in",
      { kind: "itemSegments", item: "Alpha Ledger Page" },
    ],
    [
      "show me the Alpha Ledger Page workflow",
      { kind: "show", item: "Alpha Ledger Page" },
    ],
    ["show Alpha Ledger Page", { kind: "show", item: "Alpha Ledger Page" }],
    [
      "get the Alpha Ledger Page workflow entry",
      { kind: "show", item: "Alpha Ledger Page" },
    ],
    ["what environment am I on", { kind: "environment" }],
    ["which environment is the Apty client using", { kind: "environment" }],
    ["list hidden workflows", { kind: "hidden" }],
    ["which workflows are not visible in the widget", { kind: "hidden" }],
    [
      "is the workflow Alpha Ledger Page hidden from the widget",
      { kind: "hidden", item: "Alpha Ledger Page" },
    ],
  ])("%s", (message, expected) => {
    expect(routeLookup(message)).toEqual(expected);
  });

  it.each([
    "what does flow.json mean",
    "get flow.json",
    "workflow not working",
    "how do I add a workflow to a segment",
    "the tooltip balloon flickers",
    "workflow is published but not showing in the widget",
    "is the widget visible to all users in the segment",
    "where is the Widget Activation toggle",
    "show me the console errors",
    "get the data from segments.json in the apty client and summarize it",
    "get segments.json from the apty client again and summarize it",
    "find the save button on this page",
    "Show me the chart",
    "Show thinking details",
    "Show earlier messages",
    "Show sites as customer-a, customer-b",
    "show alpha ledger page",
    "open the network tab",
    "show me everything on this page",
    "get flows.json and show the first entry",
    "is Sign in in All Users",
  ])("leaves %s to the model", (message) => {
    expect(routeLookup(message)).toBeUndefined();
  });

  it.each([
    [
      "is Sign in workflow in All Users segment",
      { kind: "membership", item: "Sign in", segment: "All Users" },
    ],
    [
      "is Order in Progress in the All Users segment?",
      { kind: "membership", item: "Order in Progress", segment: "All Users" },
    ],
    [
      'is "Order in Progress" in "Sign in Users"',
      {
        kind: "membership",
        item: "Order in Progress",
        segment: "Sign in Users",
      },
    ],
    [
      "which segments is the Sign in workflow in",
      { kind: "itemSegments", item: "Sign in" },
    ],
  ])("keeps names that hold 'in': %s", (message, expected) => {
    expect(routeLookup(message)).toEqual(expected);
  });

  it.each([
    [
      "Sign in workflow in All Users segment",
      { kind: "membership", item: "Sign in", segment: "All Users" },
    ],
    [
      "the Order in Progress workflow in the All Users segment",
      { kind: "membership", item: "Order in Progress", segment: "All Users" },
    ],
  ])("routes a statement naming both a workflow and a segment (KB-RAG K29, B8): %s", (message, expected) => {
    expect(routeLookup(message)).toEqual(expected);
  });

  it.each([
    "Sign in in All Users",
    "Sign in workflow in All Users",
    "workflow in the segment",
  ])("leaves a statement without both markers to the model (KB-RAG K29, B8): %s", (message) => {
    expect(routeLookup(message)).toBeUndefined();
  });

  it("names a missing Client or an unknown version in words, never 'the Apty unknown content files' (KB-RAG K29, B8)", () => {
    const question = routeLookup(
      "is Alpha Ledger Page in All Users segment",
    ) as never;
    const noClient = answerLookup(question, {
      connection: { ok: false, failure: "no_receiver", message: "none" },
      observedNames: [],
      files: {},
    });
    expect(lookupTranscript(noClient).split("\n")[0]).toMatch(
      /^Lookup: the Apty Client is not connected\./,
    );
    const unknown = answerLookup(question, {
      connection: { ok: true },
      observedNames: ["app-urls.json"],
      files: {},
    });
    expect(lookupTranscript(unknown).split("\n")[0]).toMatch(
      /^Lookup: the Apty version is not known\./,
    );
    for (const result of [noClient, unknown]) {
      expect(lookupTranscript(result)).not.toMatch(/Apty unknown/);
    }
  });

  it("answers the new kinds from the files", () => {
    expect(
      answerLookup(
        routeLookup("which workflows are in All Users") as never,
        FIVE_X,
      ),
    ).toMatchObject({
      status: "answered",
      headline: 'The "All Users" segment lists 1 workflow.',
      rows: [["Alpha Ledger Page", "wf-1"]],
    });
    expect(
      answerLookup(
        routeLookup("which segments is Beta Intake workflow in") as never,
        FIVE_X,
      ),
    ).toMatchObject({
      status: "answered",
      columns: ["segment", "id", "segmentOn"],
      rows: [["Managers", "s-2", "@no"]],
    });
    expect(
      answerLookup(
        routeLookup(
          "is the workflow Alpha Ledger Page Tour hidden from the widget",
        ) as never,
        FIVE_X,
      ),
    ).toMatchObject({
      headline: '"Alpha Ledger Page Tour" is hidden from the widget.',
      rows: [["Alpha Ledger Page Tour", "wf-2", "@yes"]],
    });
  });
});

describe("answerLookup: what is really missing (KB-RAG K28, F3)", () => {
  const SHARED_ONLY = { observedNames: ["app-urls.json"] };

  it("answers from the 4.x files when the version is unknown", () => {
    const result = answerLookup(routeLookup(GL) as never, {
      ...FOUR_X,
      ...SHARED_ONLY,
    });
    expect(result).toMatchObject({
      aptyVersion: "4.x",
      status: "answered",
      files: ["flow.json", "segments.json"],
    });
  });

  it("asks once which version when both or neither version's files are present", () => {
    const both = answerLookup(
      { kind: "show", item: "Beta Intake" },
      {
        ...FIVE_X,
        ...SHARED_ONLY,
        files: { ...FIVE_X.files, ...FOUR_X.files },
      },
    );
    expect(both).toMatchObject({
      status: "ambiguous",
      headline: "Which Apty version does this tenant run?",
      ask: { what: "version" },
    });
    expect(both.ask?.options.map((o) => o.answer.aptyVersion)).toEqual([
      "4.x",
      "5.x",
    ]);
    expect(both.ask?.options[0]?.answer.status).toBe("answered");
  });

  it("says in words that the Client is not connected, and offers the evidence route", () => {
    const result = answerLookup(routeLookup(GL) as never, {
      connection: { ok: false, failure: "no_client", message: "x" },
      observedNames: [],
      files: {},
    });
    expect(result).toMatchObject({
      status: "no_files",
      headline:
        "The Apty Client is not connected, so its content files cannot be read.",
      offerEvidence: true,
    });
  });

  it("says a file was not reported yet, and keeps 'could not be read' for a failed request", () => {
    const unreported = answerLookup(
      { kind: "show", item: "Beta Intake" },
      { ...FIVE_X, files: {} },
    );
    expect(unreported).toMatchObject({
      status: "no_files",
      headline: "The Apty Client has not reported workflow.json yet.",
      offerEvidence: true,
    });
    const failed = answerLookup(
      { kind: "show", item: "Beta Intake" },
      {
        ...FIVE_X,
        files: {
          "workflow.json": {
            name: "workflow.json",
            status: "http_error",
            httpStatus: 403,
          },
        },
      },
    );
    expect(failed.headline).toBe(
      "workflow.json could not be read (http_error 403).",
    );
    expect(failed.offerEvidence).toBeUndefined();
  });
});

describe("answerLookup: choices the SE can tell apart (KB-RAG K28, F2)", () => {
  const TWO_MANAGERS: ClientEvidence = {
    ...FIVE_X,
    files: {
      ...FIVE_X.files,
      "segment.json": ok("segment.json", [
        { id: "s-2", name: "Managers", isActive: false, workflowIds: ["wf-3"] },
        {
          id: "s-3",
          name: "Managers",
          isActive: true,
          workflowIds: ["wf-1", "wf-3"],
        },
      ]),
    },
  };

  it("labels same-named segments by id, state and size, and answers for the one picked", () => {
    const result = answerLookup(
      { kind: "membership", item: "Alpha Ledger Page", segment: "Managers" },
      TWO_MANAGERS,
    );
    const labels = result.ask?.options.map((o) => o.label);
    expect(labels).toEqual([
      "Managers (s-2, inactive, 1 workflow)",
      "Managers (s-3, active, 2 workflows)",
    ]);
    expect(new Set(labels).size).toBe(2);
    expect(result.ask?.options[0]?.answer.headline).toBe(
      '"Alpha Ledger Page" is not in the "Managers" segment.',
    );
    expect(result.ask?.options[1]?.answer.headline).toBe(
      '"Alpha Ledger Page" is in the "Managers" segment.',
    );
    expect(lookupTranscript(result)).toContain(
      "Ask the user which segment: Managers (s-2, inactive, 1 workflow); Managers (s-3, active, 2 workflows).",
    );
  });

  it("labels same-named workflows by id and whether they are hidden", () => {
    const result = answerLookup({ kind: "show", item: "Alpha Ledger" }, FIVE_X);
    expect(result.ask?.options.map((o) => o.label)).toEqual([
      "Alpha Ledger Page (wf-1)",
      "Alpha Ledger Page Tour (wf-2, hidden)",
    ]);
  });
});
