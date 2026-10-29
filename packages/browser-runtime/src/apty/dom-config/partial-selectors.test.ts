import { describe, expect, it } from "vitest";
import {
  analyze,
  profile,
  run,
  type Values,
  values,
} from "./__tests__/fixtures";
import type { AnalyzedPage } from "./classify";
import { derivePartialSelectors } from "./partial-selectors";

function twoRuns(
  first: Record<string, Values>,
  second: Record<string, Values>,
  pageId = "p1",
): AnalyzedPage {
  const result = analyze(
    [run("initial", profile(first)), run("after-reload", profile(second))],
    pageId,
  );
  return {
    pageId,
    label: pageId,
    runs: result.flats,
    diff: result.diff,
    classified: result.classified,
  };
}

/** Apty's compiled partial function: capture group 1, else the whole match. */
function keep(pattern: string, value: string): string | null {
  const match = value.match(new RegExp(pattern));
  return match ? (match[1] ?? match[0]) : null;
}

describe("derivePartialSelectors", () => {
  it("strips a window counter that changes on every load and keeps the part that names the control", () => {
    const [rule, ...rest] = derivePartialSelectors([
      twoRuns(
        { id: values("win3-save-button", "win3-cancel-button") },
        { id: values("win7-save-button", "win7-cancel-button") },
      ),
    ]);

    expect(rest).toEqual([]);
    expect(rule).toMatchObject({
      attribute: "id",
      pattern: "^win\\d+(.+)$",
      keeps: "end",
      elementCount: 2,
      exampleParts: ["-cancel-button", "-save-button"],
    });
    expect(keep(rule!.pattern, "win12-save-button")).toBe("-save-button");
  });

  it("keeps a middle part when a counter changes on both sides of it", () => {
    const [rule] = derivePartialSelectors([
      twoRuns(
        { id: values("w1-grid-pono-n3", "w1-grid-item-n3") },
        { id: values("w4-grid-pono-n9", "w4-grid-item-n9") },
      ),
    ]);

    expect(rule).toMatchObject({ keeps: "middle" });
    expect(keep(rule!.pattern, "w8-grid-pono-n2")).toBe("-grid-pono-n");
  });

  it("keeps everything of a frame src before its cache buster, a narrower starts-with condition than Apty's own example", () => {
    const [rule] = derivePartialSelectors([
      twoRuns(
        {
          src: values("/app?frame=orders&t=1729", "/app?frame=invoices&t=1729"),
        },
        {
          src: values("/app?frame=orders&t=1730", "/app?frame=invoices&t=1730"),
        },
      ),
    ]);

    expect(rule).toMatchObject({ attribute: "src", keeps: "start" });
    expect(keep(rule!.pattern, "/app?frame=orders&t=99")).toBe(
      "/app?frame=orders&t=",
    );
  });

  it("writes nothing when the numbers are the identity, as with generated ids", () => {
    expect(
      derivePartialSelectors([
        twoRuns(
          { id: values("ui-id-1", "ui-id-2") },
          { id: values("ui-id-3", "ui-id-4") },
        ),
      ]),
    ).toEqual([]);
  });

  it("writes nothing for a single element, which cannot show which part tells elements apart", () => {
    expect(
      derivePartialSelectors([
        twoRuns({ id: values("win3-save") }, { id: values("win7-save") }),
      ]),
    ).toEqual([]);
  });

  it("writes nothing from a page captured once", () => {
    const once = analyze([
      run("initial", profile({ id: values("win3-save", "win3-close") })),
    ]);
    expect(
      derivePartialSelectors([
        {
          pageId: "p1",
          label: "p1",
          runs: once.flats,
          diff: once.diff,
          classified: once.classified,
        },
      ]),
    ).toEqual([]);
  });

  it("never copies a constant part that is not identifier-shaped into the pattern", () => {
    expect(
      derivePartialSelectors([
        twoRuns(
          { "data-k": values("Jane Doe 3 a", "Jane Doe 3 b") },
          { "data-k": values("Jane Doe 4 a", "Jane Doe 4 b") },
        ),
      ]).map((r) => r.pattern),
    ).not.toContainEqual(expect.stringContaining("Jane"));
  });

  it("merges the same pattern found on several pages", () => {
    const pageOf = (id: string) =>
      twoRuns(
        { id: values("win3-save-button", "win3-cancel-button") },
        { id: values("win7-save-button", "win7-cancel-button") },
        id,
      );
    const rules = derivePartialSelectors([pageOf("p1"), pageOf("p2")]);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.pages).toEqual(["p1", "p2"]);
  });

  it("counts stable values the pattern also fits", () => {
    const [rule] = derivePartialSelectors([
      twoRuns(
        { id: values("win3-save-button", "win3-cancel-button", "win1-header") },
        { id: values("win7-save-button", "win7-cancel-button", "win1-header") },
      ),
    ]);
    expect(rule!.stableMatches).toBe(1);
  });

  it("never reads class, style or value", () => {
    expect(
      derivePartialSelectors([
        twoRuns(
          { value: values("w3-a", "w3-b") },
          { value: values("w4-a", "w4-b") },
        ),
      ]),
    ).toEqual([]);
  });
});
