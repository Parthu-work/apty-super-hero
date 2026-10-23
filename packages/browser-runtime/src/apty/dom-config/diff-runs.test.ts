import { describe, expect, it } from "vitest";
import {
  analyze,
  profile,
  run,
  stableAttributes,
  values,
} from "./__tests__/fixtures";
import { flattenRun } from "./flatten";
import { noisePolicy } from "./noise";

describe("diffPageRuns", () => {
  it("calls a page stable when only Apty and extensions differ, and keeps those differences apart", () => {
    const base = stableAttributes("calendar");
    const { diff } = analyze([
      run("initial", profile(base)),
      run(
        "after-reload",
        profile(
          {
            ...base,
            "data-apty-root": values("true"),
            class: { ...base.class, "apty-visibility-ignore-element": 1 },
            "data-myki-field": values("1"),
          },
          { tags: { html: 1, body: 1, div: 10, "apty-widget": 1 } },
        ),
      ),
    ]);
    expect(diff.status).toBe("stable");
    expect(diff.changed.size).toBe(0);
    expect(diff.pairs[0]!.values).toEqual([]);
    expect(diff.pairs[0]!.noiseTags).toEqual([
      { tag: "apty-widget", fromCount: 0, toCount: 1 },
    ]);
    expect(diff.pairs[0]!.noiseValues.map((v) => v.name).sort()).toEqual([
      "class",
      "data-apty-root",
      "data-myki-field",
    ]);
  });

  it("records value-set differences as changes and count-only differences as diffs only", () => {
    const { diff } = analyze([
      run("initial", profile({ href: values("/a?nocache=1", ["/rows", 3]) })),
      run(
        "after-reload",
        profile({ href: values("/a?nocache=2", ["/rows", 5]) }),
      ),
    ]);
    expect(diff.status).toBe("changing");
    expect([...diff.changed.get("href")!]).toEqual([
      "/a?nocache=1",
      "/a?nocache=2",
    ]);
    expect(diff.pairs[0]!.values).toContainEqual({
      name: "href",
      change: "count",
      value: "/rows",
      fromCount: 3,
      toCount: 5,
    });
  });

  it("hides PII-shaped values in diffs", () => {
    const { diff } = analyze([
      run("initial", profile({ title: values("jane.doe@example.com") })),
      run("after-reload", profile({ title: values("Call 555-123-4567") })),
    ]);
    expect(diff.pairs[0]!.values.map((v) => v.value)).toEqual([
      "[PII value hidden]",
      "[PII value hidden]",
    ]);
  });

  it("calls a page with one run single-run and finds no changes", () => {
    const { diff } = analyze([run("initial", profile({ id: values("a") }))]);
    expect(diff.status).toBe("single-run");
    expect(diff.changed.size).toBe(0);
  });

  it("keeps partial and state-mismatched runs out of observed changes and marks the page unreliable", () => {
    const { diff } = analyze([
      run("initial", profile({ id: values("a") })),
      run("after-reload", profile({ id: values("a") })),
      run("repeat", profile({ id: values("dialog-open") }), {
        stateMismatch: true,
      }),
      run("repeat", profile({ id: values("half") }), { partial: true }),
    ]);
    expect(diff.status).toBe("unreliable");
    expect(diff.eligible).toEqual([0, 1]);
    expect(diff.changed.size).toBe(0);
    expect(diff.pairs).toHaveLength(6);
  });

  it("ignores an attribute whose values a cap cut in any run", () => {
    const { diff } = analyze([
      run(
        "initial",
        profile(
          { title: values("a") },
          { meta: { truncatedAttributes: ["title"] } },
        ),
      ),
      run("after-reload", profile({ title: values("b") })),
    ]);
    expect(diff.changed.has("title")).toBe(false);
  });

  it("confirms a change on the same element from fingerprints", () => {
    const fingerprints = (hash: string) => ({
      elementFingerprints: [
        { fingerprint: "f1", attributeHashes: { autocomplete: hash, id: "x" } },
      ],
    });
    const { diff } = analyze([
      run(
        "initial",
        profile({ autocomplete: values("off_1") }, fingerprints("h1")),
      ),
      run(
        "after-reload",
        profile({ autocomplete: values("off_2") }, fingerprints("h2")),
      ),
    ]);
    expect([...diff.elementConfirmed]).toEqual(["autocomplete"]);
  });
});

