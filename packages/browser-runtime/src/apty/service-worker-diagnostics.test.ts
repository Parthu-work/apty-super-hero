import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConfiguredServiceWorkerDiagnosticsProvider,
  NotConfiguredServiceWorkerDiagnosticsProvider,
} from "./service-worker-diagnostics";

const mockSendMessage = vi.fn();

(global as any).chrome = {
  runtime: {
    sendMessage: mockSendMessage,
    lastError: undefined as { message: string } | undefined,
  },
};

function respondWith(response: unknown) {
  mockSendMessage.mockImplementation(
    (
      _extensionId: string,
      _message: unknown,
      callback: (response: unknown) => void,
    ) => {
      callback(response);
    },
  );
}

function respondWithLastError() {
  mockSendMessage.mockImplementation(
    (
      _extensionId: string,
      _message: unknown,
      callback: (response: unknown) => void,
    ) => {
      (global as any).chrome.runtime.lastError = {
        message: "Could not establish connection",
      };
      callback(undefined);
      (global as any).chrome.runtime.lastError = undefined;
    },
  );
}

function neverRespond() {
  mockSendMessage.mockImplementation(() => {
    // callback never invoked — simulates a hung/unresponsive extension
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockSendMessage.mockReset();
  (global as any).chrome.runtime.lastError = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NotConfiguredServiceWorkerDiagnosticsProvider", () => {
  it("reports not_configured status and no logs", async () => {
    const provider = new NotConfiguredServiceWorkerDiagnosticsProvider();
    await expect(provider.getStatus()).resolves.toEqual({
      status: "not_configured",
    });
    await expect(provider.getLogs()).resolves.toEqual([]);
  });
});

describe("ConfiguredServiceWorkerDiagnosticsProvider — extension messaging", () => {
  it("returns not_configured when neither extensionId nor endpoint is set", async () => {
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({});
    await expect(provider.getStatus()).resolves.toEqual({
      status: "not_configured",
    });
    await expect(provider.getLogs()).resolves.toEqual([]);
  });

  it("returns ok status with a valid response", async () => {
    respondWith({ running: true, lastActivity: 1700000000000 });
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
      extensionId: "widget-ext-id",
    });

    await expect(provider.getStatus()).resolves.toEqual({
      status: "ok",
      running: true,
      lastActivity: 1700000000000,
    });
    expect(mockSendMessage).toHaveBeenCalledWith(
      "widget-ext-id",
      { type: "apty-debug-agent:get-service-worker-status" },
      expect.any(Function),
    );
  });

  it("returns unavailable when chrome.runtime.lastError is set", async () => {
    respondWithLastError();
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
      extensionId: "widget-ext-id",
    });

    await expect(provider.getStatus()).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returns unavailable when the target extension never responds (timeout)", async () => {
    neverRespond();
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
      extensionId: "widget-ext-id",
    });

    const statusPromise = provider.getStatus();
    await vi.advanceTimersByTimeAsync(3100);
    await expect(statusPromise).resolves.toEqual({ status: "unavailable" });
  });

  it("returns an error status for a malformed status response, without throwing", async () => {
    respondWith({ running: "yes" }); // wrong type
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
      extensionId: "widget-ext-id",
    });

    const result = await provider.getStatus();
    expect(result.status).toBe("error");
    expect(result.error).toBeTruthy();
  });

  it("returns and redacts valid logs", async () => {
    respondWith({
      logs: [
        { level: "error", message: "token=abc123secret", timestamp: 1 },
        { level: "log", message: "widget initialized", timestamp: 2 },
      ],
    });
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
      extensionId: "widget-ext-id",
    });

    const logs = await provider.getLogs();
    expect(logs).toEqual([
      { level: "error", message: "token=<REDACTED>", timestamp: 1 },
      { level: "log", message: "widget initialized", timestamp: 2 },
    ]);
  });

  it("returns an empty array for a malformed logs response rather than throwing", async () => {
    respondWith({ logs: [{ level: "error", message: 12345 }] }); // message not a string, timestamp missing
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
      extensionId: "widget-ext-id",
    });

    await expect(provider.getLogs()).resolves.toEqual([]);
  });

  it("rejects an oversized logs array as a defensive bound", async () => {
    const oversized = Array.from({ length: 2001 }, (_, i) => ({
      level: "log" as const,
      message: "x",
      timestamp: i,
    }));
    respondWith({ logs: oversized });
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
      extensionId: "widget-ext-id",
    });

    await expect(provider.getLogs()).resolves.toEqual([]);
  });

  it("returns an empty array when the target extension never responds", async () => {
    neverRespond();
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
      extensionId: "widget-ext-id",
    });

    const logsPromise = provider.getLogs();
    await vi.advanceTimersByTimeAsync(3100);
    await expect(logsPromise).resolves.toEqual([]);
  });
});

describe("ConfiguredServiceWorkerDiagnosticsProvider — HTTP diagnostic endpoint", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
  });

  it("returns ok status from a valid HTTP response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ running: true, lastActivity: 42 }),
    });
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
      diagnosticEndpoint: "https://apty.example/diagnostics",
    });

    await expect(provider.getStatus()).resolves.toEqual({
      status: "ok",
      running: true,
      lastActivity: 42,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://apty.example/diagnostics/status",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("returns unavailable when the endpoint responds with a non-ok status", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
      diagnosticEndpoint: "https://apty.example/diagnostics",
    });

    await expect(provider.getStatus()).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returns unavailable when the fetch itself fails (network error)", async () => {
    fetchMock.mockRejectedValue(new Error("network error"));
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
      diagnosticEndpoint: "https://apty.example/diagnostics",
    });

    await expect(provider.getStatus()).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returns an error status when the endpoint returns invalid JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
      diagnosticEndpoint: "https://apty.example/diagnostics",
    });

    const result = await provider.getStatus();
    expect(result.status).toBe("error");
  });

  it("returns and redacts logs from the HTTP endpoint", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        logs: [{ level: "warn", message: "password=hunter2", timestamp: 5 }],
      }),
    });
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
      diagnosticEndpoint: "https://apty.example/diagnostics",
    });

    await expect(provider.getLogs()).resolves.toEqual([
      { level: "warn", message: "password=<REDACTED>", timestamp: 5 },
    ]);
  });

  it("prefers extension messaging over the HTTP endpoint when both are configured", async () => {
    respondWith({ running: true, lastActivity: 1 });
    const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
      extensionId: "widget-ext-id",
      diagnosticEndpoint: "https://apty.example/diagnostics",
    });

    await provider.getStatus();
    expect(mockSendMessage).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
