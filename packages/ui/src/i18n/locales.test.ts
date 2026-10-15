import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

/** Every dotted path to a value, with the value. */
function leaves(
  value: unknown,
  prefix = "",
  out = new Map<string, unknown>(),
): Map<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      leaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.set(prefix, value);
  }
  return out;
}

const placeholders = (text: unknown) =>
  [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("locales", () => {
  const enLeaves = leaves(en);
  const zhLeaves = leaves(zh);

  it("has the same keys in English and Chinese", () => {
    expect([...zhLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
  });

  it("has a non-empty string for every key", () => {
    for (const [key, value] of [...enLeaves, ...zhLeaves]) {
      expect(typeof value, key).toBe("string");
      expect(String(value).trim(), key).not.toBe("");
    }
  });

  it("uses the same {placeholders} in both languages", () => {
    for (const [key, value] of enLeaves) {
      expect(placeholders(zhLeaves.get(key)), key).toEqual(placeholders(value));
    }
  });
});
