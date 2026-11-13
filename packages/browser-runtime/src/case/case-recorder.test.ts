import type { LocalAnswer, TurnDecision } from "@apty/agent-core";
import { describe, expect, it } from "vitest";
import { createCaseStore, memoryCaseRecords } from "../storage/case-store.js";
import { createCaseRecorder } from "./case-recorder.js";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const UNIQUE = "Zorblaxian";

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

const CHECK: LocalAnswer = {
  toolName: "run_diagnosis",
  params: { kind: "workflow" },
  result: {
    packId: "content-not-visible",
    cardPageId: "4001",
    verifiedOn: "from code",
    subject: { kind: "workflow", matched: [] },
    gates: [
      {
        id: "segment",
        status: "fail",
        ruleId: "CNV-03",
        reason: "hiddenFromWidget",
        params: {
          environment: "Production",
          mode: "Extension",
          clientVersion: "4.12.0",
        },
        detail: "FIXTURE detail",
        evidence: [`file body ${UNIQUE}`],
        cardPageId: "4001",
      },
    ],
    verdict: {
      status: "cause_found",
      headline: "FIXTURE",
      causes: [
        {
          ruleId: "CNV-03",
          cardPageId: "4001",
          params: {},
          summary: "s",
          fix: "f",
          evidence: [`body ${UNIQUE}`],
        },
      ],
    },
    confidence: "likely",
    files: [],
    notChecked: [],
  },
  transcript: "x",
  decision: decision("check"),
};

const KB: LocalAnswer = {
  toolName: "search_kb",
  params: { query: "q", topK: 3 },
  result: {
    status: "ok",
    source: "kb",
    cards: [{ pageId: "4002", layer: 1 }],
    results: [
      {
        cite: "kb://4002#L1",
        title: "FIXTURE",
        text: `- In Studio, turn on the ${UNIQUE} setting.`,
      },
    ],
  },
  transcript: `card text ${UNIQUE}`,
  decision: decision("kb", { kind: "answer", status: "ok", pageIds: ["4002"] }),
};

function recorderWith(
  store = createCaseStore({ records: memoryCaseRecords(), now: () => NOW }),
) {
  return createCaseRecorder({
    store,
    now: () => NOW,
    tabUrlOf: async () => "https://crm.customer-name.example/leads/42?id=7",
    random: () => 0,
  });
}

const ctx = { runContext: { conversationId: "conv-1", tabId: 3 } };

