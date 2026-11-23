import { describe, expect, it, vi } from "vitest";
import { createKbPackStore } from "../storage/kb-store.js";
import { createKbIndexSource } from "./kb-index.js";
import {
  kbAnswerOf,
  kbDecisionOf,
  localKbMatches as outcomeOf,
  renderedPageIds,
} from "./kb-matches.js";
import { unsignedAllowed } from "./kb-test-utils.js";

const localKbMatches = async (...args: Parameters<typeof outcomeOf>) =>
  kbAnswerOf(await outcomeOf(...args));

import {
  FIXTURE_CARDS,
  type FixtureCard,
  fixturePackText,
  fixtureV2PackText,
  memoryRecords,
  versionPackText,
} from "./kb-test-utils.js";

async function source(retrieval: Record<string, unknown> = {}) {
  const store = createKbPackStore({
    assess: unsignedAllowed,
    records: memoryRecords(),
  });
  await store.replace(fixturePackText(FIXTURE_CARDS, retrieval));
  return createKbIndexSource(store);
}

describe("localKbMatches", () => {
  it("returns the best card for a covered symptom, one chunk per card, at most 3", async () => {
    const result = await localKbMatches(
      "the tooltip opens twice",
      await source(),
    );
    expect(result?.status).toBe("ok");
    expect(result?.results[0]?.cite).toMatch(/^kb:\/\/202#L\d$/);
    const pages = result?.results.map((hit) => hit.cite.split("#")[0]);
    expect(new Set(pages).size).toBe(pages?.length);
    expect(result?.results.length).toBeLessThanOrEqual(3);
  });

  it("answers a covered question that names no symptom, such as a file's meaning", async () => {
    const result = await localKbMatches(
      "what does triggerCount in tooltip.json tell me",
      await source(),
    );
    expect(result?.results[0]?.cite).toBe("kb://202#L3");
  });

  it("shows the English-cards notice for a question mostly in another script, unless a model can take it", async () => {
    const kb = await source();
    expect(await localKbMatches("小部件没有显示", kb)).toEqual({
      status: "non_english",
      source: "kb",
      cards: [],
      results: [],
    });
    expect(
      await localKbMatches("小部件没有显示", kb, { modelAvailable: true }),
    ).toBeUndefined();
    const empty = createKbIndexSource(
      createKbPackStore({ assess: unsignedAllowed, records: memoryRecords() }),
    );
    expect(await localKbMatches("小部件没有显示", empty)).toBeUndefined();
  });

  it("shows a stub when only a card not written yet covers the symptom", async () => {
    const store = createKbPackStore({
      assess: unsignedAllowed,
      records: memoryRecords(),
    });
    await store.replace(fixtureV2PackText());
    const result = await localKbMatches(
      "the gadget export never finishes",
      createKbIndexSource(store),
    );
    expect(result).toMatchObject({
      status: "stub",
      stub: { cite: "kb://303" },
    });
  });

  it("answers nothing for a bare how-to, below the threshold, with no pack, or when the pack cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await localKbMatches("how do I set the Double Trigger", await source()),
    ).toBeUndefined();
    expect(
      await localKbMatches(
        "the tooltip opens twice",
        await source({ threshold: 1_000 }),
      ),
    ).toBeUndefined();
    const empty = createKbIndexSource(
      createKbPackStore({ assess: unsignedAllowed, records: memoryRecords() }),
    );
    expect(
      await localKbMatches("the tooltip opens twice", empty),
    ).toBeUndefined();
    const broken = {
      current: async () => {
        throw new Error("IndexedDB blocked");
      },
    };
    expect(
      await localKbMatches("the tooltip opens twice", broken),
    ).toBeUndefined();
  });
});

