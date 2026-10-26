import { describe, expect, it } from "vitest";
import { describePage } from "./page-access";

describe("describePage", () => {
  it("accepts web pages and local files", () => {
    expect(describePage("https://app.example.com/x").inspectable).toBe(true);
    expect(describePage("http://localhost:3000").inspectable).toBe(true);
    expect(describePage("file:///tmp/a.html").inspectable).toBe(true);
  });

  it("asks for file access when Chrome withholds it", () => {
    expect(describePage("file:///tmp/a.html", false)).toEqual({
      inspectable: false,
      detail:
        'Turn on "Allow access to file URLs" for Apty Agent in chrome://extensions to inspect local files.',
    });
  });

  it("explains pages Chrome keeps extensions out of", () => {
    expect(describePage("chrome://extensions")).toEqual({
      inspectable: false,
      detail:
        "Chrome doesn't let extensions inspect chrome: pages. Open the page you want to investigate.",
    });
    expect(
      describePage("https://chromewebstore.google.com/detail/x").detail,
    ).toMatch(/chromewebstore\.google\.com pages/);
    expect(describePage(undefined).inspectable).toBe(false);
  });
});
