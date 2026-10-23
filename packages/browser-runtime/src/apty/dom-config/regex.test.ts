import { describe, expect, it } from "vitest";
import {
  anchored,
  compileRuleRegex,
  escapeRegexLiteral,
  literalsAreSafe,
  mergeSharedPrefix,
  regexFromSkeleton,
} from "./regex";
import { piiShapeOf, skeletonOf } from "./text";

describe("regex generalization", () => {
  it("escapes metacharacters and turns digit runs into \\d+", () => {
    expect(escapeRegexLiteral("a.b|c(d)[e]{f}*+?^$\\/")).toBe(
      "a\\.b\\|c\\(d\\)\\[e\\]\\{f\\}\\*\\+\\?\\^\\$\\\\\\/",
    );
    const regex = regexFromSkeleton(skeletonOf("ui-id-12"));
    expect(anchored(regex.body)).toBe("^ui-id-\\d+$");
    expect(regex.literals).toEqual(["ui-id-", ""]);
    expect(anchored(regexFromSkeleton(skeletonOf("v1.2")).body)).toBe(
      "^v\\d+\\.\\d+$",
    );
  });

  it("allows only short identifier-shaped literals without a PII shape (D3)", () => {
    expect(literalsAreSafe(["ui-id-", ""])).toBe(true);
    expect(literalsAreSafe(["Jane Doe "])).toBe(false);
    expect(literalsAreSafe(["user@example.com"])).toBe(false);
    expect(literalsAreSafe(["/patients/"])).toBe(false);
    expect(literalsAreSafe(["x".repeat(33)])).toBe(false);
  });

  it("merges patterns that share a prefix with a plain |, never \\|", () => {
    expect(mergeSharedPrefix(["ui-id-\\d+", "ui-tab-\\d+"])).toBe(
      "ui-(?:id-\\d+|tab-\\d+)",
    );
    expect(mergeSharedPrefix(["ab\\d+", "ac\\d+"])).toBeNull();
    expect(mergeSharedPrefix(["row-\\d+", "row-\\d+-x"])).toBeNull();
    expect(mergeSharedPrefix(["abc\\.x", "abc\\.y"])).toBe("abc\\.(?:x|y)");
    expect(
      mergeSharedPrefix([`abc${"x".repeat(200)}`, `abc${"y".repeat(200)}`]),
    ).toBeNull();
  });

  it("refuses a pattern that is too long or does not compile", () => {
    expect(compileRuleRegex("^(unclosed$")).toBeNull();
    expect(compileRuleRegex(`^${"a".repeat(300)}$`)).toBeNull();
    expect(compileRuleRegex("^ok$")?.test("ok")).toBe(true);
  });
});

describe("hostile input", () => {
  it("builds and runs patterns on 100,000-character values in linear time", () => {
    const value = `${"a1".repeat(50_000)}`;
    const started = performance.now();
    const regex = regexFromSkeleton(skeletonOf(value));
    expect(literalsAreSafe(regex.literals)).toBe(true);
    expect(compileRuleRegex(anchored(regex.body))).toBeNull();
    for (const template of [
      "^.*\\d{5,}.*$",
      "^.*[^\\s@]@[^\\s@]+\\.[A-Za-z]{2,}.*$",
    ]) {
      compileRuleRegex(template)!.test(
        `${"@".repeat(50_000)}${"9".repeat(4)}x`.repeat(2),
      );
    }
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("checks PII shapes on 100,000-character values in linear time", () => {
    const started = performance.now();
    expect(piiShapeOf(`a@${"b".repeat(100_000)}`)).toBeNull();
    expect(piiShapeOf(`${"1234 ".repeat(20_000)}`)).toBeNull();
    expect(piiShapeOf(`${"a@b ".repeat(25_000)}`)).toBeNull();
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
