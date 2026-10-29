import type { Model, ModelRequest, StreamEvent } from "@openai/agents";
import { describe, expect, it } from "vitest";
import type { AgentEvent, OutboundFilter } from "../types.js";
import { AgentError, ErrorCode } from "../utils/errors.js";
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

describe("AptyAgent output cap", () => {
  it("sends the cap read at each turn, and none when it is unset", async () => {
    const { model, requests } = recordingModel();
    let cap: number | undefined = 512;
    const agent = AptyAgent.create({
      model,
      instructions: "test",
      maxOutputTokens: () => cap,
    });

    await collect(agent.chat("first"));
    cap = undefined;
    await collect(agent.chat("second"));
    cap = 2048;
    await collect(agent.chat("third"));

    expect(requests.map((r) => r.modelSettings.maxTokens)).toEqual([
      512,
      undefined,
      2048,
    ]);
  });

  it("keeps the cap when the turn offers its own tools", async () => {
    const { model, requests } = recordingModel();
    const agent = AptyAgent.create({
      model,
      instructions: "test",
      maxOutputTokens: () => 300,
    });

    await collect(agent.chat("hello", { tools: [] }));

    expect(requests[0]?.modelSettings.maxTokens).toBe(300);
  });
});

describe("AptyAgent request over budget", () => {
  it("stops the turn with the filter's error, without asking the model or retrying", async () => {
    const { model, requests } = recordingModel();
    const overBudget: OutboundFilter = () => {
      throw new AgentError(
        "This message needs about 9,000 tokens; the request budget is 6,000.",
        ErrorCode.REQUEST_OVER_BUDGET,
      );
    };
    const agent = AptyAgent.create({
      model,
      instructions: "test",
      outboundFilters: [overBudget],
    });

    const events = await collect(agent.chat("investigate"));

    expect(requests).toHaveLength(0);
    const error = events.find((e) => e.type === "error");
    expect(error?.type === "error" && error.error.code).toBe(
      ErrorCode.REQUEST_OVER_BUDGET,
    );
    expect(error?.type === "error" && error.error.message).toContain(
      "request budget is 6,000",
    );
  });
});
