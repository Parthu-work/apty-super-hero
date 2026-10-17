import { describe, expect, it } from "vitest";
import { transformScreenshotPlaceholders } from "./screenshot-utils";

const PREFIX = "https://aipex-screenshot.invalid/";

describe("transformScreenshotPlaceholders", () => {
  it("links a screenshot by uid or by its 1-based index", () => {
    expect(
      transformScreenshotPlaceholders(
        "a [[screenshot:screenshot_1_abc]] b [[screenshot: 2 ]]",
        ["screenshot_1_x", "screenshot_2_y"],
      ),
    ).toBe(`a ![](${PREFIX}screenshot_1_abc) b ![](${PREFIX}screenshot_2_y)`);
  });

  it("leaves a placeholder it can't resolve as it is", () => {
    const text = "[[screenshot:9]] [[screenshot:not-a-uid]]";
    expect(transformScreenshotPlaceholders(text, ["screenshot_1_x"])).toBe(
      text,
    );
  });

  it("resolves a placeholder that follows an unclosed one", () => {
    expect(
      transformScreenshotPlaceholders("[[screenshot:[[screenshot:1]]", [
        "screenshot_1_x",
      ]),
    ).toBe(`[[screenshot:![](${PREFIX}screenshot_1_x)`);
  });

  it("stays fast on many unclosed placeholders from the model", () => {
    const text = "[[screenshot:".repeat(20_000);
    const started = performance.now();
    expect(transformScreenshotPlaceholders(text, [])).toBe(text);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