describe("flattenRun", () => {
  it("merges shadow roots and readable same-origin frames, skipping extension frames", () => {
    const flat = flattenRun(
      run(
        "initial",
        profile(
          { id: values("top") },
          {
            maxZIndex: 5,
            shadowRoots: {
              "x-grid": {
                tags: { span: 2 },
                attributes: { id: values("inside") },
                maxZIndex: 7,
              },
            },
            iframes: {
              "https://app.example.test/frame?patient=12345": {
                isCrossOrigin: false,
                tags: { p: 1 },
                attributes: { id: values("framed") },
              },
              "Cross Origin 1 (src: chrome-extension://abc/x.html)": {
                isCrossOrigin: true,
              },
            },
          },
        ),
      ),
      noisePolicy(),
    );
    expect([...flat.attributes.get("id")!.keys()].sort()).toEqual([
      "framed",
      "inside",
      "top",
    ]);
    expect(flat.scopeMaxZIndexes).toEqual([5, 7]);
    expect(flat.shadowHosts).toEqual([
      { tag: "x-grid", mode: "open", noise: false },
    ]);
    expect(flat.frames).toEqual([
      {
        src: "https://app.example.test/frame?patient",
        crossOrigin: false,
        extension: false,
        analyzed: true,
        reason: "analyzed",
      },
      {
        src: "chrome-extension://abc/x.html",
        crossOrigin: true,
        extension: true,
        analyzed: false,
        reason: "cross-origin: the console script cannot read it",
      },
    ]);
  });

  it("cuts long values and too many values, and records both", () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < 5_010; i++) many[`v${i}`] = 1;
    const flat = flattenRun(
      run(
        "initial",
        profile({ title: values("x".repeat(600)), "data-key": many }),
      ),
      noisePolicy(),
    );
    const [title] = [...flat.attributes.get("title")!.keys()];
    expect(title!.length).toBeLessThan(600);
    expect(title).toMatch(/^x{512}…#[0-9a-f]+$/);
    expect(flat.attributes.get("data-key")!.size).toBe(5_000);
    expect(flat.truncatedNames).toEqual(new Set(["data-key"]));
    expect(flat.truncations).toEqual([
      { kind: "distinct-values", name: "data-key", dropped: 10 },
      { kind: "value-length", name: "title", dropped: 1 },
    ]);
  });

  it("reads the collector's frame and shadow records instead of the script's keys", () => {
    const flat = flattenRun(
      run(
        "initial",
        profile(
          {},
          {
            schema: 2,
            frames: [
              {
                src: "https://docs.example.test/view?doc=9&sig=abc",
                crossOrigin: true,
                readable: false,
                reason: "blocked-cross-origin",
              },
            ],
            shadow: [{ hostTag: "x-secure", mode: "closed" }],
          },
        ),
      ),
      noisePolicy(),
    );
    expect(flat.frames).toEqual([
      {
        src: "https://docs.example.test/view?doc&sig",
        crossOrigin: true,
        extension: false,
        analyzed: false,
        reason: "blocked-cross-origin",
      },
    ]);
    expect(flat.shadowHosts).toEqual([
      { tag: "x-secure", mode: "closed", noise: false },
    ]);
    expect(flat.seesClosedShadowRoots).toBe(true);
  });

  it("caps the characters one run holds, keeping the most frequent values, and marks the run incomplete", () => {
    const attributes: Record<string, Record<string, number>> = {};
    for (const name of ["data-a", "data-b", "data-c", "data-d"]) {
      attributes[name] = {};
      for (let i = 0; i < 5_000; i++)
        attributes[name]![`${i}-${"v".repeat(500)}`] = i === 0 ? 2 : 1;
    }
    const flat = flattenRun(run("initial", profile(attributes)), noisePolicy());
    expect(flat.incomplete).toBe(true);
    expect(flat.attributes.get("data-a")!.size).toBe(5_000);
    expect(flat.attributes.get("data-d")!.size).toBeLessThan(5_000);
    expect(flat.truncatedNames.has("data-d")).toBe(true);
    expect(flat.truncations.at(-1)).toMatchObject({
      kind: "stored-chars",
      name: null,
    });
  });

  it("shapes a 100,000-character frame src from a pasted profile in linear time", () => {
    const started = performance.now();
    const flat = flattenRun(
      run(
        "initial",
        profile(
          {},
          {
            iframes: {
              [`Cross Origin 1 (src: /${"!".repeat(100_000)})`]: {
                isCrossOrigin: true,
              },
            },
          },
        ),
      ),
      noisePolicy(),
    );
    expect(flat.frames).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
