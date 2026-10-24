import { describe, expect, it, vi } from "vitest";
import { readCliEnv } from "./cli-env.js";

describe("readCliEnv", () => {
  it("prefers APTY_WS_URL and APTY_CONNECT_TIMEOUT over their deprecated names, silently", () => {
    const warn = vi.fn();
    const env = readCliEnv(
      {
        APTY_WS_URL: "ws://127.0.0.1:1111/cli",
        AIPEX_WS_URL: "ws://127.0.0.1:2222/cli",
        APTY_CONNECT_TIMEOUT: "1000",
        AIPEX_CONNECT_TIMEOUT: "2000",
      },
      warn,
    );
    expect(env).toEqual({
      wsUrl: "ws://127.0.0.1:1111/cli",
      connectTimeoutMs: 1000,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("still reads the deprecated names, saying once which name replaces each", () => {
    const warn = vi.fn();
    const env = readCliEnv(
      {
        AIPEX_WS_URL: "ws://localhost:2222/cli",
        AIPEX_CONNECT_TIMEOUT: "2000",
      },
      warn,
    );
    expect(env).toEqual({
      wsUrl: "ws://localhost:2222/cli",
      connectTimeoutMs: 2000,
    });
    expect(warn.mock.calls).toEqual([
      ["AIPEX_WS_URL is deprecated; use APTY_WS_URL instead.\n"],
      [
        "AIPEX_CONNECT_TIMEOUT is deprecated; use APTY_CONNECT_TIMEOUT instead.\n",
      ],
    ]);
  });

  it("uses the defaults when neither name is set", () => {
    const warn = vi.fn();
    expect(readCliEnv({}, warn)).toEqual({
      wsUrl: "ws://localhost:9223/cli",
      connectTimeoutMs: 60_000,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["APTY_WS_URL", "ws://example.com:9223/cli"],
    ["AIPEX_WS_URL", "ws://example.com:9223/cli"],
    ["APTY_WS_URL", "wss://localhost:9223/cli"],
  ])("rejects a non-loopback URL from %s", (name, value) => {
    expect(() => readCliEnv({ [name]: value }, vi.fn())).toThrow(
      "must be ws://127.0.0.1 or ws://localhost",
    );
  });

  it("checks the URL it uses, not the one it ignores", () => {
    expect(() =>
      readCliEnv(
        {
          APTY_WS_URL: "ws://example.com:9223/cli",
          AIPEX_WS_URL: "ws://localhost:9223/cli",
        },
        vi.fn(),
      ),
    ).toThrow("must be ws://127.0.0.1");
  });

  it.each([
    ["APTY_CONNECT_TIMEOUT", "1500ms", 1500],
    ["AIPEX_CONNECT_TIMEOUT", "2500", 2500],
  ])("parses the timeout from %s as an integer", (name, value, expected) => {
    expect(readCliEnv({ [name]: value }, vi.fn()).connectTimeoutMs).toBe(
      expected,
    );
  });
});
