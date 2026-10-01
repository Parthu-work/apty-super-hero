import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

let configDir: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "apty-mcp-daemon-cli-test-"));
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

/** Spawns the real `daemon.ts` CLI entrypoint (via `tsx`, no build step needed) and resolves once its stderr contains `marker`, or after `timeoutMs`. Always kills the child before resolving. */
function runDaemonUntil(
  args: string[],
  marker: string,
  timeoutMs = 10_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", "src/daemon.ts", ...args], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, APTY_MCP_CONFIG_DIR: configDir },
    });

    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          `Timed out waiting for marker ${JSON.stringify(marker)} in stderr. Got:\n${stderr}`,
        ),
      );
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.includes(marker)) {
        clearTimeout(timer);
        child.kill("SIGTERM");
        resolve(stderr);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("daemon.ts CLI — non-loopback host warning", () => {
  it("logs a WARNING to stderr when --host is not a loopback address", async () => {
    const stderr = await runDaemonUntil(
      ["--port", "0", "--host", "0.0.0.0", "--extension-id", "test-ext-id"],
      "WARNING",
    );
    expect(stderr).toContain("not a loopback address");
  }, 15_000);

  it("does not warn for the default loopback host", async () => {
    const stderr = await runDaemonUntil(
      ["--port", "0", "--host", "127.0.0.1", "--extension-id", "test-ext-id"],
      "Apty MCP Daemon started",
    );
    expect(stderr).not.toContain("WARNING");
  }, 15_000);
});

describe("daemon.ts CLI — token commands", () => {
  it("--print-token-path prints the token path without starting a server", async () => {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        "npx",
        ["tsx", "src/daemon.ts", "--print-token-path"],
        {
          cwd: PACKAGE_ROOT,
          env: { ...process.env, APTY_MCP_CONFIG_DIR: configDir },
        },
      );
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.on("close", () => resolve(stdout));
      child.on("error", reject);
      setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("timed out"));
      }, 10_000);
    });

    expect(output.trim()).toBe(join(configDir, "token"));
  }, 15_000);

  it("--rotate-token prints a new token to stdout and a warning to stderr", async () => {
    const { stdout, stderr } = await new Promise<{
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn("npx", ["tsx", "src/daemon.ts", "--rotate-token"], {
        cwd: PACKAGE_ROOT,
        env: { ...process.env, APTY_MCP_CONFIG_DIR: configDir },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("close", () => resolve({ stdout, stderr }));
      child.on("error", reject);
      setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("timed out"));
      }, 10_000);
    });

    expect(stdout.trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(stderr).toContain("New token generated");
  }, 15_000);
});
