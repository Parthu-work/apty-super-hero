import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { type DaemonServerHandle, startDaemonServer } from "./daemon-server.js";
import { authProtocols } from "./lib/auth-token.js";

const TOKEN = "correct-token-0123456789abcdef";
const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

let handle: DaemonServerHandle | undefined;

afterEach(() => {
  handle?.shutdown();
  handle = undefined;
});

interface AttemptResult {
  opened: boolean;
  closeCode?: number;
  statusCode?: number;
}

/** Connects a raw `ws` client against the test daemon and resolves once the outcome (open, or some form of rejection) is known — never throws on rejection, since rejection is exactly what several of these tests assert. */
function attemptConnect(
  url: string,
  opts: { origin?: string; token?: string } = {},
): Promise<{ ws: WebSocket; result: Promise<AttemptResult> }> {
  const headers = opts.origin ? { Origin: opts.origin } : undefined;
  const protocols =
    opts.token === undefined ? undefined : authProtocols(opts.token);
  const ws = new WebSocket(url, protocols, { headers });

  const result = new Promise<AttemptResult>((resolve) => {
    let settled = false;
    let opened = false;
    let closeCode: number | undefined;

    const settle = (r: AttemptResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };

    ws.on("open", () => {
      opened = true;
      // The handshake succeeding (an 'open' event) doesn't mean the
      // connection survives — a duplicate-extension rejection closes it
      // immediately afterward at the application layer. Give any such
      // immediate close a moment to arrive before concluding the
      // connection was actually accepted.
      setTimeout(() => settle({ opened: true, closeCode }), 150);
    });
    ws.on("unexpected-response", (_req, res) => {
      settle({ opened: false, statusCode: res.statusCode });
    });
    ws.on("close", (code) => {
      closeCode = code;
      settle({ opened, closeCode: code });
    });
    ws.on("error", () => settle({ opened, closeCode }));

    setTimeout(() => settle({ opened, closeCode }), 2_000);
  });

  return Promise.resolve({ ws, result });
}

async function startTestDaemon(
  overrides: Partial<Parameters<typeof startDaemonServer>[0]> = {},
): Promise<DaemonServerHandle> {
  const created = await startDaemonServer({
    port: 0,
    host: "127.0.0.1",
    requiredToken: TOKEN,
    allowedExtensionId: EXTENSION_ID,
    log: () => {},
    ...overrides,
  });
  handle = created;
  return created;
}

describe("daemon-server — /extension auth", () => {
  it("correct flow: matching origin + correct token connects", async () => {
    const h = await startTestDaemon();
    const { result } = await attemptConnect(
      `ws://127.0.0.1:${h.port}/extension`,
      { token: TOKEN, origin: EXTENSION_ORIGIN },
    );
    expect(await result).toEqual({ opened: true });
    expect(h.isExtensionConnected()).toBe(true);
  });

  it("wrong token: correct origin, bad token is rejected", async () => {
    const h = await startTestDaemon();
    const { result } = await attemptConnect(
      `ws://127.0.0.1:${h.port}/extension`,
      { token: "wrong-token", origin: EXTENSION_ORIGIN },
    );
    const outcome = await result;
    expect(outcome.opened).toBe(false);
    expect(outcome.statusCode).toBe(401);
    expect(h.isExtensionConnected()).toBe(false);
  });

  it("missing token is rejected the same as a wrong one", async () => {
    const h = await startTestDaemon();
    const { result } = await attemptConnect(
      `ws://127.0.0.1:${h.port}/extension`,
      {
        origin: EXTENSION_ORIGIN,
      },
    );
    const outcome = await result;
    expect(outcome.opened).toBe(false);
    expect(outcome.statusCode).toBe(401);
  });

  it("wrong origin: correct token, origin not matching the configured extension id is rejected", async () => {
    const h = await startTestDaemon();
    const { result } = await attemptConnect(
      `ws://127.0.0.1:${h.port}/extension`,
      {
        token: TOKEN,
        origin: "chrome-extension://some-other-extension-id-0000000",
      },
    );
    const outcome = await result;
    expect(outcome.opened).toBe(false);
    expect(outcome.statusCode).toBe(403);
    expect(h.isExtensionConnected()).toBe(false);
  });

  it("origin-less client is rejected on /extension even with the correct token", async () => {
    const h = await startTestDaemon();
    const { result } = await attemptConnect(
      `ws://127.0.0.1:${h.port}/extension`,
      { token: TOKEN },
    );
    const outcome = await result;
    expect(outcome.opened).toBe(false);
    expect(outcome.statusCode).toBe(403);
  });

  it("fails closed: no extension id configured rejects every extension origin, even with the correct token", async () => {
    const h = await startTestDaemon({ allowedExtensionId: undefined });
    const { result } = await attemptConnect(
      `ws://127.0.0.1:${h.port}/extension`,
      { token: TOKEN, origin: EXTENSION_ORIGIN },
    );
    const outcome = await result;
    expect(outcome.opened).toBe(false);
    expect(outcome.statusCode).toBe(403);
  });

  it("rejects a web-page (http/https) origin outright, even with the correct token", async () => {
    const h = await startTestDaemon();
    const { result } = await attemptConnect(
      `ws://127.0.0.1:${h.port}/extension`,
      { token: TOKEN, origin: "https://evil.example.com" },
    );
    const outcome = await result;
    expect(outcome.opened).toBe(false);
    expect(outcome.statusCode).toBe(403);
  });
});

