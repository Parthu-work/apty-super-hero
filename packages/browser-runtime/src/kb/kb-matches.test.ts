import { describe, expect, it } from "vitest";
import { createKbPackStore } from "../storage/kb-store.js";
import { createKbIndexSource } from "./kb-index.js";
import { isKbSymptom, localKbMatches } from "./kb-matches.js";
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

describe("isKbSymptom", () => {
  it("is true for something not working, false for a bare how-to (D-KB1)", () => {
    for (const text of [
      "the banner doesn't glow",
      "the tooltip opens twice",
      "the survey is blank for French users",
      "the launcher stopped working after the release",
      "横幅不发光",
    ]) {
      expect(isKbSymptom(text), text).toBe(true);
    }
    for (const text of [
      "how do I configure the banner glow",
      "how to set up a tooltip",
      "what is a segment",
    ]) {
      expect(isKbSymptom(text), text).toBe(false);
    }
  });
});

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
