import { setLogLevel } from "@apty/agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tools = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("../tools/index.js", () => ({
  allBrowserTools: [
    { name: "get_current_tab", invoke: tools.invoke },
    { name: "organize_tabs", invoke: tools.invoke },
  ],
}));
vi.mock("../apty/evidence-store.js", () => ({
  evidenceRestored: Promise.resolve(),
}));
vi.mock("../apty/investigation-session.js", () => ({
  investigationsRestored: Promise.resolve(),
}));

class FakeWebSocket {
  key = "";
  seq = 0;
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: any[] = [];
  onopen?: () => void;
  onerror?: () => void;
  onclose?: () => void;
  onmessage?: (event: { data: string }) => void;
  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {
    FakeWebSocket.instances.push(this);
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  fail() {
    this.onerror?.();
    this.onclose?.();
  }
  allSent: unknown[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
    this.allSent.push(JSON.parse(data));
  }
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.();
  });
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const storage: Record<string, unknown> = {};
const alarms = { create: vi.fn(), clear: vi.fn() };

import { callMac, daemonProof, sessionKey } from "./handshake";
import { WsMcpServer } from "./ws-mcp-server";

const TOKEN = "s3cret-token_ABC";
const URL = "ws://127.0.0.1:9223/";

function latestSocket() {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error("no socket");
  return socket;
}

const DAEMON_NONCE = "b".repeat(64);

/** Plays the daemon's half of the challenge, then clears what was sent so tests see only their own traffic. */
async function connected(server: WsMcpServer) {
  const token = TOKEN;
  const connecting = server.connect(URL, TOKEN);
  const socket = latestSocket();
  socket.open();
  await vi.waitFor(() =>
    expect(socket.sent.some((m) => m.method === "auth/challenge")).toBe(true),
  );
  const challenge = socket.sent.find((m) => m.method === "auth/challenge");
  const extNonce = challenge.params.nonce;
  socket.receive({
    jsonrpc: "2.0",
    id: challenge.id,
    result: {
      nonce: DAEMON_NONCE,
      proof: await daemonProof(token, extNonce, DAEMON_NONCE),
    },
  });
  await vi.waitFor(() =>
    expect(socket.sent.some((m) => m.method === "auth/prove")).toBe(true),
  );
  const prove = socket.sent.find((m) => m.method === "auth/prove");
  socket.receive({ jsonrpc: "2.0", id: prove.id, result: { ok: true } });
  await connecting;
  socket.key = await sessionKey(token, extNonce, DAEMON_NONCE);
  socket.sent = [];
  return socket;
}

/** A tools/call signed the way the daemon signs it. */
interface RpcMessage {
  method?: string;
  params?: { name?: unknown; arguments?: unknown };
  [key: string]: unknown;
}

async function signed(socket: FakeWebSocket, message: RpcMessage) {
  if (message.method !== "tools/call") return message;
  const seq = ++socket.seq;
  const params = message.params ?? {};
  return {
    ...message,
    params: {
      ...params,
      seq,
      mac: await callMac(
        socket.key,
        seq,
        String(params.name),
        params.arguments ?? {},
      ),
    },
  };
}

