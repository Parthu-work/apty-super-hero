import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", () => ({ generateText }));
vi.mock("./ai-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai-provider")>()),
  createAIProvider: () => (modelId: string) => ({ modelId }),
}));
vi.mock("./tool-probe", () => ({
  probeToolCalling: vi.fn(async () => "supported"),
}));

import type { AppSettings } from "@apty/agent-core";
import { testConnection } from "./connection-check";

const settings = { aiModel: "m", aiToken: "k" } as AppSettings;

describe("testConnection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs and throws only the sanitized message, never the raw provider error", async () => {
    const raw = Object.assign(
      new Error("401 Authorization: Bearer sk-ant-abcdefghijklmnop invalid"),
      { statusCode: 401, requestBodyValues: { secret: "page text" } },
    );
    generateText.mockRejectedValue(raw);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(testConnection(settings)).rejects.toThrow(
      "401: 401 Authorization: [REDACTED] invalid",
    );

    expect(logged).toHaveBeenCalledWith(
      "Connection test failed: 401: 401 Authorization: [REDACTED] invalid",
    );
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(/sk-ant|page text/);
  });

  it("names the timeout when the request is aborted", async () => {
    generateText.mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "TimeoutError" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(testConnection(settings)).rejects.toThrow(
      /timed out after 20s/,
    );
  });
});
