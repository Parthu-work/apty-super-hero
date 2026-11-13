import { memoryRecords } from "@apty/browser-runtime/kb/kb-test-utils";
import { describe, expect, it } from "vitest";
import { createCaptureKeeper } from "./capture-keeper";

const CAPTURE = {
  applicationName: "FIXTURE app",
  pages: [{ pageId: "/orders", label: "/orders", runs: [] }],
};

describe("createCaptureKeeper (KB-RAG K26 C1)", () => {
  const at = (iso: string) => () => new Date(iso);

  it("keeps exactly what it is given, with when it was saved", async () => {
    const records = memoryRecords();
    const keeper = createCaptureKeeper({
      records,
      now: at("2026-11-13T10:00:00.000Z"),
      policy: async () => ({ kind: "none" }),
    });
    const kept = {
      capture: CAPTURE,
      outcome: null,
      coverageMarks: {},
      crawlMs: null,
      crawlOptions: null,
    };
    await keeper.save(kept as never);
    expect(await records.get("held")).toEqual({
      ...kept,
      savedAt: "2026-11-13T10:00:00.000Z",
    });
    expect(await keeper.load()).toMatchObject({ capture: CAPTURE });
  });

  it("deletes a capture past the policy's retention when it is read, and on discard", async () => {
    const records = memoryRecords();
    let now = "2026-11-13T10:00:00.000Z";
    const keeper = createCaptureKeeper({
      records,
      now: () => new Date(now),
      policy: async () => ({
        kind: "active",
        policy: { domConfigRetentionDays: 2 },
      }),
    });
    await keeper.save({ capture: CAPTURE } as never);
    now = "2026-11-15T09:59:00.000Z";
    expect(await keeper.load()).toBeDefined();
    now = "2026-11-15T10:01:00.000Z";
    expect(await keeper.load()).toBeUndefined();
    expect(await records.get("held")).toBeUndefined();

    await keeper.save({ capture: CAPTURE } as never);
    await keeper.discard();
    expect(await keeper.load()).toBeUndefined();
  });
});
