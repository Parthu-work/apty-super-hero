import { describe, expect, it } from "vitest";
import {
  analyze,
  profile,
  run,
  type Values,
  values,
} from "./__tests__/fixtures";
import type { AnalyzedPage } from "./classify";
import {
  deriveAttributePriority,
  deriveDebounce,
  deriveIgnoreEvents,
  deriveMaxZIndex,
  deriveShadowDom,
} from "./derive-settings";
import { noisePolicy } from "./noise";
import type { BehaviorProbe, DomProfileV2, ProfileRun } from "./types";

function pageOf(runs: ProfileRun[], pageId = "p1"): AnalyzedPage {
  const { flats, diff, classified } = analyze(runs, pageId);
  return { pageId, label: pageId, runs: flats, diff, classified };
}

function stablePage(
  attributes: Record<string, Values>,
  extra: Partial<DomProfileV2> = {},
  pageId = "p1",
) {
  return pageOf(
    [
      run("initial", profile(attributes, extra)),
      run("after-reload", profile(attributes, extra)),
    ],
    pageId,
  );
}

function probe(partial: Partial<BehaviorProbe>): BehaviorProbe {
  return {
    ran: true,
    windowMs: 3000,
    mutationBursts: [],
    burstGapsMs: [],
    eventRates: {},
    ranToCompletion: true,
    ...partial,
  };
}

describe("deriveAttributePriority", () => {
  it("orders test attributes, id, name, then the rest by uniqueness, capped at six", () => {
    const priority = deriveAttributePriority(
      [
        stablePage({
          "data-testid": values("save", "cancel"),
          name: values(["q", 2]),
          id: values("a", "b"),
          "data-ref": values(["grid", 3], "x"),
          placeholder: values("Search", "Name"),
          role: values(["button", 4]),
          "col-id": values("patientName", "provider"),
          type: values(["text", 9]),
          value: values("typed by a person"),
          "aria-label": values("Save"),
          width: values("100%"),
          "data-myki-field": values("1"),
        }),
      ],
      noisePolicy(),
    );
    expect(priority.value).toBe(
      "data-testid,id,name,col-id,placeholder,data-ref",
    );
    expect(priority.entries.map((e) => e.uniqueness)).toEqual([
      null,
      null,
      null,
      1,
      1,
      0.5,
    ]);
    expect(priority.diff).toEqual([
      { name: "data-testid", proposedPosition: 1, defaultPosition: null },
      { name: "id", proposedPosition: 2, defaultPosition: 1 },
      { name: "name", proposedPosition: 3, defaultPosition: null },
      { name: "col-id", proposedPosition: 4, defaultPosition: null },
      { name: "placeholder", proposedPosition: 5, defaultPosition: null },
      { name: "data-ref", proposedPosition: 6, defaultPosition: null },
      { name: "class", proposedPosition: null, defaultPosition: 2 },
      { name: "href", proposedPosition: null, defaultPosition: 3 },
      { name: "src", proposedPosition: null, defaultPosition: 4 },
    ]);
  });

  it("keeps only attributes stable on most pages, and none that mostly hold PII", () => {
    const priority = deriveAttributePriority(
      [
        stablePage(
          { id: values("a"), title: values("x@example.com") },
          {},
          "p1",
        ),
        stablePage({ id: values("b"), "data-x": values("k") }, {}, "p2"),
        pageOf(
          [
            run("initial", profile({ "data-x": values("one") })),
            run("after-reload", profile({ "data-x": values("two") })),
          ],
          "p3",
        ),
        pageOf(
          [
            run("initial", profile({ "data-x": values("three") })),
            run("after-reload", profile({ "data-x": values("four") })),
          ],
          "p4",
        ),
      ],
      noisePolicy(),
    );
    expect(priority.value).toBe("id");
  });
});

