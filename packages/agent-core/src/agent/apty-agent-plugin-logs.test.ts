/** A failing plugin hook is logged by plugin and hook only: its error can carry page data. */
import type { Model, StreamEvent } from "@openai/agents";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPlugin } from "../types.js";
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
