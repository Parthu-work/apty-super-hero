import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let configDir: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "apty-mcp-auth-test-"));
  process.env.APTY_MCP_CONFIG_DIR = configDir;
});

afterEach(() => {
  delete process.env.APTY_MCP_CONFIG_DIR;
  rmSync(configDir, { recursive: true, force: true });
});

// Re-imported fresh per test via dynamic import so each test's
// APTY_MCP_CONFIG_DIR override is picked up (the module reads the env var
// lazily inside each function, not at import time, but vi's module cache
// would otherwise make this irrelevant anyway — dynamic import keeps the
// intent obvious).
async function loadModule() {
  return await import("./auth-token.js");
}

describe("auth-token — token lifecycle", () => {
  it("creates a new token on first use, persisted 0600 under the config dir", async () => {
    const { getOrCreateToken, getTokenPath } = await loadModule();

    const token = getOrCreateToken();

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const path = getTokenPath();
    expect(path.startsWith(configDir)).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8").trim()).toBe(token);

    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns the same token on repeated calls instead of regenerating it", async () => {
    const { getOrCreateToken } = await loadModule();

    const first = getOrCreateToken();
    const second = getOrCreateToken();

    expect(second).toBe(first);
  });

  it("rotateToken replaces the stored token with a new value", async () => {
    const { getOrCreateToken, rotateToken, getTokenPath } = await loadModule();

    const original = getOrCreateToken();
    const rotated = rotateToken();

    expect(rotated).not.toBe(original);
    expect(readFileSync(getTokenPath(), "utf8").trim()).toBe(rotated);

    const mode = statSync(getTokenPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("auth-token — tokensMatch (constant-time comparison)", () => {
  it("returns true for identical tokens", async () => {
    const { tokensMatch } = await loadModule();
    expect(tokensMatch("same-token-value", "same-token-value")).toBe(true);
  });

  it("returns false for a wrong token of the same length", async () => {
    const { tokensMatch } = await loadModule();
    expect(tokensMatch("a".repeat(32), "b".repeat(32))).toBe(false);
  });

  it("returns false, without throwing, when the candidate is shorter than expected", async () => {
    const { tokensMatch } = await loadModule();
    expect(() => tokensMatch("short", "a".repeat(64))).not.toThrow();
    expect(tokensMatch("short", "a".repeat(64))).toBe(false);
  });

  it("returns false, without throwing, when the candidate is longer than expected", async () => {
    const { tokensMatch } = await loadModule();
    expect(() => tokensMatch("a".repeat(100), "a".repeat(64))).not.toThrow();
    expect(tokensMatch("a".repeat(100), "a".repeat(64))).toBe(false);
  });

  it("returns false, without throwing, for an empty-string candidate", async () => {
    const { tokensMatch } = await loadModule();
    expect(() => tokensMatch("", "a".repeat(64))).not.toThrow();
    expect(tokensMatch("", "a".repeat(64))).toBe(false);
  });

  it("returns false for an undefined candidate (no token presented)", async () => {
    const { tokensMatch } = await loadModule();
    expect(tokensMatch(undefined, "a".repeat(64))).toBe(false);
  });
});

describe("auth-token — allowed extension id", () => {
  it("is undefined until explicitly configured", async () => {
    const { getAllowedExtensionId } = await loadModule();
    expect(getAllowedExtensionId()).toBeUndefined();
  });

  it("persists and returns the configured extension id", async () => {
    const { getAllowedExtensionId, setAllowedExtensionId, getTokenPath } =
      await loadModule();

    setAllowedExtensionId("abcdefghijklmnopabcdefghijklmnop");

    expect(getAllowedExtensionId()).toBe("abcdefghijklmnopabcdefghijklmnop");

    // Config file sits alongside the token file, also 0600.
    const configPath = join(getTokenPath(), "..", "config.json");
    const mode = statSync(configPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("overwrites a previously configured extension id without losing the token", async () => {
    const { getOrCreateToken, getAllowedExtensionId, setAllowedExtensionId } =
      await loadModule();

    const token = getOrCreateToken();
    setAllowedExtensionId("first-id-aaaaaaaaaaaaaaaaaaaaaaaa");
    setAllowedExtensionId("second-id-bbbbbbbbbbbbbbbbbbbbbbb");

    expect(getAllowedExtensionId()).toBe("second-id-bbbbbbbbbbbbbbbbbbbbbbb");
    expect(getOrCreateToken()).toBe(token);
  });
});

describe("auth-token — isLoopbackHost", () => {
  it("treats 127.0.0.1, localhost, and ::1 as loopback", async () => {
    const { isLoopbackHost } = await loadModule();
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
  });

  it("treats 0.0.0.0, a LAN IP, and a hostname as non-loopback", async () => {
    const { isLoopbackHost } = await loadModule();
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.50")).toBe(false);
    expect(isLoopbackHost("my-machine.local")).toBe(false);
  });
});
