import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  classifyProbeAttempt,
  PROBE_TOOL_NAME,
  type ProbeAttempt,
  probeToolCalling,
} from "./tool-probe";

const model = {} as LanguageModel;
const failed = (
  message: string,
  status?: number,
  timedOut = false,
): ProbeAttempt => ({
  kind: "failed",
  message,
  status,
  timedOut,
});

describe("classifyProbeAttempt", () => {
  it.each([
    [
      "calls the probe tool",
      { kind: "answered", toolNames: [PROBE_TOOL_NAME] },
      "yes",
    ],
    ["answers in text", { kind: "answered", toolNames: [] }, "no"],
    ["calls some other tool", { kind: "answered", toolNames: ["other"] }, "no"],
    [
      "400: tools not supported",
      failed("This model does not support tools", 400),
      "no",
    ],
    [
      "404: OpenRouter has no tool endpoint",
      failed("No endpoints found that support tool use", 404),
      "no",
    ],
    [
      "422: function calling not supported",
      failed("function calling is not supported for this model", 422),
      "no",
    ],
    ["401", failed("invalid api key", 401), null],
    [
      "500 mentioning tools",
      failed("tools service not supported right now", 500),
      null,
    ],
    ["timeout", failed("aborted", undefined, true), null],
  ] as const)("%s → %s", (_label, attempt, verdict) => {
    expect(classifyProbeAttempt(attempt as ProbeAttempt)).toBe(verdict);
  });
});

describe("probeToolCalling", () => {
  it("returns the first conclusive verdict", async () => {
    const attempt = vi.fn(
      async (): Promise<ProbeAttempt> => ({
        kind: "answered",
        toolNames: [PROBE_TOOL_NAME],
      }),
    );
    await expect(probeToolCalling(model, attempt)).resolves.toBe("yes");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries once after an inconclusive attempt", async () => {
    const attempt = vi
      .fn()
      .mockResolvedValueOnce(failed("aborted", undefined, true))
      .mockResolvedValueOnce({ kind: "answered", toolNames: [] });
    await expect(probeToolCalling(model, attempt)).resolves.toBe("no");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("is unknown after two inconclusive attempts", async () => {
    const attempt = vi.fn(async () => failed("Service Unavailable", 503));
    await expect(probeToolCalling(model, attempt)).resolves.toBe("unknown");
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});
