import { describe, expect, it } from "vitest";
import { parseLegacyFrameKey } from "./flatten";
import { buildPageCapture, parseDomProfile } from "./import-profile";
import { DOM_CONFIG_LIMITS } from "./limits";

const COMPLETE = JSON.stringify({
  tags: { html: 1, body: 1, div: 3 },
  attributes: { id: { "home-table": 1 }, class: { RptTable: 1 } },
  maxZIndex: 110,
  shadowRoots: { "x-panel": { tags: { div: 1 } } },
  iframes: {
    "Cross Origin 1 (src: chrome-extension://abc/login.html)": {
      isCrossOrigin: true,
    },
  },
});

describe("parseDomProfile", () => {
  it("accepts the console script's output with every section", () => {
    const result = parseDomProfile(COMPLETE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.absentSections).toEqual([]);
    expect(result.extensionNoisePresent).toBe(true);
    expect(result.aptyPresent).toBe(false);
  });

  it("accepts a page without iframes, shadow roots or z-index, which the script leaves out, and says so", () => {
    const result = parseDomProfile(
      '{"tags":{"div":1},"attributes":{"id":{"a":1}}}',
    );
    expect(result).toMatchObject({
      ok: true,
      absentSections: ["maxZIndex", "shadowRoots", "iframes"],
    });
  });

  it("rejects text the console cut short, with re-capture instructions and none of the text", () => {
    const cut = COMPLETE.replace("RptTable", "jane.doe@example.com").slice(
      0,
      90,
    );
    const result = parseDomProfile(cut);
    expect(result).toMatchObject({ ok: false, error: { code: "truncated" } });
    if (result.ok) return;
    expect(result.error.instructions).toMatch(/clipboard/);
    expect(JSON.stringify(result)).not.toContain("jane.doe");
    expect(JSON.stringify(result)).not.toContain("home-table");
  });

  it("rejects text that is not JSON without quoting it", () => {
    const result = parseDomProfile("copy(domAnalysis) 555-123-4567");
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid-json" },
    });
    expect(JSON.stringify(result)).not.toContain("555-123-4567");
  });

  it("names the missing sections a page always has", () => {
    expect(parseDomProfile('{"attributes":{}}')).toMatchObject({
      ok: false,
      error: { code: "missing-sections", missing: ["tags"] },
    });
    expect(parseDomProfile("[1,2]")).toMatchObject({
      ok: false,
      error: { code: "not-a-profile" },
    });
    expect(parseDomProfile("   ")).toMatchObject({
      ok: false,
      error: { code: "empty" },
    });
  });

  it("rejects a section without the script's shape, naming the section, never the key", () => {
    const result = parseDomProfile(
      JSON.stringify({
        tags: { div: 1 },
        attributes: { title: { "patient 12345": "x" } },
      }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "malformed" } });
    if (result.ok) return;
    expect(result.error.message).toContain("attributes");
    expect(JSON.stringify(result)).not.toContain("12345");
    expect(
      parseDomProfile(
        JSON.stringify({
          tags: {},
          attributes: {},
          iframes: { x: { isCrossOrigin: "yes" } },
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "malformed" } });
    expect(
      parseDomProfile(
        JSON.stringify({ schema: 2, tags: {}, attributes: {}, frames: {} }),
      ),
    ).toMatchObject({ ok: false, error: { code: "malformed" } });
  });

  it("rejects a profile larger than one may be", () => {
    const huge = " ".repeat(DOM_CONFIG_LIMITS.maxInputChars + 1);
    expect(parseDomProfile(huge)).toMatchObject({
      ok: false,
      error: { code: "too-large" },
    });
  });

  it("recognises Apty in a profile", () => {
    const result = parseDomProfile(
      JSON.stringify({
        tags: { "apty-widget": 1 },
        attributes: { "data-apty-root": { true: 1 } },
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      aptyPresent: true,
      extensionNoisePresent: false,
    });
  });
});

describe("parseLegacyFrameKey", () => {
  it("reads the real src out of the script's cross-origin placeholder", () => {
    expect(
      parseLegacyFrameKey(
        "Cross Origin 3 (src: https://docs.example.test/view?id=1)",
      ),
    ).toEqual({
      src: "https://docs.example.test/view?id=1",
      placeholder: true,
    });
    expect(parseLegacyFrameKey("Cross Origin 1 (src: )")).toEqual({
      src: null,
      placeholder: true,
    });
  });

  it("keeps a same-origin frame's location and never invents one", () => {
    expect(parseLegacyFrameKey("https://app.example.test/frame")).toEqual({
      src: "https://app.example.test/frame",
      placeholder: false,
    });
    expect(parseLegacyFrameKey("null")).toEqual({
      src: null,
      placeholder: false,
    });
  });
});

describe("buildPageCapture", () => {
  it("labels each run, keeps the URL as a shape and reports failed runs by position", () => {
    const result = buildPageCapture({
      pageId: "visits",
      label: "Visits",
      runs: [
        {
          text: COMPLETE,
          label: "initial",
          capturedAt: "2026-10-22",
          url: "https://app.example.test/patients/1234567/visits?visitDate=10/22/2026&nocache=17",
        },
        { text: COMPLETE.slice(0, 40), label: "after-reload" },
      ],
    });
    expect(result.errors).toEqual([
      { run: 1, error: expect.objectContaining({ code: "truncated" }) },
    ]);
    expect(result.page?.runs).toHaveLength(1);
    expect(result.page?.runs[0]?.meta).toMatchObject({
      label: "initial",
      capturedAt: "2026-10-22",
      urlShape:
        "https://app.example.test/patients/:id/visits?nocache&visitDate",
      extensionNoisePresent: true,
    });
  });

  it("returns no page when no run parses", () => {
    const result = buildPageCapture({
      pageId: "x",
      label: "X",
      runs: [{ text: "{", label: "initial" }],
    });
    expect(result.page).toBeNull();
    expect(result.errors).toHaveLength(1);
  });
});
