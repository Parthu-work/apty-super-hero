import { describe, expect, it } from "vitest";
import {
  classifyLogEntry,
  type LogCategory,
  summarizeLogCategories,
} from "./log-classification";

describe("classifyLogEntry", () => {
  it.each<
    [string, { text: string; level?: string; hint?: string }, LogCategory]
  >([
    [
      "a CSP violation message",
      {
        text: "Refused to load the script because it violates the following Content Security Policy directive: \"script-src 'self'\".",
      },
      "csp-violation",
    ],
    [
      "a CDP log entry with source=security even without CSP wording",
      { text: "Mixed content blocked", hint: "security" },
      "csp-violation",
    ],
    [
      "a CORS failure",
      {
        text: "Access to fetch at 'https://api.example.com' from origin 'https://app.example.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present",
      },
      "cors-error",
    ],
    [
      "an unhandled promise rejection",
      { text: "Uncaught (in promise) Error: widget init failed" },
      "unhandled-rejection",
    ],
    [
      "a window-error console-bridge entry",
      { text: "Something broke", hint: "window-error" },
      "js-exception",
    ],
    [
      "a TypeError message with no hint",
      {
        text: "TypeError: Cannot read properties of undefined (reading 'init')",
      },
      "js-exception",
    ],
    [
      "a 404 resource failure",
      {
        text: "Failed to load resource: the server responded with a status of 404 (Not Found)",
      },
      "network-resource-error",
    ],
    [
      "a deprecation warning",
      {
        text: "'XMLHttpRequest.open' with insecure scheme is deprecated",
        level: "warn",
      },
      "deprecation-warning",
    ],
    [
      "an Apty-specific message with no other signal",
      {
        text: "Apty widget failed to initialize: missing config",
        level: "error",
      },
      "apty-error",
    ],
    [
      "a generic error-level entry with no specific signal",
      { text: "Something went wrong", level: "error" },
      "console-error",
    ],
    [
      "a generic warn-level entry with no specific signal",
      { text: "Slow network detected", level: "warn" },
      "console-warning",
    ],
    [
      "a routine info-level entry",
      { text: "Loaded successfully", level: "info" },
      "info",
    ],
  ])("classifies %s as %s", (_label, entry, expected) => {
    expect(classifyLogEntry(entry)).toBe(expected);
  });

  it("prefers CSP/CORS/exception classification over a coincidental Apty mention", () => {
    expect(
      classifyLogEntry({
        text: "TypeError: Cannot read properties of undefined (reading 'render') at Apty.Widget.render",
      }),
    ).toBe("js-exception");
  });

  it("treats an unrecognized hint as a no-op, not a crash", () => {
    expect(
      classifyLogEntry({
        text: "hello",
        level: "log",
        hint: "some-future-cdp-source",
      }),
    ).toBe("info");
  });
});

describe("summarizeLogCategories", () => {
  it("tallies only the categories that occurred", () => {
    expect(
      summarizeLogCategories([
        "js-exception",
        "js-exception",
        "csp-violation",
        "info",
      ]),
    ).toEqual({ "js-exception": 2, "csp-violation": 1, info: 1 });
  });

  it("returns an empty object for no entries", () => {
    expect(summarizeLogCategories([])).toEqual({});
  });
});
