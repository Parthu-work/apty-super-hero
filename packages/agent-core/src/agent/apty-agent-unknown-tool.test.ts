/**
 * The model may call a tool that wasn't offered for this message (the side
 * panel offers tools by relevance). With the real @openai/agents run(), the
 * user must still get an answer or an error, never silence.
 */
import type { Model, ModelRequest, StreamEvent } from "@openai/agents";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { tool } from "../tools/index.js";
import type { AgentEvent, FunctionTool } from "../types.js";
import { ErrorCode } from "../utils/errors.js";
import { AptyAgent } from "./apty-agent.js";

function done(id: string, output: unknown[]): StreamEvent {
  return {
    type: "response_done",
    response: {
      id,
      usage: { requests: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      output,
    },
  } as StreamEvent;
}

/** Calls `missing_tool` until a tool result comes back, then answers in text. */
function modelCallingMissingTool() {
  const requests: ModelRequest[] = [];
  const model: Model = {
    async getResponse() {
      throw new Error("not used");
    },
    async *getStreamedResponse(
      request: ModelRequest,
    ): AsyncIterable<StreamEvent> {
      requests.push(request);
      const hasToolResult =
        Array.isArray(request.input) &&
        request.input.some(
          (item) => (item as { type?: string }).type === "function_call_result",
        );
      if (!hasToolResult) {
        yield done("resp_1", [
          {
            type: "function_call",
            callId: "call_1",
            name: "missing_tool",
            arguments: "{}",
            status: "completed",
          },
        ]);
        return;
      }
      yield { type: "output_text_delta", delta: "Answered" } as StreamEvent;
      yield done(`resp_${requests.length}`, [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "Answered" }],
        },
      ]);
    },
  };
  return {
    model: model as unknown as Parameters<typeof AptyAgent.create>[0]["model"],
    requests,
  };
}

function namedTool(name: string, calls: string[]): FunctionTool {
  return tool({
    name,
    description: `The ${name} tool`,
    parameters: z.object({}),
    execute: async () => {
      calls.push(name);
      return "ok";
    },
  }) as unknown as FunctionTool;
}

async function collect(
  agent: AptyAgent,
  input: string,
  tools?: FunctionTool[],
) {
  const events: AgentEvent[] = [];
  for await (const event of agent.chat(input, tools ? { tools } : undefined)) {
    events.push(event);
  }
  return events;
}

const offeredNames = (request: ModelRequest) =>
  (request.tools ?? []).map((t) => (t as { name: string }).name).sort();

/** Runs `offered_tool` first, then calls `missing_tool` once that result is back. */
function modelCallingMissingToolSecond() {
  const model: Model = {
    async getResponse() {
      throw new Error("not used");
    },
    async *getStreamedResponse(
      request: ModelRequest,
    ): AsyncIterable<StreamEvent> {
      const results = Array.isArray(request.input)
        ? request.input.filter(
            (item) =>
              (item as { type?: string }).type === "function_call_result",
          ).length
        : 0;
      if (results === 0) {
        yield { type: "output_text_delta", delta: "Submitting" } as StreamEvent;
      }
      yield done(`resp_${results}`, [
        {
          type: "function_call",
          callId: `call_${results}`,
          name: results === 0 ? "offered_tool" : "missing_tool",
          arguments: "{}",
          status: "completed",
        },
      ]);
    },
  };
  return model as unknown as Parameters<typeof AptyAgent.create>[0]["model"];
}

describe("a call to a tool that wasn't offered", () => {
  it("never runs the turn again once a tool has run, naming the tool instead", async () => {
    const ran: string[] = [];
    const offered = namedTool("offered_tool", ran);
    const agent = AptyAgent.create({
      instructions: "Test",
      model: modelCallingMissingToolSecond(),
      tools: [offered, namedTool("missing_tool", ran)],
    });

    const events = await collect(agent, "submit the form", [offered]);
    const error = events.find((e) => e.type === "error");

    expect(ran).toEqual(["offered_tool"]);
    expect(error?.type === "error" && error.error.code).toBe(
      ErrorCode.TOOL_NOT_FOUND,
    );
    expect(error?.type === "error" && error.error.message).toMatch(
      /missing_tool/,
    );
    const text = events
      .map((e) => (e.type === "content_delta" ? e.delta : ""))
      .join("");
    expect(text).toBe("Submitting");
  });

  it("offers a registered tool the model asked for, runs it, and finishes the turn", async () => {
    const { model, requests } = modelCallingMissingTool();
    const ran: string[] = [];
    const offered = namedTool("offered_tool", ran);
    const agent = AptyAgent.create({
      instructions: "Test",
      model,
      tools: [offered, namedTool("missing_tool", ran)],
    });

    const events = await collect(agent, "hello", [offered]);

    expect(events.map((e) => e.type)).toContain("execution_complete");
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(ran).toEqual(["missing_tool"]);
    expect(offeredNames(requests[0] as ModelRequest)).toEqual(["offered_tool"]);
    expect(offeredNames(requests.at(-1) as ModelRequest)).toEqual([
      "missing_tool",
      "offered_tool",
    ]);
  });

  it("names a tool that doesn't exist at all, instead of reporting an API error", async () => {
    const { model } = modelCallingMissingTool();
    const ran: string[] = [];
    const agent = AptyAgent.create({
      instructions: "Test",
      model,
      tools: [namedTool("offered_tool", ran)],
    });

    const events = await collect(agent, "hello");
    const error = events.find((e) => e.type === "error");

    expect(error?.type === "error" && error.error.code).toBe(
      ErrorCode.TOOL_NOT_FOUND,
    );
    expect(error?.type === "error" && error.error.message).toMatch(
      /missing_tool/,
    );
    expect(ran).toEqual([]);
  });
});
