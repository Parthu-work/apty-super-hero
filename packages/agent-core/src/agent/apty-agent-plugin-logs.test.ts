/** What the agent logs: a failing plugin hook by plugin and hook only (its error can carry page data), and its own lines under its own prefix. */
import type { Model, ModelRequest, StreamEvent } from "@openai/agents";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { tool } from "../tools/index.js";
import type { AgentPlugin, FunctionTool } from "../types.js";
import { AptyAgent } from "./apty-agent.js";

const SECRET = "PATIENT-884213 Jane Testpatient";

function textModel() {
  const model: Model = {
    async getResponse() {
      throw new Error("not used");
    },
    async *getStreamedResponse(): AsyncIterable<StreamEvent> {
      yield { type: "output_text_delta", delta: "Hi" } as StreamEvent;
      yield {
        type: "response_done",
        response: {
          id: "resp_1",
          usage: {
            requests: 1,
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
          },
          output: [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "Hi" }],
            },
          ],
        },
      } as StreamEvent;
    },
  };
  return model as unknown as Parameters<typeof AptyAgent.create>[0]["model"];
}

const fail = () => {
  throw new Error(`page said: ${SECRET}`);
};

afterEach(() => vi.restoreAllMocks());

describe("plugin failures", () => {
  it("log the plugin and hook, never the error's message", async () => {
    const logged: unknown[][] = [];
    for (const level of ["error", "warn", "log", "debug", "info"] as const) {
      vi.spyOn(console, level).mockImplementation((...args) => {
        logged.push(args);
      });
    }
    const plugin: AgentPlugin = {
      id: "leaky-plugin",
      setup: fail,
      hooks: {
        beforeChat: fail,
        afterResponse: fail,
        onToolEvent: fail,
        onMetrics: fail,
      },
    };
    const agent = AptyAgent.create({
      instructions: "Test",
      model: textModel(),
      plugins: [plugin],
    });

    for await (const _event of agent.chat("hello")) {
      // drain
    }

    const text = logged
      .flat()
      .map((arg) =>
        arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg),
      )
      .join("\n");
    expect(text).toContain("leaky-plugin");
    expect(text).toMatch(/beforeChat/);
    expect(text).not.toContain("PATIENT-884213");
    expect(text).not.toContain("Testpatient");
  });
});

/** Calls `echo` once, then answers in text. */
function toolCallingModel() {
  const done = (output: unknown[]) =>
    ({
      type: "response_done",
      response: {
        id: "resp",
        usage: { requests: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        output,
      },
    }) as StreamEvent;
  const model: Model = {
    async getResponse() {
      throw new Error("not used");
    },
    async *getStreamedResponse(
      request: ModelRequest,
    ): AsyncIterable<StreamEvent> {
      const answered =
        Array.isArray(request.input) &&
        request.input.some(
          (item) => (item as { type?: string }).type === "function_call_result",
        );
      yield answered
        ? done([
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "Done" }],
            },
          ])
        : done([
            {
              type: "function_call",
              callId: "call_1",
              name: "echo",
              arguments: "{}",
              status: "completed",
            },
          ]);
    },
  };
  return model as unknown as Parameters<typeof AptyAgent.create>[0]["model"];
}

describe("agent log lines", () => {
  it("carry the AptyAgent prefix", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const echo = tool({
      name: "echo",
      description: "Echoes",
      parameters: z.object({}),
      execute: async () => "ok",
    }) as unknown as FunctionTool;
    const agent = AptyAgent.create({
      instructions: "Test",
      model: toolCallingModel(),
      tools: [echo],
    });

    for await (const _event of agent.chat("hello")) {
      // drain
    }

    const prefixes = debug.mock.calls.map(([prefix]) => prefix);
    expect(prefixes).toContain("[AptyAgent]");
  });
});
