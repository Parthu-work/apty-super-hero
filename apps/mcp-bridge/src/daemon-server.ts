/**
 * The daemon's actual WebSocket relay + HTTP server, as a factory
 * (`startDaemonServer`) rather than a script with top-level side effects —
 * `daemon.ts` is the thin CLI entrypoint (arg parsing, PID file, signal
 * handlers) that calls this; tests call it directly against an ephemeral
 * port (`port: 0`) with a short-lived token/extension id, with no process
 * spawned and nothing written outside a temp dir.
 *
 * Auth model (WP2): every WebSocket path (`/extension`, `/bridge`, `/cli`)
 * requires `?token=<the configured secret>` in the connection URL — the
 * only mechanism available uniformly to both the browser's native
 * `WebSocket` (no custom headers on a WS handshake) and Node `ws` clients.
 * `/extension` additionally requires an extension-shaped Origin
 * (`chrome-extension://`/`moz-extension://`) that exactly matches the
 * configured `allowedExtensionId` — and if no extension id has been
 * configured yet, every `/extension` connection is rejected outright
 * (fail closed), never "accept the first one that shows up." `GET
 * /health` stays unauthenticated, since it returns no token, no extension
 * id, and no other secret.
 */
import { createServer, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

import { tokensMatch } from "./lib/auth-token.js";
import { toolSchemas } from "./tool-schemas.js";

export interface DaemonServerOptions {
  port: number;
  host: string;
  requiredToken: string;
  /** The one extension id `/extension` connections are pinned to, or `undefined` to fail closed (reject every extension origin). */
  allowedExtensionId: string | undefined;
  /** Tool names a bridge/CLI client may call even though they're state-changing/high-risk by default (see DANGEROUS_TOOL_NAMES) — opt-in, defaults to none allowed. */
  allowDangerousTools?: boolean;
  idleTimeoutMs?: number;
  toolCallTimeoutMs?: number;
  pingIntervalMs?: number;
  pingTimeoutMs?: number;
  log?: (msg: string) => void;
  onIdleShutdown?: () => void;
}

export interface DaemonServerHandle {
  httpServer: Server;
  /** The actual bound port — differs from `options.port` when `port: 0` (an ephemeral port) was requested, as tests do. */
  port: number;
  isExtensionConnected(): boolean;
  bridgeClientCount(): number;
  shutdown(): void;
}

const DEFAULTS = {
  idleTimeoutMs: 30_000,
  toolCallTimeoutMs: 60_000,
  pingIntervalMs: 15_000,
  pingTimeoutMs: 5_000,
};

/** WS close codes in the private-use range (4000-4999, per RFC 6455 §7.4.2). */
const CLOSE_CODE_DUPLICATE_EXTENSION = 4001;

/** State-changing/high-risk tool names — blocked by default for bridge/CLI callers unless `allowDangerousTools` is explicitly set. The extension's own approval gate (packages/browser-runtime/src/tools/approval.ts) still applies on top of this for run_console_command/upload_file_to_input even when allowed here. */
const DANGEROUS_TOOL_NAMES = new Set([
  "run_console_command",
  "upload_file_to_input",
  "computer",
  "fill_element_by_uid",
  "fill_form",
  "download_image",
  "download_chat_images",
]);

function isWebPageOrigin(origin: string): boolean {
  return origin.startsWith("http://") || origin.startsWith("https://");
}

function isExtensionOrigin(origin: string): boolean {
  return (
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("moz-extension://")
  );
}

function rejectUpgrade(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\n\r\n`);
  socket.destroy();
}

export function startDaemonServer(
  options: DaemonServerOptions,
): Promise<DaemonServerHandle> {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULTS.idleTimeoutMs;
  const toolCallTimeoutMs =
    options.toolCallTimeoutMs ?? DEFAULTS.toolCallTimeoutMs;
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULTS.pingIntervalMs;
  const pingTimeoutMs = options.pingTimeoutMs ?? DEFAULTS.pingTimeoutMs;
  const log =
    options.log ??
    ((msg: string) => process.stderr.write(`[apty-daemon] ${msg}\n`));

  // ── Extension connection ──────────────────────────────────────────────

  let extensionWs: WebSocket | undefined;
  let nextExtId = 1;

  interface PendingExtCall {
    bridgeSocket: WebSocket;
    bridgeReqId: number | string;
    timer: ReturnType<typeof setTimeout>;
  }

  const pendingExtCalls = new Map<number, PendingExtCall>();
  let extPingInterval: ReturnType<typeof setInterval> | null = null;

  function isExtensionConnected(): boolean {
    return !!extensionWs && extensionWs.readyState === WebSocket.OPEN;
  }

  function rejectAllPendingExt(reason: string): void {
    for (const [, entry] of pendingExtCalls) {
      clearTimeout(entry.timer);
      const errResp = {
        jsonrpc: "2.0",
        id: entry.bridgeReqId,
        error: { code: -1, message: reason },
      };
      if (entry.bridgeSocket.readyState === WebSocket.OPEN) {
        entry.bridgeSocket.send(JSON.stringify(errResp));
      }
    }
    pendingExtCalls.clear();
  }

  function stopExtPing(): void {
    if (extPingInterval) {
      clearInterval(extPingInterval);
      extPingInterval = null;
    }
  }

  function startExtPing(): void {
    stopExtPing();
    extPingInterval = setInterval(() => {
      if (!isExtensionConnected()) {
        stopExtPing();
        return;
      }
      const id = nextExtId++;
      const msg = { jsonrpc: "2.0", id, method: "ping" };
      extensionWs!.send(JSON.stringify(msg));

      const timer = setTimeout(() => {
        if (pendingExtCalls.has(id)) {
          pendingExtCalls.delete(id);
          log("Extension ping timeout, closing connection");
          if (extensionWs) extensionWs.close();
        }
      }, pingTimeoutMs);

      pendingExtCalls.set(id, {
        bridgeSocket: extensionWs!,
        bridgeReqId: `ping-${id}`,
        timer,
      });
    }, pingIntervalMs);
  }

  function handleExtensionMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      log(`Failed to parse extension message: ${raw.slice(0, 200)}`);
      return;
    }

    const id = msg.id as number | undefined;
    if (id == null) return;

    const pending = pendingExtCalls.get(id);
    if (!pending) return;

    clearTimeout(pending.timer);
    pendingExtCalls.delete(id);

    const response: Record<string, unknown> = {
      jsonrpc: "2.0",
      id: pending.bridgeReqId,
    };

    if (msg.error) {
      response.error = msg.error;
    } else {
      response.result = msg.result;
    }

    if (pending.bridgeSocket.readyState === WebSocket.OPEN) {
      pending.bridgeSocket.send(JSON.stringify(response));
    }
  }

  /**
   * A second `/extension` connection while one is already live is
   * REJECTED, never allowed to silently replace it — a genuinely dead
   * (crashed, network-dropped) socket is reclaimed by the ping-timeout
   * path above, not by trusting whatever connects next.
   */
  function setExtensionSocket(ws: WebSocket): void {
    if (isExtensionConnected()) {
      log("Rejected new /extension connection: one is already active");
      try {
        ws.close(
          CLOSE_CODE_DUPLICATE_EXTENSION,
          "Another extension connection is already active",
        );
      } catch {
        ws.terminate();
      }
      return;
    }

    extensionWs = ws;

    ws.on("message", (data) => handleExtensionMessage(data.toString()));

    ws.on("close", () => {
      if (extensionWs === ws) {
        log("Extension disconnected");
        stopExtPing();
        rejectAllPendingExt("Extension disconnected");
        extensionWs = undefined;
        resetIdleTimer();
      }
    });

    ws.on("error", (err) => {
      log(`Extension WebSocket error: ${err.message}`);
    });

    startExtPing();
    resetIdleTimer();
    log("Extension connected");
  }

  function forwardToolCall(
    bridgeSocket: WebSocket,
    bridgeReqId: number | string,
    toolName: string,
    args: Record<string, unknown>,
  ): void {
    if (!isExtensionConnected()) {
      const errResp = {
        jsonrpc: "2.0",
        id: bridgeReqId,
        error: {
          code: -1,
          message:
            "Apty Agent extension is not connected. To connect:\n" +
            "1. Open Chrome → Apty Agent extension → Options page\n" +
            `2. Set WebSocket URL to ws://localhost:${handle.port}/extension (with your configured token)\n` +
            "3. Click Connect",
        },
      };
      if (bridgeSocket.readyState === WebSocket.OPEN) {
        bridgeSocket.send(JSON.stringify(errResp));
      }
      return;
    }

    const extId = nextExtId++;
    const msg = {
      jsonrpc: "2.0",
      id: extId,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    };
    extensionWs!.send(JSON.stringify(msg));

    const timer = setTimeout(() => {
      if (pendingExtCalls.has(extId)) {
        pendingExtCalls.delete(extId);
        const timeoutResp = {
          jsonrpc: "2.0",
          id: bridgeReqId,
          error: {
            code: -1,
            message: `Tool '${toolName}' timed out after ${toolCallTimeoutMs}ms`,
          },
        };
        if (bridgeSocket.readyState === WebSocket.OPEN) {
          bridgeSocket.send(JSON.stringify(timeoutResp));
        }
      }
    }, toolCallTimeoutMs);

    pendingExtCalls.set(extId, { bridgeSocket, bridgeReqId, timer });
  }

  // ── Bridge/CLI client handling ────────────────────────────────────────

  const bridgeClients = new Set<WebSocket>();

  function handleBridgeMessage(socket: WebSocket, raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const id = msg.id as number | string | undefined;
    const method = msg.method as string | undefined;

    if (method === "tools/call") {
      const params = (msg.params ?? {}) as Record<string, unknown>;
      const name = params.name as string;
      const args = (params.arguments ?? {}) as Record<string, unknown>;

      if (DANGEROUS_TOOL_NAMES.has(name) && !options.allowDangerousTools) {
        const errResp = {
          jsonrpc: "2.0",
          id: id ?? 0,
          error: {
            code: -1,
            message:
              `Tool '${name}' is state-changing/high-risk and is blocked for bridge/CLI callers by default. ` +
              "Start the daemon with --allow-dangerous-tools to permit it.",
          },
        };
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(errResp));
        }
        return;
      }

      forwardToolCall(socket, id ?? 0, name, args);
      return;
    }

    if (method === "tools/list") {
      socket.send(
        JSON.stringify({ jsonrpc: "2.0", id, result: { tools: toolSchemas } }),
      );
      return;
    }

    if (method === "ping") {
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, result: {} }));
      return;
    }

    if (method === "status") {
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            extensionConnected: isExtensionConnected(),
            bridgeClients: bridgeClients.size,
          },
        }),
      );
      return;
    }
  }

  // ── Idle auto-shutdown ─────────────────────────────────────────────────

  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function resetIdleTimer(): void {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }

    if (bridgeClients.size === 0 && !isExtensionConnected()) {
      idleTimer = setTimeout(() => {
        log(`No connections for ${idleTimeoutMs / 1000}s, shutting down`);
        options.onIdleShutdown?.();
      }, idleTimeoutMs);
    }
  }

  // ── HTTP + WebSocket server ────────────────────────────────────────────

  const httpServer = createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          extensionConnected: isExtensionConnected(),
          bridgeClients: bridgeClients.size,
          version: "3.1.0",
        }),
      );
      return;
    }
    res.writeHead(404).end("Not found");
  });

  // Bounds worst-case memory from a single oversized/malicious frame —
  // generous enough for legitimate large payloads (base64 screenshots,
  // bulk tool results) passing through, not a target.
  const MAX_WS_PAYLOAD_BYTES = 16 * 1024 * 1024;

  const extensionWss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_PAYLOAD_BYTES,
  });
  const bridgeWss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_PAYLOAD_BYTES,
  });
  const cliWss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_PAYLOAD_BYTES,
  });

  httpServer.on("upgrade", (req, socket, head) => {
    const origin = req.headers.origin;
    const parsedUrl = new URL(req.url ?? "/", "http://localhost");
    const pathname = parsedUrl.pathname;
    const token = parsedUrl.searchParams.get("token") ?? undefined;

    // CSWSH guard: never allow a web-page origin on ANY path, regardless
    // of what else is wrong/right about the request.
    if (origin && isWebPageOrigin(origin)) {
      log(`Rejected WebSocket upgrade from web-page origin: ${origin}`);
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    if (pathname === "/extension" || pathname === "/") {
      if (!origin || !isExtensionOrigin(origin)) {
        log(
          `Rejected /extension upgrade: missing or non-extension origin (${origin ?? "none"})`,
        );
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      if (!options.allowedExtensionId) {
        log(
          "Rejected /extension upgrade: no extension id configured — failing closed",
        );
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      const expected = [
        `chrome-extension://${options.allowedExtensionId}`,
        `moz-extension://${options.allowedExtensionId}`,
      ];
      if (!expected.includes(origin)) {
        log(
          `Rejected /extension upgrade: origin ${origin} does not match configured extension id`,
        );
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
    } else if (pathname === "/bridge" || pathname === "/cli") {
      // These paths are for non-browser clients (the MCP bridge CLI/daemon
      // process, an MCP client like Claude Code) — a real client here never
      // sends an Origin header at all. The CSWSH guard above already
      // rejected any web-page origin; this additionally rejects a present
      // (but non-web-page-shaped, e.g. "null") origin too, since there's no
      // legitimate reason for one on these paths.
      if (origin) {
        log(
          `Rejected ${pathname} upgrade: unexpected Origin header present (${origin})`,
        );
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
    } else {
      socket.destroy();
      return;
    }

    // Every path above this point requires a valid token — /health is the
    // only unauthenticated route, and it's a plain HTTP GET, never a WS
    // upgrade, so it never reaches this handler at all.
    if (!tokensMatch(token, options.requiredToken)) {
      log(
        `Rejected WebSocket upgrade on ${pathname}: invalid or missing token`,
      );
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }

    if (pathname === "/extension" || pathname === "/") {
      extensionWss.handleUpgrade(req, socket, head, (ws) => {
        extensionWss.emit("connection", ws, req);
      });
    } else if (pathname === "/bridge") {
      bridgeWss.handleUpgrade(req, socket, head, (ws) => {
        bridgeWss.emit("connection", ws, req);
      });
    } else {
      cliWss.handleUpgrade(req, socket, head, (ws) => {
        cliWss.emit("connection", ws, req);
      });
    }
  });

  extensionWss.on("connection", (socket, req) => {
    const addr = req.socket.remoteAddress ?? "unknown";
    log(`Extension connected from ${addr}`);
    setExtensionSocket(socket);
  });

  bridgeWss.on("connection", (socket) => {
    bridgeClients.add(socket);
    resetIdleTimer();
    log(`Bridge client connected (total: ${bridgeClients.size})`);

    socket.on("message", (data) =>
      handleBridgeMessage(socket, data.toString()),
    );

    socket.on("close", () => {
      bridgeClients.delete(socket);
      resetIdleTimer();
      log(`Bridge client disconnected (total: ${bridgeClients.size})`);
    });

    socket.on("error", (err) => {
      log(`Bridge client error: ${err.message}`);
    });
  });

  cliWss.on("connection", (socket) => {
    bridgeClients.add(socket);
    resetIdleTimer();

    socket.on("message", (data) =>
      handleBridgeMessage(socket, data.toString()),
    );

    socket.on("close", () => {
      bridgeClients.delete(socket);
      resetIdleTimer();
    });
  });

  const handle: DaemonServerHandle = {
    httpServer,
    port: options.port,
    isExtensionConnected,
    bridgeClientCount: () => bridgeClients.size,
    shutdown: () => {
      stopExtPing();
      rejectAllPendingExt("Daemon shutting down");
      if (extensionWs) {
        extensionWs.close();
        extensionWs = undefined;
      }
      extensionWss.close();
      bridgeWss.close();
      cliWss.close();
      httpServer.close();
      if (idleTimer) clearTimeout(idleTimer);
    },
  };

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, options.host, () => {
      const addr = httpServer.address();
      handle.port = typeof addr === "object" && addr ? addr.port : options.port;
      resetIdleTimer();
      resolve(handle);
    });
  });
}