async function call(socket: FakeWebSocket, message: RpcMessage) {
  const before = socket.sent.length;
  socket.receive(await signed(socket, message));
  await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(before));
  return socket.sent.at(-1);
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  tools.invoke.mockReset();
  for (const key of Object.keys(storage)) delete storage[key];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  vi.stubGlobal("chrome", {
    alarms,
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn((items: Record<string, unknown>) =>
          Object.assign(storage, items),
        ),
        remove: vi.fn((keys: string[]) => {
          for (const key of keys) delete storage[key];
        }),
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WsMcpServer.connect", () => {
  it.each([
    ["ws://evil.example:9223/", /Only localhost connections are allowed/],
    ["http://localhost:9223/", /must use ws:\/\/ or wss:\/\//],
    ["not a url", /Invalid WebSocket URL/],
  ])("refuses %s before opening a socket", async (url, error) => {
    await expect(new WsMcpServer().connect(url, TOKEN)).rejects.toThrow(error);
    expect(FakeWebSocket.instances).toEqual([]);
  });

  it("refuses a token a handshake cannot carry", async () => {
    await expect(new WsMcpServer().connect(URL, "has space")).rejects.toThrow(
      /characters a WebSocket handshake can't carry/,
    );
    expect(FakeWebSocket.instances).toEqual([]);
  });

  it("never sends the token, in the handshake, a message, the URL or the status, and keeps it for the next start", async () => {
    const server = new WsMcpServer();
    const statuses: unknown[] = [];
    server.onStatusChange((state) => statuses.push(state));
    const socket = await connected(server);

    expect(socket.url).toBe(URL);
    expect(socket.protocols).toEqual(["apty-mcp.v1", "apty-auth.hmac-v1"]);
    expect(JSON.stringify(socket.allSent)).not.toContain(TOKEN);
    expect(server.getStatus()).toMatchObject({ status: "connected", url: URL });
    expect(JSON.stringify([server.getStatus(), statuses])).not.toContain(TOKEN);
    expect(await server.getSavedUrl()).toBe(URL);
    expect(await server.getSavedToken()).toBe(TOKEN);
    expect(alarms.create).toHaveBeenCalledWith("ws-mcp-keepalive", {
      periodInMinutes: 0.4,
    });
  });

  it("forgets the saved token on disconnect and does not reconnect", async () => {
    vi.useFakeTimers();
    const server = new WsMcpServer();
    const socket = await connected(server);

    await server.disconnect();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(socket.close).toHaveBeenCalledWith(1000);
    expect(server.getStatus().status).toBe("disconnected");
    expect(await server.getSavedToken()).toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("reconnects with backoff after the daemon closes the connection", async () => {
    vi.useFakeTimers();
    const server = new WsMcpServer();
    const socket = await connected(server);

    socket.onclose?.();
    expect(server.getStatus().status).toBe("disconnected");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(latestSocket().protocols).toEqual([
      "apty-mcp.v1",
      "apty-auth.hmac-v1",
    ]);
  });

  it("reports a failed handshake and schedules a retry", async () => {
    vi.useFakeTimers();
    const server = new WsMcpServer();
    const connecting = server.connect(URL, TOKEN);
    latestSocket().fail();

    await expect(connecting).rejects.toThrow("WebSocket error");
    expect(server.getStatus()).toMatchObject({
      status: "error",
      error: "WebSocket error",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await server.disconnect();
  });
});

describe("WsMcpServer reconnecting during a stalled handshake", () => {
  async function answerHandshake(socket: FakeWebSocket) {
    await vi.waitFor(() =>
      expect(socket.sent.some((m) => m.method === "auth/challenge")).toBe(true),
    );
    const challenge = socket.sent.find((m) => m.method === "auth/challenge");
    socket.receive({
      jsonrpc: "2.0",
      id: challenge.id,
      result: {
        nonce: DAEMON_NONCE,
        proof: await daemonProof(TOKEN, challenge.params.nonce, DAEMON_NONCE),
      },
    });
    await vi.waitFor(() =>
      expect(socket.sent.some((m) => m.method === "auth/prove")).toBe(true),
    );
    const prove = socket.sent.find((m) => m.method === "auth/prove");
    socket.receive({ jsonrpc: "2.0", id: prove.id, result: { ok: true } });
  }

  it("keeps the newer connection when an abandoned handshake times out", async () => {
    vi.useFakeTimers();
    const server = new WsMcpServer();
    (await connected(server)).onclose?.();
    await vi.advanceTimersByTimeAsync(1_000);
    const abandoned = latestSocket();
    abandoned.open();
    await vi.waitFor(() =>
      expect(abandoned.sent.some((m) => m.method === "auth/challenge")).toBe(
        true,
      ),
    );
    abandoned.onclose?.();

    for (let i = 0; i < 10 && latestSocket() === abandoned; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }
    const current = latestSocket();
    expect(current).not.toBe(abandoned);
    current.open();
    await answerHandshake(current);
    await vi.waitFor(() => expect(server.getStatus().status).toBe("connected"));

    await vi.advanceTimersByTimeAsync(6_000);
    expect(server.getStatus().status).toBe("connected");
    expect(current.close).not.toHaveBeenCalled();
    await server.disconnect();
  });
});

describe("WsMcpServer with a daemon too old for challenge authentication", () => {
  const health = (body: unknown) =>
    vi
      .mocked(fetch)
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

  it("says to update the daemon when it answers without challenge authentication", async () => {
    health({ status: "ok", version: "3.1.0" });
    const server = new WsMcpServer();
    const connecting = server.connect(URL, TOKEN);
    latestSocket().fail();

    await expect(connecting).rejects.toThrow(/3\.1\.0.*update/i);
    expect(server.getStatus().error).toMatch(/apty-mcp-bridge 4\.0\.0/);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "http://127.0.0.1:9223/health",
      expect.anything(),
    );
    expect(JSON.stringify(vi.mocked(fetch).mock.calls)).not.toContain(TOKEN);
    await server.disconnect();
  });

  it("keeps the socket error when the daemon supports it or doesn't answer", async () => {
    health({ status: "ok", version: "4.0.0", auth: ["apty-auth.hmac-v1"] });
    const server = new WsMcpServer();
    const connecting = server.connect(URL, TOKEN);
    latestSocket().fail();
    await expect(connecting).rejects.toThrow("WebSocket error");
    await server.disconnect();
  });
});

describe("WsMcpServer requests from the daemon", () => {
  it("runs a registered tool with its arguments and returns its result as text", async () => {
    tools.invoke.mockResolvedValue({ id: 3, title: "Orders" });
    const socket = await connected(new WsMcpServer());

    const reply = await call(socket, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_current_tab", arguments: { verbose: true } },
    });

    expect(tools.invoke).toHaveBeenCalledWith({}, '{"verbose":true}');
    expect(reply).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({ id: 3, title: "Orders" }, null, 2),
          },
        ],
      },
    });
  });

  it("redacts a tool result in the current mode before an MCP client gets it", async () => {
    tools.invoke.mockResolvedValue({
      password: "hunter2-Secret",
      note: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
    });
    const socket = await connected(new WsMcpServer());

    const reply = await call(socket, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "get_current_tab", arguments: {} },
    });

    const text = JSON.stringify(reply);
    expect(text).not.toContain("hunter2-Secret");
    expect(text).not.toContain("eyJzdWIiOiIxIn0");
    expect(reply.result.content[0].type).toBe("text");
  });

  it("returns a screenshot data URL as an image block", async () => {
    tools.invoke.mockResolvedValue("data:image/png;base64,AAAA");
    const socket = await connected(new WsMcpServer());

    const reply = await call(socket, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_current_tab" },
    });

    expect(reply.result.content).toEqual([
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ]);
  });

  it("answers an unknown tool, a failing tool and a missing name as errors, never running anything else", async () => {
    tools.invoke.mockRejectedValue(new Error("denied by the user"));
    const socket = await connected(new WsMcpServer());

    const unknown = await call(socket, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "execute_skill_script" },
    });
    expect(unknown.result).toEqual({
      content: [
        { type: "text", text: "Error: Tool not found: execute_skill_script" },
      ],
      isError: true,
    });
    expect(tools.invoke).not.toHaveBeenCalled();

    const failing = await call(socket, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_current_tab" },
    });
    expect(failing.result.content[0].text).toBe("Error: denied by the user");

    const missing = await call(socket, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {},
    });
    expect(missing.error).toEqual({
      code: -32602,
      message: "Missing required parameter: name",
    });
  });

  it("answers ping and rejects other methods; ignores responses and non-JSON-RPC data", async () => {
    const socket = await connected(new WsMcpServer());

    expect(
      await call(socket, { jsonrpc: "2.0", id: 6, method: "ping" }),
    ).toEqual({ jsonrpc: "2.0", id: 6, result: {} });
    expect(
      (await call(socket, { jsonrpc: "2.0", id: 7, method: "tools/list" }))
        .error,
    ).toEqual({ code: -32601, message: "Method not found: tools/list" });

    socket.receive({ jsonrpc: "2.0", id: 8, result: {} });
    socket.receive({ id: 9, method: "ping" });
    socket.onmessage?.({ data: "{not json" });
    await Promise.resolve();
    expect(socket.sent).toHaveLength(2);
  });

  it("gives up on a tool after 60 seconds", async () => {
    vi.useFakeTimers();
    tools.invoke.mockReturnValue(new Promise(() => {}));
    const socket = await connected(new WsMcpServer());

    socket.receive(
      await signed(socket, {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "get_current_tab" },
      }),
    );
    await vi.waitFor(() => expect(tools.invoke).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(60_000);

    expect(socket.sent.at(-1).result).toEqual({
      content: [
        {
          type: "text",
          text: "Error: Tool 'get_current_tab' timed out after 60000ms",
        },
      ],
      isError: true,
    });
  });
});

