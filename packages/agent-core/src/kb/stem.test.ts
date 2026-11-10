import { describe, expect, it } from "vitest";
import { stem } from "./stem.js";

/** Each pair stems to one term: a word and its inflection, or two inflections. */
const SAME: [string, string][] = [
  ["flickers", "flickering"],
  ["flicker", "flickered"],
  ["slower", "slow"],
  ["slowest", "slow"],
  ["bigger", "big"],
  ["biggest", "big"],
  ["later", "late"],
  ["easier", "easy"],
  ["wider", "wide"],
  ["slowly", "slow"],
  ["stopped", "stop"],
  ["stopping", "stops"],
  ["running", "run"],
  ["entries", "entry"],
  ["applied", "apply"],
  ["copies", "copy"],
  ["crashes", "crash"],
  ["crashed", "crashing"],
  ["matches", "match"],
  ["boxes", "box"],
  ["freezes", "freeze"],
  ["freezing", "freeze"],
  ["pages", "paging"],
  ["page", "pages"],
  ["files", "file"],
  ["closed", "close"],
  ["closing", "closes"],
  ["hides", "hiding"],
  ["loading", "loads"],
  ["loaded", "load"],
  ["triggered", "trigger"],
  ["triggers", "triggering"],
  ["opens", "opened"],
  ["opening", "open"],
  ["tooltips", "tooltip"],
  ["workflows", "workflow"],
  ["segments", "segment"],
  ["users", "user"],
  ["browsers", "browser"],
  ["reloads", "reloading"],
  ["refreshed", "refresh"],
  ["repeats", "repeated"],
  ["jumps", "jumping"],
  ["skipped", "skips"],
  ["duplicates", "duplicated"],
];

/** Words that must keep their own stem. */
const KEPT: [string, string][] = [
  ["status", "status"],
  ["class", "class"],
  ["analysis", "analysis"],
  ["flow.json", "flow.json"],
  ["403", "403"],
  ["f5", "f5"],
  ["app", "app"],
  ["need", "need"],
];

/** F6: nouns ending in -er keep their -er; only listed comparatives lose it. */
const NOUNS = [
  "player",
  "header",
  "container",
  "trigger",
  "browser",
  "server",
  "filter",
  "layer",
  "marker",
  "banner",
  "owner",
  "viewer",
  "folder",
  "number",
  "user",
  "order",
  "error",
];

describe("stem", () => {
  it.each(SAME)("stems %s and %s alike", (a, b) => {
    expect(stem(a)).toBe(stem(b));
  });

  it.each(KEPT)("keeps %s as %s", (word, stemmed) => {
    expect(stem(word)).toBe(stemmed);
  });

  it.each(NOUNS)("F6: leaves the noun %s unchanged", (noun) => {
    expect(stem(noun)).toBe(noun);
  });

  it("F6: strips -er and -est only from listed comparatives", () => {
    expect(stem("slower")).toBe("slow");
    expect(stem("slowest")).toBe("slow");
    expect(stem("bigger")).toBe("big");
    expect(stem("later")).toBe(stem("late"));
    expect(stem("player")).not.toBe(stem("play"));
    expect(stem("header")).not.toBe(stem("head"));
  });

  it("does not merge words that only look alike", () => {
    expect(stem("apply")).not.toBe(stem("app"));
    expect(stem("user")).not.toBe(stem("use"));
    expect(stem("layer")).not.toBe(stem("lay"));
  });
});