describe("daemon-server — second /extension connection", () => {
  it("rejects a second connection while the first is still open, with a clear close code", async () => {
    const h = await startTestDaemon();

    const first = await attemptConnect(`ws://127.0.0.1:${h.port}/extension`, {
      token: TOKEN,
      origin: EXTENSION_ORIGIN,
    });
    expect(await first.result).toEqual({ opened: true });
    expect(h.isExtensionConnected()).toBe(true);

    const second = await attemptConnect(`ws://127.0.0.1:${h.port}/extension`, {
      token: TOKEN,
      origin: EXTENSION_ORIGIN,
    });
    const secondOutcome = await second.result;

    // The second connection completes the WS handshake (auth/origin both
    // check out) but is then immediately closed by the application layer
    // with the duplicate-connection close code — never silently swapped in
    // for the first.
    expect(secondOutcome.closeCode).toBe(4001);

    // The first connection is unaffected.
    expect(first.ws.readyState).toBe(WebSocket.OPEN);
    expect(h.isExtensionConnected()).toBe(true);

    first.ws.close();
  });

  it("allows a clean reconnect once the first connection actually closes", async () => {
    const h = await startTestDaemon();

    const first = await attemptConnect(`ws://127.0.0.1:${h.port}/extension`, {
      token: TOKEN,
      origin: EXTENSION_ORIGIN,
    });
    expect(await first.result).toEqual({ opened: true });

    first.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(h.isExtensionConnected()).toBe(false);

    const second = await attemptConnect(`ws://127.0.0.1:${h.port}/extension`, {
      token: TOKEN,
      origin: EXTENSION_ORIGIN,
    });
    expect(await second.result).toEqual({ opened: true });
    expect(h.isExtensionConnected()).toBe(true);
    second.ws.close();
  });

  it("recovers a stale (unresponsive) extension socket via ping timeout, not by replacing it", async () => {
    // Comfortably larger than attemptConnect's own ~150ms "did an open
    // immediately get closed" grace window, so the ping-timeout mechanism
    // under test and the test harness's own timing don't race each other.
    const h = await startTestDaemon({
      pingIntervalMs: 250,
      pingTimeoutMs: 250,
    });

    const first = await attemptConnect(`ws://127.0.0.1:${h.port}/extension`, {
      token: TOKEN,
      origin: EXTENSION_ORIGIN,
    });
    expect(await first.result).toEqual({ opened: true });

    // The fake extension client never answers the daemon's app-level ping
    // (a real extension would) — simulating a crashed/unresponsive peer
    // whose TCP connection hasn't actually torn down yet.

    // While still "open" from the daemon's point of view, a second
    // connection is rejected...
    const duringStale = await attemptConnect(
      `ws://127.0.0.1:${h.port}/extension`,
      { token: TOKEN, origin: EXTENSION_ORIGIN },
    );
    const duringStaleOutcome = await duringStale.result;
    expect(duringStaleOutcome.closeCode).toBe(4001);

    // ...but once the ping interval + timeout elapse, the daemon gives up
    // on the stale socket on its own.
    await new Promise((r) => setTimeout(r, 700));
    expect(h.isExtensionConnected()).toBe(false);

    // Now a new connection succeeds normally.
    const after = await attemptConnect(`ws://127.0.0.1:${h.port}/extension`, {
      token: TOKEN,
      origin: EXTENSION_ORIGIN,
    });
    expect(await after.result).toEqual({ opened: true });
    after.ws.close();
  });
});

