import {
  type ChildProcess,
  type SpawnOptionsWithoutStdio,
  spawn,
} from "node:child_process";
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

/**
 * Runs a TypeScript entrypoint in one `node` process with tsx's loader (no
 * build step). Not through `npx tsx`: that is three processes, and SIGTERM to
 * `npx` left the daemon running, still writing its token into
 * `APTY_MCP_CONFIG_DIR` while `afterEach` deleted it (ENOTEMPTY in CI).
 */
function spawnTsx(args: string[], options: SpawnOptionsWithoutStdio) {
  return spawn(process.execPath, ["--import", "tsx", ...args], options);
}

/** Stops a spawned CLI; settles once it has exited and its output is closed. */
function stop(child: ChildProcess): Promise<void> {
  const closed = new Promise<void>((resolve) => {
    if (child.stdout?.closed !== false && child.stderr?.closed !== false) {
      resolve();
    } else {
      child.once("close", () => resolve());
    }
  });
  child.kill("SIGTERM");
  return closed;
}

/** Spawns the real `daemon.ts` CLI entrypoint (via `tsx`, no build step needed) and resolves once its stderr contains `marker`, or rejects after `timeoutMs`. Either way it settles only after the child has exited. */
function runDaemonUntil(
  args: string[],
  marker: string,
  timeoutMs = 10_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnTsx(["src/daemon.ts", ...args], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, APTY_MCP_CONFIG_DIR: configDir },
    });

    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      void stop(child).then(() =>
        reject(
          new Error(
            `Timed out waiting for marker ${JSON.stringify(marker)} in stderr. Got:\n${stderr}`,
          ),
        ),
      );
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (!done && stderr.includes(marker)) {
        done = true;
        clearTimeout(timer);
        void stop(child).then(() => resolve(stderr));
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

describe("daemon.ts CLI — shutdown", () => {
  it("has stopped the daemon by the time the run settles, before afterEach removes its config dir", async () => {
    const stderr = await runDaemonUntil(
      ["--port", "0", "--host", "127.0.0.1", "--extension-id", "test-ext-id"],
      "Apty MCP Daemon started",
    );
    const pid = Number(/pid=(\d+)/.exec(stderr)?.[1]);
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow(
      expect.objectContaining({ code: "ESRCH" }),
    );
  }, 15_000);
});

describe("daemon.ts CLI — token commands", () => {
  it("--print-token-path prints the token path without starting a server", async () => {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawnTsx(["src/daemon.ts", "--print-token-path"], {
        cwd: PACKAGE_ROOT,
        env: { ...process.env, APTY_MCP_CONFIG_DIR: configDir },
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.on("close", () => resolve(stdout));
      child.on("error", reject);
      setTimeout(() => {
        void stop(child).then(() => reject(new Error("timed out")));
      }, 10_000);
    });

    expect(output.trim()).toBe(join(configDir, "token"));
  }, 15_000);

  it("--rotate-token prints a new token to stdout and a warning to stderr", async () => {
    const { stdout, stderr } = await new Promise<{
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawnTsx(["src/daemon.ts", "--rotate-token"], {
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
        void stop(child).then(() => reject(new Error("timed out")));
      }, 10_000);
    });

    expect(stdout.trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(stderr).toContain("New token generated");
  }, 15_000);
});

describe("cli.ts usage", () => {
  it("documents the APTY_ variables and never warns about the deprecated ones", async () => {
    const stderr = await new Promise<string>((resolve, reject) => {
      const child = spawnTsx(["src/cli.ts", "-h"], {
        cwd: PACKAGE_ROOT,
        env: {
          ...process.env,
          APTY_MCP_CONFIG_DIR: configDir,
          AIPEX_WS_URL: "ws://localhost:9223/cli",
          AIPEX_CONNECT_TIMEOUT: "1000",
        },
      });
      let err = "";
      child.stderr.on("data", (chunk) => {
        err += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", () => resolve(err));
    });
    expect(stderr).toContain("APTY_WS_URL");
    expect(stderr).toContain("APTY_CONNECT_TIMEOUT");
    expect(stderr).not.toContain("AIPEX_WS_URL");
    expect(stderr).not.toContain("AIPEX_CONNECT_TIMEOUT");
  }, 15_000);
});