describe("deriveMaxZIndex", () => {
  it("leaves out noise and the extension icon, and names the application element behind the highest value", () => {
    const setting = deriveMaxZIndex(
      [
        stablePage(
          {},
          {
            schema: 2,
            maxZIndex: 999999,
            zIndexSources: [
              { value: 999999, tag: "img", inline: true },
              { value: 2147483000, tag: "div", id: "apty-launcher" },
              { value: 9999, tag: "div", id: "toast-host", class: "toast" },
            ],
          },
        ),
      ],
      noisePolicy(),
    );
    expect(setting).toMatchObject({
      value: 2147483646,
      basis: "derived",
      appMax: 9999,
      appMaxSource: {
        value: 9999,
        tag: "div",
        id: "toast-host",
        class: "toast",
        pages: ["p1"],
      },
    });
    expect(setting.excluded.map((e) => [e.value, e.source])).toEqual([
      [2147483000, "div#apty-launcher (Apty Widget / Studio)"],
      [999999, "img (inline z-index at or above 999999 (extension icon))"],
    ]);
  });

  it("goes above an application that already uses the highest values, within the maximum", () => {
    const setting = deriveMaxZIndex(
      [
        stablePage(
          {},
          {
            zIndexSources: [{ value: 2147483647, tag: "div" }],
            maxZIndex: 2147483647,
          },
        ),
      ],
      noisePolicy(),
    );
    expect(setting.value).toBe(2147483647);
  });

  it("drops a console-script maximum that only the extension icon explains, keeping the clean run's", () => {
    const withIcon = profile(
      { style: values("z-index: 999999; position: fixed") },
      { maxZIndex: 999999 },
    );
    const clean = profile(
      { style: values("z-index: 50") },
      { maxZIndex: 9999 },
    );
    const setting = deriveMaxZIndex(
      [pageOf([run("initial", withIcon), run("after-reload", clean)])],
      noisePolicy(),
    );
    expect(setting).toMatchObject({
      value: 2147483646,
      appMax: 9999,
      appMaxSource: null,
    });
    expect(setting.excluded).toEqual([
      expect.objectContaining({ value: 999999, pages: ["p1"] }),
    ]);
  });

  it("says when nothing was recorded", () => {
    expect(deriveMaxZIndex([stablePage({})], noisePolicy())).toMatchObject({
      basis: "default",
      appMax: null,
    });
  });
});

describe("deriveDebounce", () => {
  const withBursts = (durations: number[]) =>
    deriveDebounce([
      stablePage(
        {},
        {
          probe: probe({
            mutationBursts: durations.map((durationMs) => ({
              durationMs,
              mutationCount: 3,
            })),
          }),
        },
      ),
    ]);

  it("derives the debounce from the 90th percentile burst, labeled as a heuristic", () => {
    expect(
      withBursts([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]),
    ).toMatchObject({
      value: 1080,
      basis: "derived",
      reason: expect.stringMatching(
        /^Heuristic: the 90th percentile of 20 mutation burst/,
      ),
    });
    expect(withBursts([10, 20])).toMatchObject({ value: 200 });
    expect(withBursts([5000])).toMatchObject({ value: 1500 });
  });

  it("falls back to the default, marked not measured, without probe data", () => {
    expect(deriveDebounce([stablePage({})])).toMatchObject({
      value: 500,
      basis: "default",
      reason: expect.stringContaining("no behavior probe ran"),
    });
    expect(
      deriveDebounce([stablePage({}, { probe: probe({}) })]).reason,
    ).toContain("saw no mutation bursts");
  });

  it("notes a very large DOM", () => {
    const big = stablePage({}, { tags: { div: 2001 } });
    expect(deriveDebounce([big]).reason).toContain(
      "more than 2000 div elements",
    );
  });
});

describe("deriveIgnoreEvents", () => {
  it("lists only events the probe saw firing often", () => {
    const setting = deriveIgnoreEvents([
      stablePage(
        {},
        { probe: probe({ eventRates: { mousemove: 45, scroll: 3 } }) },
      ),
    ]);
    expect(setting).toMatchObject({ value: ["mousemove"], basis: "measured" });
  });

  it("says none measured when no human moved the mouse", () => {
    expect(
      deriveIgnoreEvents([stablePage({}, { probe: probe({}) })]),
    ).toMatchObject({
      value: [],
      basis: "default",
      reason: expect.stringContaining("None measured"),
    });
  });
});

describe("deriveShadowDom", () => {
  it("turns support on for application shadow roots, by convention for Apty's only, off for none", () => {
    expect(
      deriveShadowDom([
        stablePage({}, { shadowRoots: { "x-grid": { tags: { div: 1 } } } }),
      ]),
    ).toMatchObject({
      value: true,
      basis: "measured",
      reason: expect.stringContaining("x-grid"),
    });
    expect(
      deriveShadowDom([
        stablePage(
          {},
          { shadowRoots: { "apty-widget": { tags: { div: 1 } } } },
        ),
      ]),
    ).toMatchObject({
      value: true,
      basis: "default",
      reason: expect.stringContaining("convention"),
    });
    expect(deriveShadowDom([stablePage({})])).toMatchObject({
      value: false,
      basis: "measured",
      reason: expect.stringContaining("cannot see closed shadow roots"),
    });
  });
});
