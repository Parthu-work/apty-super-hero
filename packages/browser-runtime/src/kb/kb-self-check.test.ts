import { describe, expect, it, vi } from "vitest";

const selfCheck = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@apty/agent-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@apty/agent-core")>();
  return {
    ...actual,
    kbSelfCheck: (...args: Parameters<typeof actual.kbSelfCheck>) => {
      selfCheck.calls += 1;
      return actual.kbSelfCheck(...args);
    },
  };
});

import { kbSelfCheck } from "@apty/agent-core";
import { createKbPackStore } from "../storage/kb-store.js";
import { createKbSelfCheckRunner } from "./kb-self-check.js";
import {
  FIXTURE_CARDS,
  fixturePackText,
  memoryRecords,
  unsignedAllowed,
  versionPackText,
} from "./kb-test-utils.js";

function store() {
  return createKbPackStore({
    assess: unsignedAllowed,
    records: memoryRecords(),
  });
}

describe("the self-check Options shows (KB-RAG K27, E9)", () => {
  it("reports the loaded pack's counts and failing ids, and nothing for a version with no pack", async () => {
    const packs = store();
    await packs.replace(fixturePackText(FIXTURE_CARDS));
    const run = createKbSelfCheckRunner(packs);
    const pack = await packs.load("5.x");
    if (!pack) throw new Error("no pack");
    const report = kbSelfCheck(pack);
    expect(await run("5.x")).toEqual({
      cards: report.cards,
      routing: report.routing,
      titles: report.titles,
      symptoms: report.symptoms,
      failingTitles: report.failingTitles,
    });
    expect(await run("4.x")).toBeNull();
  });

  it("runs once per pack, and again once the pack is replaced", async () => {
    const packs = store();
    await packs.replace(fixturePackText(FIXTURE_CARDS));
    const run = createKbSelfCheckRunner(packs);
    selfCheck.calls = 0;
    await run("5.x");
    await run("5.x");
    expect(selfCheck.calls).toBe(1);
    await packs.replace(versionPackText("5.x", FIXTURE_CARDS, "FY"));
    await run("5.x");
    expect(selfCheck.calls).toBe(2);
  });
});
