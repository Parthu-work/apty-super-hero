import { describe, expect, it } from "vitest";
import {
  AgentError,
  classifyLlmError,
  ErrorCode,
  LLMError,
  LLMStreamError,
  ToolError,
  ToolTimeoutError,
  TurnCancelledError,
} from "./errors.js";

describe("AgentError", () => {
  it("should create error with correct properties", () => {
    const error = new AgentError("Test error", ErrorCode.LLM_API_ERROR, true, {
      key: "value",
    });

    expect(error.message).toBe("Test error");
    expect(error.code).toBe(ErrorCode.LLM_API_ERROR);
    expect(error.recoverable).toBe(true);
    expect(error.context).toEqual({ key: "value" });
    expect(error.name).toBe("AgentError");
  });

  it("should default recoverable to false", () => {
    const error = new AgentError("Test", ErrorCode.LLM_API_ERROR);
    expect(error.recoverable).toBe(false);
  });
});

describe("LLMError", () => {
  it("should create LLM error with provider info", () => {
    const error = new LLMError(
      "API failed",
      ErrorCode.LLM_API_ERROR,
      "gemini",
      5000,
    );

    expect(error.message).toBe("API failed");
    expect(error.provider).toBe("gemini");
    expect(error.retryDelay).toBe(5000);
    expect(error.name).toBe("LLMError");
  });

  it("should mark invalid response as non-recoverable", () => {
    const error = new LLMError(
      "Invalid",
      ErrorCode.LLM_INVALID_RESPONSE,
      "gemini",
    );
    expect(error.recoverable).toBe(false);
  });

  it("should mark other errors as recoverable", () => {
    const error = new LLMError("Timeout", ErrorCode.LLM_TIMEOUT, "gemini");
    expect(error.recoverable).toBe(true);
  });
});

describe("LLMStreamError", () => {
  it("should be recoverable by default", () => {
    const error = new LLMStreamError("Stream failed", "gemini");
    expect(error.recoverable).toBe(true);
    expect(error.code).toBe(ErrorCode.LLM_STREAM_ERROR);
    expect(error.name).toBe("LLMStreamError");
  });
});

describe("ToolError", () => {
  it("should create tool error with tool name", () => {
    const error = new ToolError(
      "Execution failed",
      ErrorCode.TOOL_EXECUTION_ERROR,
      "http_fetch",
      false,
    );

    expect(error.message).toBe("Execution failed");
    expect(error.toolName).toBe("http_fetch");
    expect(error.shouldContinue).toBe(false);
    expect(error.name).toBe("ToolError");
  });

  it("should default shouldContinue to true", () => {
    const error = new ToolError(
      "Error",
      ErrorCode.TOOL_EXECUTION_ERROR,
      "test",
    );
    expect(error.shouldContinue).toBe(true);
  });
});

describe("ToolTimeoutError", () => {
  it("should format timeout message correctly", () => {
    const error = new ToolTimeoutError("http_fetch", 5000);

    expect(error.message).toBe(
      "Tool http_fetch execution timeout after 5000ms",
    );
    expect(error.code).toBe(ErrorCode.TOOL_TIMEOUT);
    expect(error.shouldContinue).toBe(true);
    expect(error.name).toBe("ToolTimeoutError");
  });
});

describe("TurnCancelledError", () => {
  it("should create non-recoverable cancellation error", () => {
    const error = new TurnCancelledError("User cancelled");

    expect(error.message).toBe("Turn cancelled: User cancelled");
    expect(error.code).toBe(ErrorCode.TURN_CANCELLED);
    expect(error.recoverable).toBe(false);
    expect(error.name).toBe("TurnCancelledError");
  });
});