describe("WsMcpServer keepalive", () => {
  it("pings on its own alarm while connected and ignores other alarms", async () => {
    const server = new WsMcpServer();
    const socket = await connected(server);

    server.handleAlarm({ name: "something-else" } as chrome.alarms.Alarm);
    server.handleAlarm({ name: "ws-mcp-keepalive" } as chrome.alarms.Alarm);
    await Promise.resolve();

    expect(socket.sent).toEqual([
      expect.objectContaining({ jsonrpc: "2.0", method: "ping" }),
    ]);
  });
});

describe("WsMcpServer logging", () => {
  afterEach(() => {
    setLogLevel("debug");
  });

  function captureConsole() {
    const lines: string[] = [];
    for (const level of ["debug", "info", "log", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(`${level} ${args.map(String).join(" ")}`);
      });
    }
    return lines;
  }

  it("never logs the token, through connect, a tool call, a reconnect and disconnect", async () => {
    vi.useFakeTimers();
    setLogLevel("debug");
    const lines = captureConsole();
    tools.invoke.mockRejectedValue(new Error("boom"));
    const server = new WsMcpServer();
    const socket = await connected(server);
    socket.receive(
      await signed(socket, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_current_tab" },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    socket.onclose?.();
    await vi.advanceTimersByTimeAsync(1_000);
    await server.disconnect();

    expect(
      lines.some((line) => line.startsWith("debug [WsMcpServer] Connected to")),
    ).toBe(true);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("prints no debug output at the production level", async () => {
    setLogLevel("warn");
    const lines = captureConsole();
    const server = new WsMcpServer();
    await connected(server);
    await server.disconnect();

    expect(lines).toEqual([]);
  });
});

describe("WsMcpServer mutual authentication (S6)", () => {
  async function openAndChallenge(server: WsMcpServer) {
    const connecting = server.connect(URL, TOKEN);
    const socket = latestSocket();
    socket.open();
    await vi.waitFor(() =>
      expect(socket.sent.some((m) => m.method === "auth/challenge")).toBe(true),
    );
    return { connecting, socket };
  }

  it("an impersonating daemon that cannot prove the token never receives it and its tools/call never runs", async () => {
    const server = new WsMcpServer();
    const { connecting, socket } = await openAndChallenge(server);
    const challenge = socket.sent.find((m) => m.method === "auth/challenge");
    socket.receive({
      jsonrpc: "2.0",
      id: challenge.id,
      result: { nonce: DAEMON_NONCE, proof: "0".repeat(64) },
    });
    await expect(connecting).rejects.toThrow(/could not prove/);
    socket.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_current_tab", arguments: {} },
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(JSON.stringify(socket.allSent)).not.toContain(TOKEN);
    expect(socket.protocols).not.toContain(`apty-token.${TOKEN}`);
    expect(socket.allSent.some((m) => m.method === "auth/prove")).toBe(false);
    expect(tools.invoke).not.toHaveBeenCalled();
    expect(server.getStatus().status).not.toBe("connected");
    await server.disconnect();
  });

  it("never runs a tools/call that arrives before authentication", async () => {
    const server = new WsMcpServer();
    const { connecting, socket } = await openAndChallenge(server);
    socket.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_current_tab", arguments: {} },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(tools.invoke).not.toHaveBeenCalled();
    await server.disconnect();
    await connecting.catch(() => undefined);
  });

  it("refuses an unsigned, wrongly signed or replayed tools/call", async () => {
    const socket = await connected(new WsMcpServer());
    const unsigned = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_current_tab", arguments: {} },
    };
    socket.receive(unsigned);
    socket.receive({
      ...unsigned,
      id: 3,
      params: { ...unsigned.params, seq: 1, mac: "0".repeat(64) },
    });
    const good = await signed(socket, { ...unsigned, id: 4 });
    tools.invoke.mockResolvedValue({ ok: true });
    socket.receive(good);
    await vi.waitFor(() => expect(tools.invoke).toHaveBeenCalledTimes(1));
    socket.receive({ ...good, id: 5 });
    await new Promise((r) => setTimeout(r, 20));

    expect(tools.invoke).toHaveBeenCalledTimes(1);
    const refused = socket.sent.filter((m) => m.error?.code === -32001);
    expect(refused.map((m) => m.id)).toEqual([2, 3, 5]);
  });

  it("refuses a tool the MCP bridge does not expose, even if the extension has it", async () => {
    const socket = await connected(new WsMcpServer());
    const reply = await call(socket, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "organize_tabs", arguments: {} },
    });
    expect(JSON.stringify(reply)).toMatch(/not exposed over MCP/);
    expect(tools.invoke).not.toHaveBeenCalled();
  });
});
