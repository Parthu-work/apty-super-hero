import { describe, expect, it } from "vitest";
import { checkContentHost } from "./content-host.js";

const refused = (url: string, version: "4.x" | "5.x" = "5.x", policy = []) =>
  checkContentHost(url, version, policy).ok === false;

describe("checkContentHost (A1: one gate for every content host)", () => {
  it("accepts the version's Apty content domain on the default https port", () => {
    expect(
      checkContentHost("https://content.apty.ai/contents/", "5.x", []),
    ).toEqual({ ok: true, base: "https://content.apty.ai/contents" });
    expect(checkContentHost("https://apty.ai", "5.x", [])).toEqual({
      ok: true,
      base: "https://apty.ai",
    });
    expect(checkContentHost("https://cdn.apty.io", "4.x", [])).toEqual({
      ok: true,
      base: "https://cdn.apty.io",
    });
  });

  it("refuses the other version's domain and look-alike hosts", () => {
    expect(refused("https://cdn.apty.io", "5.x")).toBe(true);
    expect(refused("https://cdn.apty.ai", "4.x")).toBe(true);
    for (const url of [
      "https://evilapty.ai",
      "https://apty.ai.evil.example",
      "https://content.apty.ai.",
      "https://intranet.example",
    ]) {
      expect(refused(url)).toBe(true);
    }
  });

  it("refuses a non-default port, plain http and loopback unless the policy lists the origin", () => {
    for (const url of [
      "https://content.apty.ai:8443",
      "http://content.apty.ai",
      "http://127.0.0.1:4100",
      "http://localhost:4100",
      "https://localhost",
    ]) {
      expect(refused(url)).toBe(true);
    }
    expect(
      checkContentHost("http://127.0.0.1:4100/", "5.x", [
        "http://127.0.0.1:4100",
      ]),
    ).toEqual({ ok: true, base: "http://127.0.0.1:4100" });
  });

  it("refuses every IP literal, private or public, unless the policy lists it", () => {
    for (const url of [
      "https://10.0.0.5",
      "https://172.32.0.1",
      "https://8.8.8.8",
      "https://169.254.169.254",
      "https://0xa000005",
      "https://167772165",
      "https://[::1]",
      "https://[::ffff:10.0.0.5]",
    ]) {
      expect(refused(url)).toBe(true);
    }
    expect(
      checkContentHost("https://10.0.0.5/apty", "5.x", ["https://10.0.0.5"]),
    ).toEqual({ ok: true, base: "https://10.0.0.5/apty" });
  });

  it("normalises policy origins before comparing them", () => {
    expect(
      checkContentHost("https://onprem.example/contents", "4.x", [
        "https://ONPREM.example:443/",
      ]).ok,
    ).toBe(true);
  });

  it("refuses a URL with user info, a query or a fragment, even on the policy's origin", () => {
    const policy = ["https://content.example"];
    for (const url of [
      "https://user:pw@content.apty.ai",
      "https://content.apty.ai/?x=1",
      "https://content.example/#a",
      "not a url",
    ]) {
      expect(checkContentHost(url, "5.x", policy).ok).toBe(false);
    }
  });

  it("names the host and the policy key to add it to", () => {
    expect(checkContentHost("https://cdn.customer.example", "5.x", [])).toEqual(
      {
        ok: false,
        detail: expect.stringMatching(
          /https:\/\/cdn\.customer\.example .*aptyContentOrigins/,
        ),
      },
    );
  });
});
