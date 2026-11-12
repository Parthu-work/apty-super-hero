import { describe, expect, it, vi } from "vitest";
import { createKbPackStore } from "../storage/kb-store.js";
import { createKbIndexSource } from "./kb-index.js";
import {
  kbAnswerOf,
  kbDecisionOf,
  localKbMatches as outcomeOf,
} from "./kb-matches.js";

const localKbMatches = async (...args: Parameters<typeof outcomeOf>) =>
  kbAnswerOf(await outcomeOf(...args));

import {
  FIXTURE_CARDS,
  fixturePackText,
  fixtureV2PackText,
  memoryRecords,
} from "./kb-test-utils.js";

async function source(retrieval: Record<string, unknown> = {}) {
  const store = createKbPackStore({ records: memoryRecords() });
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
      createKbPackStore({ records: memoryRecords() }),
    );
    expect(await localKbMatches("小部件没有显示", empty)).toBeUndefined();
  });

  it("shows a stub when only a card not written yet covers the symptom", async () => {
    const store = createKbPackStore({ records: memoryRecords() });
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
      createKbPackStore({ records: memoryRecords() }),
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
      { version: "5.x", sha256: expect.stringMatching(/^[0-9a-f]{12}$/) },
    ]);
  });

  it("how_to: a bare how-to is left to the model with no line", async () => {
    expect(
      await outcomeOf("how do I set the Double Trigger", await source()),
    ).toEqual({ kind: "how_to" });
  });

  it("no_pack: no pack for the tab's version", async () => {
    const empty = createKbIndexSource(
      createKbPackStore({ records: memoryRecords() }),
    );
    expect(
      await outcomeOf("the tooltip opens twice", empty, { version: "4.x" }),
    ).toEqual({ kind: "no_pack", version: "4.x" });
  });

  it("not_covered: the reason, the coverage and the minimum, the closest card and the packs", async () => {
    const store = createKbPackStore({ records: memoryRecords() });
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
