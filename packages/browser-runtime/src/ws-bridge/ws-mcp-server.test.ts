import { setLogLevel } from "@apty/agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tools = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("../tools/index.js", () => ({
  allBrowserTools: [{ name: "get_current_tab", invoke: tools.invoke }],
}));
vi.mock("../apty/evidence-store.js", () => ({
  evidenceRestored: Promise.resolve(),
}));
vi.mock("../apty/investigation-session.js", () => ({
  investigationsRestored: Promise.resolve(),
}));

class FakeWebSocket {
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
  send(data: string) {
    this.sent.push(JSON.parse(data));
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

import { authProtocols, WsMcpServer } from "./ws-mcp-server";

const TOKEN = "s3cret-token_ABC";
const URL = "ws://127.0.0.1:9223/";

function latestSocket() {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error("no socket");
  return socket;
}

async function connected(server: WsMcpServer) {
  const connecting = server.connect(URL, TOKEN);
  latestSocket().open();
  await connecting;
  return latestSocket();
}

async function call(socket: FakeWebSocket, message: unknown) {
  const before = socket.sent.length;
  socket.receive(message);
  await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(before));
  return socket.sent.at(-1);
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  tools.invoke.mockReset();
  for (const key of Object.keys(storage)) delete storage[key];
  vi.stubGlobal("WebSocket", FakeWebSocket);
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

  it("sends the token only as a subprotocol, never in the URL or the status, and keeps it for the next start", async () => {
    const server = new WsMcpServer();
    const statuses: unknown[] = [];
    server.onStatusChange((state) => statuses.push(state));

    const socket = await connected(server);

    expect(socket.url).toBe(URL);
    expect(socket.protocols).toEqual(authProtocols(TOKEN));
    expect(socket.protocols).toEqual(["apty-mcp.v1", `apty-token.${TOKEN}`]);
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
    expect(latestSocket().protocols).toEqual(authProtocols(TOKEN));
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

    socket.receive({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "get_current_tab" },
    });
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
    socket.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_current_tab" },
    });
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
