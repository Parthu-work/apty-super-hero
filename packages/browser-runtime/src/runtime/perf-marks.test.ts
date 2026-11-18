import { describe, expect, it } from "vitest";
import { measured, PERF } from "./perf-marks";

describe("measured (KB-RAG K27, R5)", () => {
  it("returns the result and records a measure under its name, also when it throws", async () => {
    performance.clearMeasures();
    expect(await measured(PERF.kbSearch, () => 42)).toBe(42);
    await expect(
      measured(PERF.kbIndexBuild, () => {
        throw new Error("FIXTURE");
      }),
    ).rejects.toThrow("FIXTURE");
    expect(performance.getEntriesByName(PERF.kbSearch)).toHaveLength(1);
    expect(performance.getEntriesByName(PERF.kbIndexBuild)).toHaveLength(1);
  });
});
