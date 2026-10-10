import { describe, expect, it } from "vitest";
import {
  MAX_PREVIEW_ITEMS,
  MAX_SUMMARY_CHARS,
  MAX_SUMMARY_KEYS,
  summarizeJsonBody,
} from "./json-body-summary";

const PREVIEW_CHARS = 8_000;

function summarize(value: unknown, maxPreview = PREVIEW_CHARS) {
  const result = summarizeJsonBody(JSON.stringify(value), maxPreview);
  if (!result) throw new Error("expected a summary");
  return result;
}

describe("summarizeJsonBody", () => {
  it("describes an array of objects: length, the union of item keys with their types, and the preview", () => {
    const items = Array.from({ length: 206 }, (_, i) => ({
      id: 4000 + i,
      name: `segment-${i}`,
      ...(i % 2 ? { archived: true } : { owner: null }),
    }));

    const { summary, preview } = summarize(items);

    expect(summary).toEqual({
      kind: "array",
      itemCount: 206,
      itemKeys: {
        id: "number",
        name: "string",
        owner: "null",
        archived: "boolean",
      },
      itemKeyCount: 4,
      inPreview: MAX_PREVIEW_ITEMS,
      previewIsPartial: true,
    });
    expect(JSON.parse(preview)).toEqual(items.slice(0, MAX_PREVIEW_ITEMS));
  });

  it("reports every type a key holds across items", () => {
    const { summary } = summarize([{ v: 1 }, { v: "one" }, { v: null }]);
    expect(summary.itemKeys).toEqual({ v: "null|number|string" });
  });

  it("puts only whole items in the preview, as many as fit", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      i,
      text: "x".repeat(300),
    }));

    const { summary, preview } = summarize(items, 700);

    expect(summary.inPreview).toBe(2);
    expect(JSON.parse(preview)).toHaveLength(2);
    expect(preview.length).toBeLessThanOrEqual(700);
  });

  it("describes a nested object by its top-level keys and their types", () => {
    const { summary, preview } = summarize({
      user: { id: 1, roles: ["a"] },
      flags: ["x", "y"],
      count: 2,
    });

    expect(summary).toEqual({
      kind: "object",
      topLevelKeys: ["user", "flags", "count"],
      keyTypes: { user: "object", flags: "array", count: "number" },
      keyCount: 3,
      inPreview: 3,
      previewIsPartial: false,
    });
    expect(JSON.parse(preview)).toEqual({
      user: { id: 1, roles: ["a"] },
      flags: ["x", "y"],
      count: 2,
    });
  });

  it("bounds a large object's preview instead of sending it whole", () => {
    const big = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`key${i}`, "v".repeat(500)]),
    );

    const { summary, preview } = summarize(big, 2_000);

    expect(preview.length).toBeLessThanOrEqual(2_000);
    expect(summary.keyCount).toBe(40);
    expect(summary.topLevelKeys).toHaveLength(MAX_SUMMARY_KEYS);
    expect(summary.previewIsPartial).toBe(true);
  });

  it("describes a mixed array without item keys", () => {
    const { summary } = summarize([1, "two", [3], { four: 4 }]);
    expect(summary.itemCount).toBe(4);
    expect(summary.itemKeys).toEqual({ four: "number" });
  });

  it("describes an empty array", () => {
    expect(summarize([]).summary).toEqual({
      kind: "array",
      itemCount: 0,
      inPreview: 0,
      previewIsPartial: false,
    });
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["a JSON string", '"hello"'],
    ["a JSON number", "42"],
  ])("returns undefined for %s", (_label, text) => {
    expect(summarizeJsonBody(text, PREVIEW_CHARS)).toBeUndefined();
  });

  it("stays under the size limit even with many long keys", () => {
    const item = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [
        `a_rather_long_property_name_number_${i}`,
        i,
      ]),
    );

    const { summary } = summarize([item, item]);

    expect(JSON.stringify(summary).length).toBeLessThanOrEqual(
      MAX_SUMMARY_CHARS,
    );
    expect(summary.itemKeyCount).toBe(60);
    expect(Object.keys(summary.itemKeys ?? {}).length).toBeLessThan(
      MAX_SUMMARY_KEYS + 1,
    );
  });
});
