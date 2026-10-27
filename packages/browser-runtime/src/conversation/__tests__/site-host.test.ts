import { describe, expect, it } from "vitest";
import { siteHostOf } from "../site-host";

describe("siteHostOf", () => {
  it("keeps only the hostname of an http(s) page", () => {
    expect(siteHostOf("https://app.example.com:8443/orders/42?id=7#top")).toBe(
      "app.example.com",
    );
    expect(siteHostOf("http://user:pw@127.0.0.1:3000/a")).toBe("127.0.0.1");
  });

  it("gives nothing for other pages or no page", () => {
    for (const url of [
      "chrome://extensions/",
      "chrome-extension://abc/sidepanel.html",
      "file:///home/me/report.html",
      "about:blank",
      "not a url",
      "",
      undefined,
      null,
    ]) {
      expect(siteHostOf(url)).toBeUndefined();
    }
  });
});