describe("classifyLlmError — every failure no longer collapses to the same code", () => {
  it("passes an AgentError through unchanged", () => {
    const original = new AgentError("x", ErrorCode.TOOL_TIMEOUT, true);
    expect(classifyLlmError(original)).toEqual({
      code: ErrorCode.TOOL_TIMEOUT,
      recoverable: true,
    });
  });

  it("classifies a 429 status code as rate-limited and recoverable", () => {
    const error = Object.assign(new Error("Too Many Requests"), {
      statusCode: 429,
    });
    const result = classifyLlmError(error);
    expect(result.code).toBe(ErrorCode.LLM_RATE_LIMIT);
    expect(result.recoverable).toBe(true);
  });

  it("classifies a rate-limit MESSAGE with no status code the same way", () => {
    const error = new Error("rate limit exceeded, please slow down");
    const result = classifyLlmError(error);
    expect(result.code).toBe(ErrorCode.LLM_RATE_LIMIT);
  });

  it("extracts retry-after (seconds) from response headers as milliseconds", () => {
    const error = Object.assign(new Error("429"), {
      statusCode: 429,
      responseHeaders: { "retry-after": "12" },
    });
    expect(classifyLlmError(error).retryAfterMs).toBe(12_000);
  });

  it("treats an implausibly large retry-after value as already-milliseconds", () => {
    const error = Object.assign(new Error("429"), {
      statusCode: 429,
      responseHeaders: new Headers({ "retry-after": "9000" }),
    });
    expect(classifyLlmError(error).retryAfterMs).toBe(9000);
  });

  it("classifies 401/403 as auth errors, never recoverable", () => {
    for (const statusCode of [401, 403]) {
      const error = Object.assign(new Error("nope"), { statusCode });
      const result = classifyLlmError(error);
      expect(result.code).toBe(ErrorCode.LLM_AUTH_ERROR);
      expect(result.recoverable).toBe(false);
    }
  });

  it("classifies an 'invalid api key' message with no status code as an auth error", () => {
    const result = classifyLlmError(new Error("Invalid API key provided"));
    expect(result.code).toBe(ErrorCode.LLM_AUTH_ERROR);
  });

  it("classifies 408/504 and a 'timed out' message as LLM_TIMEOUT, recoverable", () => {
    const byStatus = classifyLlmError(
      Object.assign(new Error("x"), { statusCode: 504 }),
    );
    expect(byStatus.code).toBe(ErrorCode.LLM_TIMEOUT);
    expect(byStatus.recoverable).toBe(true);

    const byMessage = classifyLlmError(new Error("request timed out"));
    expect(byMessage.code).toBe(ErrorCode.LLM_TIMEOUT);
  });

  it("classifies a 5xx as a recoverable API error (transient), a plain 4xx as not", () => {
    const serverError = classifyLlmError(
      Object.assign(new Error("x"), { statusCode: 503 }),
    );
    expect(serverError.code).toBe(ErrorCode.LLM_API_ERROR);
    expect(serverError.recoverable).toBe(true);

    const clientError = classifyLlmError(
      Object.assign(new Error("x"), { statusCode: 422 }),
    );
    expect(clientError.code).toBe(ErrorCode.LLM_API_ERROR);
    expect(clientError.recoverable).toBe(false);
  });

  it("classifies an AbortError (and 'aborted' message) as TURN_CANCELLED", () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    expect(classifyLlmError(abortError).code).toBe(ErrorCode.TURN_CANCELLED);

    const plainAborted = new Error("request was aborted by the user");
    expect(classifyLlmError(plainAborted).code).toBe(ErrorCode.TURN_CANCELLED);
  });

  it("follows one level of `.cause` nesting to find a status code", () => {
    const wrapped = new Error("wrapped");
    (wrapped as unknown as { cause: unknown }).cause = Object.assign(
      new Error("inner"),
      { statusCode: 429 },
    );
    expect(classifyLlmError(wrapped).code).toBe(ErrorCode.LLM_RATE_LIMIT);
  });

  it("falls back to a generic, recoverable API error for a totally unrecognized failure", () => {
    const result = classifyLlmError(new Error("something weird happened"));
    expect(result.code).toBe(ErrorCode.LLM_API_ERROR);
    expect(result.recoverable).toBe(true);
  });
});
