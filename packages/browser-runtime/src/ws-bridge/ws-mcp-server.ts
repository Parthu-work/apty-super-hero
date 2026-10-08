/**
 * WebSocket command executor for the Apty Agent extension.
 *
 * Connects as a WebSocket client to apty-mcp-bridge and listens
 * for tool execution commands. The bridge is the true MCP server — this
 * class simply executes tools and returns results.
 *
 * Handles:
 *   - tools/call   -- executes a tool from allBrowserTools
 *   - ping         -- responds with {} for keepalive
 *
 * No MCP protocol negotiation (initialize, tools/list) is needed on this
 * side — the bridge handles that entirely with static tool schemas.
 */

import type { FunctionTool } from "@apty/agent-core";
import { createLogger } from "@apty/agent-core";
import { evidenceRestored } from "../apty/evidence-store.js";
import { investigationsRestored } from "../apty/investigation-session.js";
import { allBrowserTools } from "../tools/index.js";
import {
  type JSONRPCMessage,
  type JSONRPCRequest,
  WebSocketClientTransport,
} from "./ws-transport.js";

const log = createLogger("WsMcpServer");

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface WsMcpServerState {
  status: ConnectionStatus;
  url: string | null;
  error: string | null;
  connectedAt: number | null;
  reconnectAttempt: number;
}

type StatusListener = (state: WsMcpServerState) => void;

const KEEPALIVE_ALARM_NAME = "ws-mcp-keepalive";
const KEEPALIVE_INTERVAL_MINUTES = 0.4;
const TOOL_CALL_TIMEOUT_MS = 60_000;

const STORAGE_KEY_WS_URL = "ws-mcp-url";
const STORAGE_KEY_WS_TOKEN = "ws-mcp-token";

/**
 * The daemon reads the token from the handshake's subprotocol list, never
 * the URL, so it can't leak through logs. Keep in step with
 * apps/mcp-bridge/src/lib/auth-token.ts.
 */
const HANDSHAKE_SAFE_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function authProtocols(token: string): string[] {
  return ["apty-mcp.v1", `apty-token.${token}`];
}

function getReconnectDelayMs(attempt: number): number {
  const withJitter = (base: number) =>
    Math.round(base * (0.7 + Math.random() * 0.6));
  return withJitter(Math.min(500 * 2 ** attempt, 10_000));
}

/**
 * Find a tool by name from the registered browser tools.
 */
function findBrowserTool(name: string): FunctionTool | undefined {
  return allBrowserTools.find((t) => t.name === name);
}

/**
 * Format a tool execution result into MCP content blocks.
 */
function buildMcpContent(
  data: unknown,
): Array<{ type: string; text?: string; data?: string; mimeType?: string }> {
  if (data === null || data === undefined) {
    return [{ type: "text", text: "null" }];
  }

  if (typeof data === "string") {
    // Check if it's a base64 data URL (screenshot)
    if (data.startsWith("data:image/")) {
      const commaIndex = data.indexOf(",");
      if (commaIndex > 0) {
        const mimeType = data.slice(5, data.indexOf(";"));
        const base64Data = data.slice(commaIndex + 1);
        return [{ type: "image", data: base64Data, mimeType }];
      }
    }
    return [{ type: "text", text: data }];
  }

  return [{ type: "text", text: JSON.stringify(data, null, 2) }];
}

export class WsMcpServer {
  private transport: WebSocketClientTransport | null = null;
  private state: WsMcpServerState = {
    status: "disconnected",
    url: null,
    error: null,
    connectedAt: null,
    reconnectAttempt: 0,
  };
  private listeners: Set<StatusListener> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private autoReconnectEnabled = true;
  /**
   * The daemon auth token for the current/last connection attempt — kept
   * as a private field, never on `state`, so it can never be echoed back
   * through `getStatus()`/`onStatusChange()` to anything that only needs
   * connection status (e.g. the badge, or a log line). Needed internally
   * to rebuild the authenticated URL on reconnect.
   */
  private token: string | null = null;