describe("the case recorder (KB-RAG K25, L1)", () => {
  it("starts on a symptom, a check or a KB card, and not on a how-to", async () => {
    const recorder = recorderWith();
    const howTo = recorder.wrap(async () => ({
      decision: decision("model", { kind: "how_to" }),
    }));
    await howTo("how do I configure the widget", ctx);
    expect(await recorder.current("conv-1")).toBeUndefined();

    const symptom = recorder.wrap(async () => ({
      decision: decision("model", {
        kind: "not_covered",
        reason: "low_coverage",
        coverage: 0.2,
        min: 0.5,
        version: "4.x",
      }),
    }));
    await symptom("the tooltip does not show on the page", ctx);
    expect((await recorder.current("conv-1"))?.id).toBe("CASE-20261112-0000");

    const fresh = recorderWith();
    await fresh.wrap(async () => CHECK)("hi", {
      runContext: { conversationId: "conv-2" },
    });
    expect(await fresh.current("conv-2")).toBeDefined();
    await fresh.wrap(async () => KB)("hi", {
      runContext: { conversationId: "conv-3" },
    });
    expect(await fresh.current("conv-3")).toBeDefined();
  });

  it("fills every field it can from a check and a KB answer, with no card text or file body", async () => {
    const store = createCaseStore({
      records: memoryCaseRecords(),
      now: () => NOW,
    });
    const recorder = recorderWith(store);
    await recorder.wrap(async () => CHECK)(
      "my workflow is not visible, email me at se@apty.example",
      ctx,
    );
    await recorder.wrap(async () => KB)("the tooltip opens twice", ctx);
    const record = await recorder.current("conv-1");
    expect(record).toMatchObject({
      tabHost: "crm.customer-name.example",
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
      finding: {
        ruleId: "CNV-03",
        cause: "hiddenFromWidget",
        cardPageId: "4001",
        confidence: "likely",
        verification: "from code, not runtime-verified",
      },
      kbShown: [
        {
          cards: [{ pageId: "4002", layer: 1 }],
          packs: [{ version: "4.x", sha256: "0123456789ab" }],
        },
      ],
      outcome: "open",
    });
    expect(record?.decisions).toHaveLength(2);
    expect(record?.symptom).not.toContain("se@apty.example");
    const stored = JSON.stringify(await store.list());
    expect(stored).not.toContain(UNIQUE);
    expect(stored).not.toContain("Studio");
  });

  it("does not record a local answer twice when the chat reports its result too, and takes a model's own check", async () => {
    const recorder = recorderWith();
    await recorder.wrap(async () => CHECK)("my workflow is not visible", ctx);
    await recorder.recordToolResult("conv-1", "run_diagnosis", CHECK.result);
    expect((await recorder.current("conv-1"))?.checks).toHaveLength(1);
    await recorder.recordToolResult(
      "conv-1",
      "run_diagnosis",
      structuredClone(CHECK.result),
    );
    expect((await recorder.current("conv-1"))?.checks).toHaveLength(2);
  });

  it("continues the case after the panel reloads, and closes it with the outcome", async () => {
    const records = memoryCaseRecords();
    const first = recorderWith(createCaseStore({ records, now: () => NOW }));
    await first.wrap(async () => CHECK)("my workflow is not visible", ctx);
    const id = (await first.current("conv-1"))?.id;

    const reloaded = recorderWith(createCaseStore({ records, now: () => NOW }));
    await reloaded.wrap(async () => KB)("the tooltip opens twice", ctx);
    const record = await reloaded.current("conv-1");
    expect(record?.id).toBe(id);
    expect(record?.checks).toHaveLength(1);

    const closed = await reloaded.close("conv-1", "resolved", {
      findingRight: "no",
      rightCardId: "4003",
    });
    expect(closed).toMatchObject({
      outcome: "resolved",
      findingRight: "no",
      rightCardId: "4003",
    });
  });
});

describe("DOM Config in a case (KB-RAG K26 C4)", () => {
  const RUN = {
    runId: "dc-1",
    at: NOW.toISOString(),
    pages: 4,
    rules: 7,
    warnings: 2,
  };

  it("records nothing without an open case", async () => {
    const recorder = recorderWith();
    await recorder.recordDomConfig("conv-1", RUN);
    expect(await recorder.current("conv-1")).toBeUndefined();
  });

  it("adds the run's counts to the open case, then the export's hash and file for the same run", async () => {
    const recorder = recorderWith();
    await recorder.wrap(async () => ({
      decision: decision("model", {
        kind: "not_covered",
        reason: "low_coverage",
        coverage: 0.1,
        min: 0.5,
        version: "5.x",
      }),
    }))("FIXTURE the tooltip never shows", ctx);
    await recorder.recordDomConfig("conv-1", RUN);
    expect((await recorder.current("conv-1"))?.domConfig).toEqual(RUN);
    await recorder.recordDomConfig("conv-1", {
      ...RUN,
      exportSha256: "a".repeat(64),
      settingsFile: '{"maxZIndex":null}',
    });
    expect((await recorder.current("conv-1"))?.domConfig).toEqual({
      ...RUN,
      exportSha256: "a".repeat(64),
      settingsFile: '{"maxZIndex":null}',
    });
    // A new run replaces the old one, file and hash included.
    await recorder.recordDomConfig("conv-1", { ...RUN, runId: "dc-2" });
    expect((await recorder.current("conv-1"))?.domConfig).toEqual({
      ...RUN,
      runId: "dc-2",
    });
  });
});