describe("every KB outcome is typed (KB-RAG K25, A2)", () => {
  it("answer: the result and the packs searched, by version and sha256 prefix", async () => {
    const outcome = await outcomeOf("the tooltip opens twice", await source());
    expect(outcome.kind).toBe("answer");
    if (outcome.kind !== "answer") return;
    expect(outcome.packs).toEqual([
      {
        version: "5.x",
        sha256: expect.stringMatching(/^[0-9a-f]{12}$/),
        keyId: null,
        expiresAt: null,
      },
    ]);
  });

  it("how_to: a bare how-to is left to the model with no line", async () => {
    expect(
      await outcomeOf("how do I set the Double Trigger", await source()),
    ).toEqual({ kind: "how_to" });
  });

  it("no_pack: no pack for the tab's version", async () => {
    const empty = createKbIndexSource(
      createKbPackStore({ assess: unsignedAllowed, records: memoryRecords() }),
    );
    expect(
      await outcomeOf("the tooltip opens twice", empty, { version: "4.x" }),
    ).toEqual({ kind: "no_pack", version: "4.x" });
  });

  it("not_covered: the reason, the coverage and the minimum, the closest card and the packs", async () => {
    const store = createKbPackStore({
      assess: unsignedAllowed,
      records: memoryRecords(),
    });
    await store.replace(fixtureV2PackText());
    const outcome = await outcomeOf(
      "the tooltip opens twice and the banner is red in the payroll app",
      createKbIndexSource(store),
      { version: "5.x" },
    );
    const fallback = await outcomeOf(
      "kubernetes helm chart rollout",
      createKbIndexSource(store),
      { version: "5.x" },
    );
    for (const result of [outcome, fallback].filter(
      (o) => o.kind === "not_covered",
    )) {
      expect(result).toMatchObject({
        kind: "not_covered",
        reason: expect.any(String),
        coverage: expect.any(Number),
        min: expect.any(Number),
        version: "5.x",
        packs: [{ version: "5.x" }],
      });
    }
    expect(fallback).toMatchObject({ kind: "not_covered", reason: "no_match" });
  });

  it("error: an exception inside the index source gives a code, and the console has the stack", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("IndexedDB blocked");
    const outcome = await outcomeOf("the tooltip opens twice", {
      current: async () => {
        throw failure;
      },
    });
    expect(outcome).toEqual({
      kind: "error",
      code: "pack_read_failed",
      message: "Error",
    });
    expect(log).toHaveBeenCalledWith("[kb] pack_read_failed", failure);
    log.mockRestore();
  });

  it("the decision holds ids, numbers and codes: never a chunk's words or the question", async () => {
    const question = "the tooltip opens twice";
    const outcome = await outcomeOf(question, await source());
    const record = JSON.stringify(kbDecisionOf(outcome));
    expect(record).not.toContain("tooltip");
    expect(record).not.toContain("Double Trigger");
    expect(kbDecisionOf(outcome)).toEqual({
      kind: "answer",
      status: "ok",
      pageIds: expect.arrayContaining(["202"]),
    });
  });
});

describe("a question the KB does not cover (KB-RAG K27, E7)", () => {
  it("names the closest cards by id, for the SE's suggestions, in the outcome and the decision", async () => {
    const store = createKbPackStore({
      assess: unsignedAllowed,
      records: memoryRecords(),
    });
    await store.replace(fixtureV2PackText());
    const outcome = await outcomeOf(
      "tooltip kubernetes helm rollout canary upgrade cluster",
      createKbIndexSource(store),
      { version: "5.x" },
    );
    expect(outcome).toMatchObject({
      kind: "not_covered",
      reason: "low_coverage",
      closestPageIds: ["202"],
    });
    expect(kbDecisionOf(outcome)).toMatchObject({
      kind: "not_covered",
      closestPageIds: ["202"],
    });
    expect(JSON.stringify(kbDecisionOf(outcome))).not.toContain("tooltip");
  });
});

describe("a setting no card has (KB-RAG K27, F2)", () => {
  it("is answered by the KB with the closest cards, by title and link only", async () => {
    const store = createKbPackStore({
      assess: unsignedAllowed,
      records: memoryRecords(),
    });
    await store.replace(fixtureV2PackText());
    const outcome = await outcomeOf(
      "the banner never glows after I turn on the FIXTURE Glow Pulse Switch",
      createKbIndexSource(store),
    );
    expect(outcome.kind).toBe("unknown_setting");
    if (outcome.kind !== "unknown_setting") return;
    expect(outcome.result).toMatchObject({
      status: "not_covered",
      reason: "unknown_setting",
      missingPhrases: ["FIXTURE Glow Pulse Switch"],
      results: [],
    });
    expect(outcome.result.closest?.[0]).toMatchObject({
      cite: "kb://101",
      title: "FIXTURE banner never glows",
    });
    expect(JSON.stringify(outcome.result.closest)).not.toMatch(/Studio/);
    expect(kbDecisionOf(outcome)).toMatchObject({
      kind: "not_covered",
      reason: "unknown_setting",
    });
  });
});

