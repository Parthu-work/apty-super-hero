import { describe, expect, it } from "vitest";
import {
  resolveScreenshotUrls,
  transformScreenshotPlaceholders,
} from "./screenshot-utils";

const PREFIX = "https://apty-screenshot.invalid/";

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

describe("resolveScreenshotUrls", () => {
  const data = new Map([["screenshot_1_x", "data:image/png;base64,AAAA"]]);

  it("resolves a link written by transformScreenshotPlaceholders", () => {
    const text = transformScreenshotPlaceholders("see [[screenshot:1]]", [
      "screenshot_1_x",
    ]);
    expect(resolveScreenshotUrls(text, data)).toBe(
      "see ![](data:image/png;base64,AAAA)",
    );
  });

  it("still resolves a link under the host earlier versions wrote", () => {
    expect(
      resolveScreenshotUrls(
        "see ![](https://aipex-screenshot.invalid/screenshot_1_x)",
        data,
      ),
    ).toBe("see ![](data:image/png;base64,AAAA)");
  });

  it("leaves a link to a screenshot it has no data for", () => {
    const text = `![](${PREFIX}screenshot_2_y)`;
    expect(resolveScreenshotUrls(text, data)).toBe(text);
  });
});
