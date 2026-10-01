/**
 * Apty MCP Daemon
 *
 * A background WebSocket relay that bridges multiple MCP bridge instances
 * to a single Apty Agent extension connection.
 *
 * Architecture:
 *
 *   bridge.ts #1 ──WS /bridge──┐
 *   bridge.ts #2 ──WS /bridge──┤── this daemon ──WS /extension──▶ Apty Agent extension
 *   apty-cli   ──WS /cli─────┘
 *
 * Spawned automatically by bridge.ts when no daemon is running.
 * Self-terminates after IDLE_TIMEOUT_MS with no connections.
 *
 * This file is the CLI entrypoint only (arg parsing, PID file, signal
 * handlers, process.exit) — the actual server + the WP2 auth/origin
 * hardening live in `daemon-server.ts`, which has no top-level side
 * effects and so can be started directly by tests.
 */

import { unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startDaemonServer } from "./daemon-server.js";
import {
  getAllowedExtensionId,
  getOrCreateToken,
  getTokenPath,
  isLoopbackHost,
  rotateToken,
  setAllowedExtensionId,
} from "./lib/auth-token.js";

const cliArgs = process.argv.slice(2);

function getArg(name: string, fallback: string): string {
  const idx = cliArgs.indexOf(name);
  return idx !== -1 && cliArgs[idx + 1] ? cliArgs[idx + 1] : fallback;
}

function log(msg: string): void {
  process.stderr.write(`[apty-daemon] ${msg}\n`);
}

if (cliArgs.includes("--print-token-path")) {
  process.stdout.write(`${getTokenPath()}\n`);
  process.exit(0);
}

if (cliArgs.includes("--rotate-token")) {
  const token = rotateToken();
  process.stderr.write(
    "New token generated. Update every already-configured client " +
      "(the extension's Options page, any other machine-local client) " +
      "with this value:\n",
  );
  process.stdout.write(`${token}\n`);
  process.exit(0);
}

if (cliArgs.includes("--print-extension-id")) {
  const id = getAllowedExtensionId();
  process.stdout.write(`${id ?? ""}\n`);
  process.exit(0);
}

const setExtensionIdIdx = cliArgs.indexOf("--set-extension-id");
if (setExtensionIdIdx !== -1) {
  const id = cliArgs[setExtensionIdIdx + 1];
  if (!id) {
    process.stderr.write("Usage: --set-extension-id <id>\n");
    process.exit(1);
  }
  setAllowedExtensionId(id);
  process.stderr.write(`Pinned extension id set to: ${id}\n`);
  process.exit(0);
}

const PORT = parseInt(getArg("--port", "9223"), 10);
const HOST = getArg("--host", "127.0.0.1");
const PID_FILE = join(homedir(), ".apty-daemon.pid");

if (!isLoopbackHost(HOST)) {
  log(
    `WARNING: --host ${HOST} is not a loopback address. The daemon (and ` +
      "the auth token it accepts) will be reachable from other machines " +
      "on the network, not just this one. Only do this if you understand " +
      "the risk — normally leave --host unset and use the default " +
      "127.0.0.1.",
  );
}

const extensionIdArg = getArg("--extension-id", "");
if (extensionIdArg) {
  setAllowedExtensionId(extensionIdArg);
}
const allowedExtensionId = extensionIdArg || getAllowedExtensionId();

const requiredToken = getOrCreateToken();

function writePidFile(): void {
  try {
    writeFileSync(PID_FILE, String(process.pid));
  } catch {
    // non-critical
  }
}

function removePidFile(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

let shutdownFn: (() => void) | null = null;

function shutdown(): void {
  shutdownFn?.();
  removePidFile();
  process.exit(0);
}

startDaemonServer({
  port: PORT,
  host: HOST,
  requiredToken,
  allowedExtensionId,
  onIdleShutdown: shutdown,
})
  .then((handle) => {
    shutdownFn = handle.shutdown;
    writePidFile();
    log(`Apty MCP Daemon started (v3.1.0) pid=${process.pid}`);
    log(
      `Extension WS:  ws://${HOST}:${handle.port}/extension?token=<your token>`,
    );
    log(`Bridge WS:     ws://${HOST}:${handle.port}/bridge?token=<your token>`);
    log(`CLI WS:        ws://${HOST}:${handle.port}/cli?token=<your token>`);
    log(`Health:        http://${HOST}:${handle.port}/health`);
    log(
      `Token path:    ${getTokenPath()} (cat it, or run with --print-token-path)`,
    );
    if (!allowedExtensionId) {
      log(
        "No extension id configured yet — ALL /extension connections will " +
          "be rejected until you set one with --extension-id <id> (find " +
          "the id in chrome://extensions with Developer mode on).",
      );
    } else {
      log(`Pinned extension id: ${allowedExtensionId}`);
    }
  })
  .catch((err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log(`Port ${PORT} already in use — another daemon is likely running`);
      process.exit(0);
    }
    log(`Server error: ${err.message}`);
    process.exit(1);
  });

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