describe("the record holds what was shown (KB-RAG K27, F7)", () => {
  it("lists exactly the shown card ids, in their order", async () => {
    const outcome = await outcomeOf("the tooltip opens twice", await source());
    expect(outcome.kind).toBe("answer");
    if (outcome.kind !== "answer") return;
    const shown = outcome.result.results.map(
      (hit) => /^kb:\/\/(\d+)/.exec(hit.cite)?.[1],
    );
    expect(kbDecisionOf(outcome)).toMatchObject({ pageIds: shown });
    expect(
      renderedPageIds({
        status: "not_in_version",
        source: "kb",
        cards: [],
        absent: {
          cite: "kb://909",
          title: "FIXTURE",
          site: "s",
          space: "S",
          aptyVersion: "4.x",
          absentReason: null,
        },
        results: [{ cite: "kb://202#L1" } as never],
      }),
    ).toEqual(["909", "202"]);
  });
});

describe("choices are what the record holds (KB-RAG K27, E3)", () => {
  it("lists the choices' ids, not the cards behind them", () => {
    expect(
      renderedPageIds({
        status: "ok",
        source: "kb",
        cards: [{ pageId: "801" }],
        choices: {
          cite: "kb://800",
          title: "FIXTURE",
          options: [
            { cite: "kb://802", title: "FIXTURE b" },
            { cite: "kb://803", title: "FIXTURE c" },
          ],
        },
        results: [{ cite: "kb://801#L1" } as never],
      }),
    ).toEqual(["802", "803"]);
  });
});

describe("a named content file picks the version (KB-RAG K29, B3)", () => {
  const FLOWS_4X: FixtureCard = {
    pageId: "4401",
    title: "FIXTURE flow.json lists the flows",
    layers: [
      "- flow.json holds each FIXTURE flow and its segments.",
      "- Open flow.json in the FIXTURE network tab.",
      "- flow.json is read on every FIXTURE page load.",
      "- Contact support when flow.json is empty.",
    ],
  };
  const WORKFLOWS_5X: FixtureCard = {
    pageId: "5501",
    title: "FIXTURE workflow.json lists the workflows",
    layers: [
      "- workflow.json holds each FIXTURE workflow and its segments.",
      "- Open workflow.json in the FIXTURE network tab.",
      "- workflow.json is read on every FIXTURE page load.",
      "- Contact support when workflow.json is empty.",
    ],
  };
  const RELOAD_5X: FixtureCard = {
    pageId: "5502",
    title: "FIXTURE workflow stops after a reload",
    layers: [
      "- A FIXTURE workflow stops after the page reloads; check its meaning.",
      "- Watch the FIXTURE console during the reload.",
      "- The FIXTURE session request fails after a reload.",
      "- Contact support when the workflow still stops.",
    ],
  };

  async function twoVersions() {
    const store = createKbPackStore({
      assess: unsignedAllowed,
      records: memoryRecords(),
    });
    await store.replace(versionPackText("4.x", [FLOWS_4X], "A4X"));
    await store.replace(
      versionPackText("5.x", [WORKFLOWS_5X, RELOAD_5X], "A5X"),
    );
    return createKbIndexSource(store);
  }

  it("on a 5.x site, answers flow.json from the 4.x pack, says what the 5.x file is, and shows the 5.x card for it", async () => {
    const result = await localKbMatches(
      "what does flow.json mean",
      await twoVersions(),
      { version: "5.x" },
    );
    expect(result?.results[0]?.cite).toMatch(/^kb:\/\/4401#/);
    expect(result?.results.map((hit) => hit.cite.split("#")[0])).toEqual([
      "kb://4401",
      "kb://5501",
    ]);
    expect(result?.fileVersion).toEqual({
      file: "flow.json",
      version: "4.x",
      siteVersion: "5.x",
      counterpart: "workflow.json",
      kind: "workflows",
    });
    expect(result?.cards.map((card) => card.pageId)).toEqual(
      expect.arrayContaining(["4401", "5501"]),
    );
  });

  it("on a 4.x site or with the version unknown, answers from the 4.x pack with no line", async () => {
    for (const version of ["4.x", "unknown"] as const) {
      const result = await localKbMatches(
        "what does flow.json mean",
        await twoVersions(),
        { version },
      );
      expect(result?.results.map((hit) => hit.cite.split("#")[0])).toEqual([
        "kb://4401",
      ]);
      expect(result?.fileVersion).toBeUndefined();
    }
  });
});