  private validateUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid WebSocket URL: ${url}`);
    }

    const hostname = parsed.hostname;
    const allowedHosts = ["localhost", "127.0.0.1", "[::1]", "::1"];
    if (!allowedHosts.includes(hostname)) {
      throw new Error(
        `Only localhost connections are allowed. Got: ${hostname}`,
      );
    }

    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      throw new Error(
        `URL must use ws:// or wss:// protocol. Got: ${parsed.protocol}`,
      );
    }
  }

  async connect(url: string, token: string): Promise<void> {
    this.validateUrl(url);
    if (!HANDSHAKE_SAFE_TOKEN.test(token)) {
      throw new Error(
        "The token has characters a WebSocket handshake can't carry. Copy it exactly from the token file (`node apps/mcp-bridge/dist/daemon.js --print-token-path` shows where it is).",
      );
    }
    this.cancelReconnect();

    if (
      this.state.status === "connected" ||
      this.state.status === "connecting"
    ) {
      await this.disconnect();
    }

    this.token = token;
    this.updateState({
      status: "connecting",
      url,
      error: null,
      connectedAt: null,
    });

    try {
      const transport = new WebSocketClientTransport(url, authProtocols(token));
      this.transport = transport;

      transport.onclose = () => {
        this.handleDisconnect();
      };

      transport.onerror = (error: Error) => {
        console.error("[WsMcpServer] Transport error:", error.message);
      };

      transport.onmessage = (message: JSONRPCMessage) => {
        this.handleMessage(message);
      };

      await transport.start();
      this.updateState({
        status: "connected",
        connectedAt: Date.now(),
        reconnectAttempt: 0,
      });
      this.startKeepalive();
      this.persist(url, token);
      this.autoReconnectEnabled = true;
      log.debug(`Connected to ${url}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateState({ status: "error", error: message, connectedAt: null });
      this.transport = null;
      this.scheduleReconnect(url, token);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.autoReconnectEnabled = false;
    this.cancelReconnect();
    this.stopKeepalive();

    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        // ignore close errors
      }
      this.transport = null;
    }

    this.token = null;
    this.updateState({
      status: "disconnected",
      url: null,
      error: null,
      connectedAt: null,
      reconnectAttempt: 0,
    });
    this.clearPersisted();
    log.debug("Disconnected");
  }

  isConnected(): boolean {
    return this.state.status === "connected";
  }

  getStatus(): WsMcpServerState {
    return { ...this.state };
  }

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getSavedUrl(): Promise<string | null> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY_WS_URL);
      return (result[STORAGE_KEY_WS_URL] as string) || null;
    } catch {
      return null;
    }
  }

  /** Never logged, returned from `getStatus()`, or otherwise echoed anywhere — only ever read back to feed straight into a new `connect()` call. */
  async getSavedToken(): Promise<string | null> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY_WS_TOKEN);
      return (result[STORAGE_KEY_WS_TOKEN] as string) || null;
    } catch {
      return null;
    }
  }

  // -- Auto-reconnect with exponential backoff --

  private scheduleReconnect(url: string, token: string): void {
    if (!this.autoReconnectEnabled) return;
    this.cancelReconnect();

    const attempt = this.state.reconnectAttempt;
    const delay = getReconnectDelayMs(attempt);
    log.debug(`Scheduling reconnect attempt ${attempt + 1} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.updateState({ reconnectAttempt: attempt + 1 });
      this.connect(url, token).catch(() => {
        // connect() itself schedules next retry on failure
      });
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private persist(url: string, token: string): void {
    try {
      chrome.storage.local.set({
        [STORAGE_KEY_WS_URL]: url,
        [STORAGE_KEY_WS_TOKEN]: token,
      });
    } catch {
      // ignore storage errors
    }
  }

  private clearPersisted(): void {
    try {
      chrome.storage.local.remove([STORAGE_KEY_WS_URL, STORAGE_KEY_WS_TOKEN]);
    } catch {
      // ignore
    }
  }

  // -- Message handling --

  private handleMessage(message: JSONRPCMessage): void {
    if (!("method" in message) || !("id" in message)) {
      return;
    }
    const request = message as JSONRPCRequest;
    this.handleRequest(request).catch((error) => {
      console.error("[WsMcpServer] Unhandled error processing request:", error);
      this.sendError(request.id, -32603, "Internal error");
    });
  }

  private async handleRequest(request: JSONRPCRequest): Promise<void> {
    switch (request.method) {
      case "tools/call":
        return this.handleToolsCall(request);
      case "ping":
        return this.sendResult(request.id, {});
      default:
        return this.sendError(
          request.id,
          -32601,
          `Method not found: ${request.method}`,
        );
    }
  }

  private async handleToolsCall(request: JSONRPCRequest): Promise<void> {
    const params = (request.params || {}) as Record<string, unknown>;
    const name = params.name as string | undefined;
    const args = (params.arguments || {}) as Record<string, unknown>;

    if (!name) {
      return this.sendError(
        request.id,
        -32602,
        "Missing required parameter: name",
      );
    }

    try {
      const toolExecution = this.executeTool(name, args);

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Tool '${name}' timed out after ${TOOL_CALL_TIMEOUT_MS}ms`,
              ),
            ),
          TOOL_CALL_TIMEOUT_MS,
        );
      });

      const result = await Promise.race([
        toolExecution,
        timeoutPromise,
      ]).finally(() => clearTimeout(timer));

      await this.sendResult(request.id, {
        content: buildMcpContent(result),
      });
    } catch (error) {
      await this.sendResult(request.id, {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      });
    }
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const browserTool = findBrowserTool(name);
    if (!browserTool) {
      throw new Error(`Tool not found: ${name}`);
    }

    // A call can arrive right after the service worker woke up.
    await Promise.all([evidenceRestored, investigationsRestored]);

    // FunctionTool.invoke(runContext, inputJsonString, details?)
    // We pass an empty object as RunContext since we're outside the agent loop.
    return await (browserTool as any).invoke({} as any, JSON.stringify(args));
  }

  private async sendResult(
    id: string | number,
    result: unknown,
  ): Promise<void> {
    if (!this.transport) return;
    await this.transport.send({
      jsonrpc: "2.0",
      id,
      result,
    } as JSONRPCMessage);
  }

  private async sendError(
    id: string | number,
    code: number,
    message: string,
  ): Promise<void> {
    if (!this.transport) return;
    await this.transport.send({
      jsonrpc: "2.0",
      id,
      error: { code, message },
    } as JSONRPCMessage);
  }

  // -- Connection lifecycle --

  private handleDisconnect(): void {
    this.stopKeepalive();
    const lastUrl = this.state.url;
    const lastToken = this.token;
    this.transport = null;
    if (this.state.status !== "disconnected") {
      this.updateState({
        status: "disconnected",
        error: null,
        connectedAt: null,
      });
      log.debug("Connection closed by remote");
      if (lastUrl && lastToken && this.autoReconnectEnabled) {
        this.scheduleReconnect(lastUrl, lastToken);
      }
    }
  }

  private updateState(partial: Partial<WsMcpServerState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      try {
        listener(this.getStatus());
      } catch {
        // don't let listener errors break us
      }
    }
  }

  // -- Service Worker Keepalive --

  private startKeepalive(): void {
    try {
      chrome.alarms.create(KEEPALIVE_ALARM_NAME, {
        periodInMinutes: KEEPALIVE_INTERVAL_MINUTES,
      });
    } catch (error) {
      console.warn("[WsMcpServer] Failed to create keepalive alarm:", error);
    }
  }

  private stopKeepalive(): void {
    try {
      chrome.alarms.clear(KEEPALIVE_ALARM_NAME);
    } catch {
      // ignore
    }
  }

  handleAlarm(alarm: chrome.alarms.Alarm): void {
    if (alarm.name !== KEEPALIVE_ALARM_NAME) return;

    if (this.state.status === "connected" && this.transport?.isOpen) {
      this.sendPing();
      return;
    }

    if (this.state.status === "connecting") {
      return;
    }

    const url = this.state.url;
    const token = this.token;
    if (url && token && this.autoReconnectEnabled) {
      this.connect(url, token).catch(() => {
        // connect() schedules its own retry on failure
      });
    }
  }

  private async sendPing(): Promise<void> {
    if (!this.transport?.isOpen) return;
    try {
      await this.transport.send({
        jsonrpc: "2.0",
        id: `ping-${Date.now()}`,
        method: "ping",
      } as JSONRPCMessage);
    } catch {
      console.warn("[WsMcpServer] Ping send failed, closing connection");
      this.handleDisconnect();
    }
  }
}

export const wsMcpServer = new WsMcpServer();
