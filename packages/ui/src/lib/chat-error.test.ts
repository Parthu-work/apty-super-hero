import { AgentError, ErrorCode } from "@apty/agent-core";
import { describe, expect, it } from "vitest";
import {
  type ChatErrorKind,
  chatErrorInfo,
  settingsCanFix,
} from "./chat-error";

const kind = (
  message: string,
  code = ErrorCode.LLM_API_ERROR,
  context?: Record<string, unknown>,
) => chatErrorInfo(new AgentError(message, code, true, context), true).kind;

describe("chatErrorInfo", () => {
  it.each<[ErrorCode, ChatErrorKind]>([
    [ErrorCode.LLM_RATE_LIMIT, "rateLimit"],
    [ErrorCode.LLM_AUTH_ERROR, "badKey"],
    [ErrorCode.LLM_TIMEOUT, "timeout"],
    [ErrorCode.TURN_CANCELLED, "cancelled"],
    [ErrorCode.MAX_TURNS_REACHED, "stepLimit"],
  ])("maps %s to %s", (code, expected) => {
    expect(kind("x", code)).toBe(expected);
  });

  it.each([
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
    "net::ERR_INTERNET_DISCONNECTED",
  ])("reads %s as an unreachable provider, whatever its code", (message) => {
    expect(kind(message, ErrorCode.LLM_AUTH_ERROR)).toBe("network");
  });

  it("says offline before anything else when the browser is offline", () => {
    const error = new AgentError("boom", ErrorCode.LLM_RATE_LIMIT, true);
    expect(chatErrorInfo(error, false).kind).toBe("offline");
  });

  it.each<[string, Record<string, unknown> | undefined, ChatErrorKind]>([
    ["The model `gpt-9` does not exist", undefined, "notFound"],
    [
      "models/gemini-x is not found for API version v1beta",
      undefined,
      "notFound",
    ],
    ["Not Found", { statusCode: 404 }, "notFound"],
    [
      "This model's maximum context length is 8192 tokens.",
      { statusCode: 400 },
      "contextTooLong",
    ],
    ["Request Entity Too Large", { statusCode: 413 }, "contextTooLong"],
    [
      "prompt is too long: 210000 tokens > 200000 maximum",
      undefined,
      "contextTooLong",
    ],
    [
      "registry.ollama.ai/library/gemma does not support tools",
      undefined,
      "toolCalling",
    ],
    [
      "Function calling is not supported by this model",
      undefined,
      "toolCalling",
    ],
    ["Internal server error", { statusCode: 500 }, "unknown"],
  ])("classifies %j from the provider's text and status", (message, context, expected) => {
    expect(kind(message, ErrorCode.LLM_API_ERROR, context)).toBe(expected);
  });

  it("keeps the provider's message and drops stack lines", () => {
    const info = chatErrorInfo(
      new AgentError(
        "Bad request\n    at fetch (provider.js:10:3)\n    at run (agent.js:5:1)",
        ErrorCode.LLM_API_ERROR,
      ),
      true,
    );
    expect(info.message).toBe("Bad request");
  });

  it("masks a key or token the provider echoed back", () => {
    const info = chatErrorInfo(
      new AgentError(
        "Incorrect API key provided: sk-proj-abcdefghijklmnop. Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
        ErrorCode.LLM_AUTH_ERROR,
      ),
      true,
    );
    expect(info.message).toBe(
      "Incorrect API key provided: [REDACTED]. Authorization: [REDACTED]",
    );
  });

  it("carries a positive retry-after and leaves out anything else", () => {
    const withRetry = new AgentError("x", ErrorCode.LLM_RATE_LIMIT, true, {
      retryAfterMs: 12_000,
    });
    const zero = new AgentError("x", ErrorCode.LLM_RATE_LIMIT, true, {
      retryAfterMs: 0,
    });
    expect(chatErrorInfo(withRetry, true).retryAfterMs).toBe(12_000);
    expect(chatErrorInfo(zero, true)).not.toHaveProperty("retryAfterMs");
  });
});

describe("settingsCanFix", () => {
  it("offers the provider settings only for what they can fix", () => {
    const fixable = (
      [
        "badKey",
        "rateLimit",
        "offline",
        "network",
        "notFound",
        "toolCalling",
        "contextTooLong",
        "timeout",
        "cancelled",
        "stepLimit",
        "unknown",
      ] as const
    ).filter(settingsCanFix);
    expect(fixable).toEqual(["badKey", "network", "notFound", "toolCalling"]);
  });
});
