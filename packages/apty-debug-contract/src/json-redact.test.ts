import { describe, expect, it } from "vitest";
import {
  pseudonymizeId,
  redactJsonAware,
  redactJsonValue,
} from "./json-redact";

describe("redactJsonAware — v4 WP1 regression table", () => {
  it("redacts an object-valued 'cookie' key as a whole, valid unit, even inside truncated/invalid surrounding JSON", () => {
    const input =
      '{"augmentation":{},"cookie":{"a":"b","c":"d"}},"platform_os":"Mac"}';
    const output = redactJsonAware(input);
    expect(output).not.toContain('"a":"b"');
    expect(output).not.toContain('"c":"d"');
    expect(output).toContain('"cookie":"<REDACTED>"');
    // Never leave an open/dangling brace or bracket where the object used
    // to be — the value is replaced as one balanced unit.
    expect(output).not.toMatch(/"cookie":\{[^}]*$/);
  });

  it("redacts user_session_id", () => {
    const output = redactJsonAware('{"user_session_id":"59f4d5e2"}');
    expect(output).not.toContain("59f4d5e2");
  });

  it("redacts username but pseudonymizes user_id into a stable, non-reversible token", () => {
    const input =
      '{"augmentation":{"username":"jane.doe"},"user_id":"00b07ce5-f86e-4f2b-9d27-bfc9300f81be"}';
    const output = redactJsonAware(input);
    expect(output).not.toContain("jane.doe");
    expect(output).not.toContain("00b07ce5-f86e-4f2b-9d27-bfc9300f81be");
    expect(output).toMatch(/"user_id":"u_[0-9a-f]{8}"/);

    // Same input, same salt -> same pseudonym (correlatable within a session).
    const again = redactJsonAware(input);
    expect(again).toBe(output);
  });

  it("redacts page_title, drops page_search entirely, and masks ID-like page_path segments while keeping the route shape", () => {
    const input =
      '{"page_title":"PREVIEW: Patient Chart [1928501] | Athena","page_search":"?MAIN=https%3A%2F%2Fexample.com","page_path":"/1928501/2/summary"}';
    const output = redactJsonAware(input);
    expect(output).not.toContain("Patient Chart");
    expect(output).not.toContain("1928501");
    expect(output).not.toContain("MAIN=https");
    expect(output).toContain('"page_search":""');
    expect(output).toContain("/<ID>/2/summary");
  });

  it("standard mode redacts secrets and pii but leaves page-context alone", () => {
    const input =
      '{"password":"hunter2","username":"jane","page_title":"Patient Chart 12345678"}';
    const output = redactJsonAware(input, "standard");
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("jane");
    // page-context is untouched in "standard" mode.
    expect(output).toContain("Patient Chart 12345678");
  });

  it("off mode makes the JSON-aware pass a no-op", () => {
    const input = '{"password":"hunter2"}';
    expect(redactJsonAware(input, "off")).toBe(input);
  });

  it("never over-redacts a harmless key that merely contains a sensitive substring (session_start_time, time_spent)", () => {
    const input = '{"session_start_time":1234567,"time_spent":42}';
    const output = redactJsonAware(input);
    expect(output).toContain('"session_start_time":1234567');
    expect(output).toContain('"time_spent":42');
  });

  it("falls back to the targeted scanner (rather than throwing or no-op'ing) when the whole input isn't valid JSON despite looking bracketed", () => {
    const input = 'log prefix {"password":"hunter2"} trailing garbage {';
    const output = redactJsonAware(input);
    expect(output).not.toContain("hunter2");
    expect(output).toContain("log prefix");
    expect(output).toContain("trailing garbage");
  });

  it("redactJsonValue never invokes anything beyond plain traversal (safe on a deeply nested structure)", () => {
    const value = redactJsonValue(
      { a: { b: { c: { password: "x", ok: "keep-me" } } } },
      "strict",
      "salt",
    );
    expect(JSON.stringify(value)).toContain("keep-me");
    expect(JSON.stringify(value)).not.toContain('"x"');
  });
});

describe("pseudonymizeId", () => {
  it("is stable for the same value+salt and differs across salts", () => {
    const a = pseudonymizeId("user-123", "salt-a");
    const b = pseudonymizeId("user-123", "salt-a");
    const c = pseudonymizeId("user-123", "salt-b");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^u_[0-9a-f]{8}$/);
  });
});