describe("daemon-server — /bridge and /cli auth", () => {
  it("correct flow: a Node client with no Origin header and the correct token connects on /bridge", async () => {
    const h = await startTestDaemon();
    const { result } = await attemptConnect(`ws://127.0.0.1:${h.port}/bridge`, {
      token: TOKEN,
    });
    expect(await result).toEqual({ opened: true });
  });

  it("correct flow: a Node client with no Origin header and the correct token connects on /cli", async () => {
    const h = await startTestDaemon();
    const { result } = await attemptConnect(`ws://127.0.0.1:${h.port}/cli`, {
      token: TOKEN,
    });
    expect(await result).toEqual({ opened: true });
  });

  it("rejects a token sent in the URL instead of the handshake", async () => {
    const h = await startTestDaemon();
    const { result } = await attemptConnect(
      `ws://127.0.0.1:${h.port}/bridge?token=${TOKEN}`,
    );
    const outcome = await result;
    expect(outcome.opened).toBe(false);
    expect(outcome.statusCode).toBe(401);
  });

  it("answers with the protocol name only, never echoing the token", async () => {
    const h = await startTestDaemon();
    const { ws, result } = await attemptConnect(
      `ws://127.0.0.1:${h.port}/bridge`,
      { token: TOKEN },
    );
    expect(await result).toEqual({ opened: true });
    expect(ws.protocol).toBe("apty-mcp.v1");
    ws.close();
  });

  it("wrong token is rejected on /bridge", async () => {
    const h = await startTestDaemon();
    const { result } = await attemptConnect(`ws://127.0.0.1:${h.port}/bridge`, {
      token: "nope",
    });
    const outcome = await result;
    expect(outcome.opened).toBe(false);
    expect(outcome.statusCode).toBe(401);
  });

  it("missing token is rejected on /cli", async () => {
    const h = await startTestDaemon();
    const { result } = await attemptConnect(`ws://127.0.0.1:${h.port}/cli`);
    const outcome = await result;
    expect(outcome.opened).toBe(false);
    expect(outcome.statusCode).toBe(401);
  });

  it("rejects a web-page origin on /bridge even with the correct token", async () => {
    const h = await startTestDaemon();
    const { result } = await attemptConnect(`ws://127.0.0.1:${h.port}/bridge`, {
      token: TOKEN,
      origin: "https://evil.example.com",
    });
    const outcome = await result;
    expect(outcome.opened).toBe(false);
    expect(outcome.statusCode).toBe(403);
  });

  it("rejects ANY present Origin header on /bridge, even a non-web-page one, with the correct token", async () => {
    // A real MCP bridge CLI/daemon client never sends an Origin header at
    // all — one being present at all (even a literal "null", which a
    // sandboxed/opaque-origin context can send) is itself suspicious here.
    const h = await startTestDaemon();
    const { result } = await attemptConnect(`ws://127.0.0.1:${h.port}/bridge`, {
      token: TOKEN,
      origin: "null",
    });
    const outcome = await result;
    expect(outcome.opened).toBe(false);
    expect(outcome.statusCode).toBe(403);
  });

  it("rejects a present Origin header on /cli too", async () => {
    const h = await startTestDaemon();
    const { result } = await attemptConnect(`ws://127.0.0.1:${h.port}/cli`, {
      token: TOKEN,
      origin: "null",
    });
    const outcome = await result;
    expect(outcome.opened).toBe(false);
    expect(outcome.statusCode).toBe(403);
  });
});

describe("daemon-server — dangerous tool allowlist", () => {
  /** Open a /bridge connection, send one tools/call JSON-RPC message, and resolve with the parsed response. */
  async function callTool(h: DaemonServerHandle, name: string): Promise<any> {
    const { ws, result } = await attemptConnect(
      `ws://127.0.0.1:${h.port}/bridge`,
      { token: TOKEN },
    );
    await result;
    return new Promise((resolve) => {
      ws.on("message", (data) => resolve(JSON.parse(data.toString())));
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: {} },
        }),
      );
    });
  }

  it("blocks a dangerous tool by default, never reaching the extension", async () => {
    const h = await startTestDaemon();
    const response = await callTool(h, "run_console_command");
    expect(response.error?.message).toMatch(/blocked for bridge\/CLI/i);
  });

  it("a non-dangerous tool is forwarded (reports extension-not-connected, not blocked)", async () => {
    const h = await startTestDaemon();
    const response = await callTool(h, "get_current_tab");
    expect(response.error?.message).toMatch(/not connected/i);
    expect(response.error?.message).not.toMatch(/blocked for bridge\/CLI/i);
  });

  it("allowDangerousTools:true permits a dangerous tool through to forwarding", async () => {
    const h = await startTestDaemon({ allowDangerousTools: true });
    const response = await callTool(h, "run_console_command");
    // Forwarded (not blocked) — reports extension-not-connected instead,
    // since no real extension is attached in this test.
    expect(response.error?.message).toMatch(/not connected/i);
    expect(response.error?.message).not.toMatch(/blocked for bridge\/CLI/i);
  });
});

describe("daemon-server — GET /health", () => {
  it("is unauthenticated and reveals no secrets", async () => {
    const h = await startTestDaemon();
    const res = await fetch(`http://127.0.0.1:${h.port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: "ok",
      extensionConnected: false,
      bridgeClients: 0,
      version: "3.1.0",
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain(EXTENSION_ID);
  });
});
