import { describe, expect, it } from "vitest";
import { redactHeaders, redactLogs, redactSensitiveText } from "./redact";

describe("redactHeaders", () => {
  it("redacts known sensitive header names case-insensitively", () => {
    const result = redactHeaders({
      Authorization: "Bearer abc123",
      COOKIE: "session=xyz",
      "X-Api-Key": "secret-key",
      "Content-Type": "application/json",
    });

    expect(result).toEqual({
      Authorization: "<REDACTED>",
      COOKIE: "<REDACTED>",
      "X-Api-Key": "<REDACTED>",
      "Content-Type": "application/json",
    });
  });

  it("passes through undefined", () => {
    expect(redactHeaders(undefined)).toBeUndefined();
  });
});

describe("redactSensitiveText", () => {
  it("redacts a JSON-style token field", () => {
    const input = '{"token": "eyJhbGciOiJIUzI1NiJ9.abc.def"}';
    expect(redactSensitiveText(input)).toBe('{"token": "<REDACTED>"}');
  });

  it("redacts a password field", () => {
    expect(redactSensitiveText("password=hunter2")).toBe("password=<REDACTED>");
  });

  it("redacts a bearer token embedded in free text", () => {
    expect(
      redactSensitiveText("fetch failed, sent Bearer eyJhbGciOi.abc.def"),
    ).toBe("fetch failed, sent Bearer <REDACTED>");
  });

  it("leaves ordinary text untouched", () => {
    const input = "Widget failed to initialize: element not found";
    expect(redactSensitiveText(input)).toBe(input);
  });
});

describe("redactLogs", () => {
  it("redacts the message field of every log entry", () => {
    const logs = [
      { level: "error" as const, message: "token=abc123", timestamp: 1 },
      { level: "log" as const, message: "hello world", timestamp: 2 },
    ];
    expect(redactLogs(logs)).toEqual([
      { level: "error", message: "token=<REDACTED>", timestamp: 1 },
      { level: "log", message: "hello world", timestamp: 2 },
    ]);
  });
});
