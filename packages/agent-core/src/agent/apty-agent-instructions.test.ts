import type {
  FunctionTool,
  Model,
  ModelRequest,
  StreamEvent,
} from "@openai/agents";
import { tool } from "@openai/agents";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentEvent, OutboundRequestContext } from "../types.js";
import { AptyAgent } from "./apty-agent.js";

function recordingModel() {
  const requests: ModelRequest[] = [];
  const model: Model = {
    async getResponse() {
      throw new Error("not used");
    },
    async *getStreamedResponse(
      request: ModelRequest,
    ): AsyncIterable<StreamEvent> {
      requests.push(request);
      yield { type: "output_text_delta", delta: "ok" } as StreamEvent;
      yield {
        type: "response_done",
        response: {
          id: `resp_${requests.length}`,
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
              content: [{ type: "output_text", text: "ok" }],
            },
          ],
        },
      } as StreamEvent;
    },
  };
  return {
    model: model as unknown as Parameters<typeof AptyAgent.create>[0]["model"],
    requests,
  };
}

async function collect(events: AsyncGenerator<AgentEvent>) {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const probe = (name: string) =>
  tool({
    name,
    description: `the ${name} tool`,
    parameters: z.object({}),
    execute: async () => "done",
  }) as unknown as FunctionTool;

describe("AptyAgent instructions per call", () => {
  it("sends the instructions composed from the tools each turn offers, and the filters see them", async () => {
    const { model, requests } = recordingModel();
    const seen: Array<OutboundRequestContext["instructions"]> = [];
    const agent = AptyAgent.create({
      model,
      instructions: "core",
      instructionsFor: (tools) =>
        ["core", ...tools.map((t) => `about ${t.name}`)].join("\n"),
      outboundFilters: [
        (input, request) => {
          seen.push(request.instructions);
          return input;
        },
      ],
    });

    await collect(agent.chat("hi", { tools: [] }));
    await collect(agent.chat("check", { tools: [probe("audit")] }));

    expect(requests.map((r) => r.systemInstructions)).toEqual([
      "core",
      "core\nabout audit",
    ]);
    expect(seen).toEqual(["core", "core\nabout audit"]);
  });

  it("sends the agent's own instructions unchanged without a composer", async () => {
    const { model, requests } = recordingModel();
    const agent = AptyAgent.create({ model, instructions: "fixed" });

    await collect(agent.chat("check", { tools: [probe("audit")] }));

    expect(requests[0]?.systemInstructions).toBe("fixed");
  });
});
