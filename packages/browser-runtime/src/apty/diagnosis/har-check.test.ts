import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

(globalThis as { chrome?: unknown }).chrome = {
  runtime: { id: "agent" },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: settings.value })),
    },
    onChanged: { addListener: vi.fn() },
  },
};

import { resetRedactionModeForTests } from "../../runtime/redaction-mode";
import { capture, harEntriesOf, harOf } from "./diagnosis-test-utils";
import { readHar, runHarCheck, summarizeHar } from "./har-check";

beforeEach(() => {
  settings.value = { redactionMode: "strict", networkBodyCaptureDenyList: [] };
  resetRedactionModeForTests();
});

describe("readHar", () => {
  it("accepts a HAR and names a file that is too large, not JSON or not a HAR", () => {
    const har = JSON.stringify(harOf([]));

    expect(readHar(har)).toMatchObject({ ok: true });
    expect(readHar(har, 10)).toEqual({ ok: false, reason: "too-large" });
    expect(readHar("{not json")).toEqual({ ok: false, reason: "not-json" });
    expect(readHar('{"log":{}}')).toEqual({ ok: false, reason: "not-har" });
  });
});

describe("summarizeHar", () => {
  it("counts the calls and names the Apty files with a body, and no URL", () => {
    const har = harOf([
      ...harEntriesOf(capture()),
      {
        name: "workflow-0c000000-0000-7000-8000-000000000002.json",
        body: "[]",
      },
      { name: "analytics.json", body: "{}" },
      { name: "tooltip.json" },
    ]);

    const summary = summarizeHar(har);

    expect(summary).toMatchObject({ calls: 15, version: "5.x", hasPage: true });
    expect(summary.contentFiles).toContain(
      "workflow-0c000000-0000-7000-8000-000000000002.json",
    );
    expect(summary.contentFiles).not.toContain("analytics.json");
    expect(summary.contentFiles).toEqual([...summary.contentFiles].sort());
    expect(JSON.stringify(summary)).not.toMatch(/https?:|tenant-/);
  });

  it("tells a 4.x capture and one with no Apty files", () => {
    expect(
      summarizeHar(harOf(harEntriesOf(capture("content-4x")))).version,
    ).toBe("4.x");
    expect(summarizeHar(harOf([{ name: "app.js", body: "" }]))).toMatchObject({
      version: "none",
      contentFiles: [],
    });
  });
});

describe("runHarCheck", () => {
  it("runs the visibility check on the HAR's files", async () => {
    const result = await runHarCheck(harOf(harEntriesOf(capture())), {
      packId: "content-not-visible",
      kind: "workflow",
      query: "Take a tour",
    });

    expect(result.verdict.causes[0]?.ruleId).toBe("CNV-03");
  });

  it("runs the widget check against the page the HAR was recorded on", async () => {
    const result = await runHarCheck(
      harOf(harEntriesOf(capture()), "https://intranet.other.example/home"),
      { packId: "widget-not-visible" },
    );

    expect(result.packId).toBe("widget-not-visible");
    expect(result.verdict.causes[0]?.ruleId).toBe("WNV-02");
    expect(JSON.stringify(result)).not.toContain("intranet.other.example");
  });
});
