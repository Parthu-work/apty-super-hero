import type { Model, ModelRequest, StreamEvent } from "@openai/agents";
import { describe, expect, it, vi } from "vitest";
import { ConversationManager } from "../conversation/manager.js";
import { SessionStorage } from "../conversation/storage.js";
import { InMemoryStorage } from "../storage/memory.js";
import type { AgentEvent, AgentPlugin, LocalResponder } from "../types.js";
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
      yield {
        type: "output_text_delta",
        delta: "From the model",
      } as StreamEvent;
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
              content: [{ type: "output_text", text: "From the model" }],
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

const ANSWER = {
  toolName: "run_diagnosis",
  params: { kind: "workflow" },
  result: { verdict: { status: "cause_found" } },
  transcript: 'Check result: "Hide from widget" is on (rule CNV-03).',
};

function agentWith(
  localResponder: LocalResponder,
  plugins: AgentPlugin[] = [],
) {
  const { model, requests } = recordingModel();
  const conversationManager = new ConversationManager(
    new SessionStorage(new InMemoryStorage()),
  );
  const agent = AptyAgent.create({
    model,
    instructions: "test",
    conversationManager,
    localResponder,
    plugins,
  });
  return { agent, requests, conversationManager };
}

async function collect(events: AsyncGenerator<AgentEvent>) {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("AptyAgent local answers", () => {
  it("answers a message with no model call, as a completed tool call", async () => {
    const responder = vi.fn(() => ANSWER);
    const { agent, requests } = agentWith(responder);

    const events = await collect(
      agent.chat("my workflow is not visible", { runContext: { tab: 7 } }),
    );

    expect(requests).toHaveLength(0);
    expect(responder).toHaveBeenCalledWith("my workflow is not visible", {
      runContext: { tab: 7 },
      sessionId: undefined,
    });
    expect(events.map((e) => e.type)).toEqual([
      "session_created",
      "tool_call_start",
      "tool_call_complete",
      "metrics_update",
      "execution_complete",
    ]);
    expect(events).toContainEqual({
      type: "tool_call_complete",
      toolName: "run_diagnosis",
      result: ANSWER.result,
    });
    const metrics = events.find((e) => e.type === "metrics_update");
    expect(
      metrics?.type === "metrics_update" && metrics.metrics.tokensUsed,
    ).toBe(0);
  });

  it("keeps the turn as a tool call and its result, so the next model turn reads them", async () => {
    let answered = false;
    const { agent, requests, conversationManager } = agentWith(() => {
      if (answered) return undefined;
      answered = true;
      return ANSWER;
    });

    const first = await collect(agent.chat("my workflow is not visible"));
    const created = first.find((e) => e.type === "session_created");
    const sessionId =
      created?.type === "session_created" ? created.sessionId : "";
    await collect(agent.chat("how do I fix it?", { sessionId }));

    const items = (await (
      await conversationManager.getSession(sessionId)
    )?.getItems()) as Array<Record<string, unknown>>;
    const [user, call, result, closing] = items;
    expect(user).toMatchObject({
      role: "user",
      content: "my workflow is not visible",
    });
    expect(call).toMatchObject({
      type: "function_call",
      name: "run_diagnosis",
      arguments: JSON.stringify(ANSWER.params),
    });
    expect(result).toMatchObject({
      type: "function_call_result",
      callId: call?.callId,
      name: "run_diagnosis",
      output: { type: "text", text: ANSWER.transcript },
    });
    expect(closing).toMatchObject({ type: "message", role: "assistant" });

    expect(requests).toHaveLength(1);
    const sent = requests[0]?.input as Array<Record<string, unknown>>;
    expect(sent.map((item) => item.type ?? "message")).toEqual([
      "message",
      "function_call",
      "function_call_result",
      "message",
      "message",
    ]);
    expect(JSON.stringify(sent)).toContain("CNV-03");
    expect(JSON.stringify(sent.at(-1))).toContain("how do I fix it?");
  });

  it("sends the message to the model when the responder has no answer", async () => {
    const { agent, requests } = agentWith(() => undefined);

    const events = await collect(agent.chat("hello"));

    expect(requests).toHaveLength(1);
    expect(events.some((e) => e.type === "tool_call_start")).toBe(false);
  });

  it("reports a responder failure as an error, without calling the model", async () => {
    const { agent, requests } = agentWith(() => {
      throw new Error("responder broke");
    });

    const events = await collect(agent.chat("my workflow is not visible"));

    expect(requests).toHaveLength(0);
    const error = events.find((e) => e.type === "error");
    expect(error?.type === "error" && error.error.message).toBe(
      "responder broke",
    );
  });

  it("leaves a message with images to the model", async () => {
    const responder = vi.fn(() => ANSWER);
    const { agent, requests } = agentWith(responder);

    await collect(
      agent.chat("what is on this screen?", {
        images: [{ image: "data:image/png;base64,AAAA" }],
      }),
    );

    expect(responder).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });

  it("tells plugins about the local tool call like any other", async () => {
    const seen: string[] = [];
    const plugin: AgentPlugin = {
      id: "observer",
      hooks: {
        onToolEvent: ({ event }) => {
          seen.push(event.type);
        },
      },
    };
    const { agent } = agentWith(() => ANSWER, [plugin]);

    await collect(agent.chat("my workflow is not visible"));

    expect(seen).toEqual(["tool_call_start", "tool_call_complete"]);
  });
});
