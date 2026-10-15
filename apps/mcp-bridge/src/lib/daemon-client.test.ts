import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const opened = vi.hoisted(
  () => [] as Array<{ url: string; protocols: unknown }>,
);
const spawned = vi.hoisted(() => [] as unknown[]);

vi.mock("ws", () => ({
  WebSocket: class {
    constructor(url: string, protocols: unknown) {
      opened.push({ url, protocols });
    }
    on(event: string, listener: () => void) {
      if (event === "error") setTimeout(listener, 0);
    }
    terminate() {}
    close() {}
  },
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn((...args: unknown[]) => {
    spawned.push(args);
    return { on: vi.fn(), unref: vi.fn() };
  }),
  fork: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
}));

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: vi.fn(() => true),
}));

vi.mock("./auth-token.js", () => ({
  authProtocols: (t: string) => ["apty-mcp.v1", `apty-token.${t}`],
  getOrCreateToken: () => "the-token",
}));

import { callTool } from "./daemon-client.js";

beforeEach(() => {
  opened.length = 0;
  spawned.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.BROWSER_CLI_WS_URL;
});

describe("callTool (browser-cli)", () => {
  it.each([
    "ws://evil.example.com:9223/cli",
    "wss://127.0.0.1:9223/cli",
    "ws://10.0.0.5:9223/cli",
    "http://127.0.0.1:9223/cli",
  ])("refuses BROWSER_CLI_WS_URL=%s without sending the token anywhere", async (url) => {
    process.env.BROWSER_CLI_WS_URL = url;
    const result = await callTool("get_current_tab", {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/127\.0\.0\.1|localhost/);
    expect(opened).toEqual([]);
  });

  it("never runs /entrypoint.sh, even when it exists", async () => {
    process.env.BROWSER_CLI_WS_URL = "ws://localhost:9223/cli";
    const pending = callTool("get_current_tab", {});
    await vi.advanceTimersByTimeAsync(2_000);
    expect(opened[0]?.url).toBe("ws://localhost:9223/cli");
    expect(JSON.stringify(spawned)).not.toContain("entrypoint");
    await vi.advanceTimersByTimeAsync(120_000);
    await pending;
  });
});
