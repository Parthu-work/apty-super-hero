/**
 * The retry runs against the real @openai/agents run(): a 429 from the model
 * surfaces while the stream is read, not from run() itself.
 */
import type { Model, ModelRequest, StreamEvent } from "@openai/agents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationManager } from "../conversation/manager.js";
import { SessionStorage } from "../conversation/storage.js";
import { InMemoryStorage } from "../storage/memory.js";
import type { AgentEvent } from "../types.js";
import { AptyAgent } from "./apty-agent.js";

function httpError(status: number, body = "request body with page data") {
  return Object.assign(new Error(`${status} ${body}`), { status });
}

function scriptedModel(failures: Array<Error | "stream-then-fail">) {
  let calls = 0;
  const model: Model = {
    async getResponse() {
      throw new Error("not used");
    },
    async *getStreamedResponse(
      _request: ModelRequest,
    ): AsyncIterable<StreamEvent> {
      calls += 1;
      const failure = failures[calls - 1];
      if (failure === "stream-then-fail") {
        yield { type: "output_text_delta", delta: "Partial" } as StreamEvent;
        throw httpError(503);
      }
      if (failure) throw failure;
      yield { type: "output_text_delta", delta: "Hello" } as StreamEvent;
      yield {
        type: "response_done",
        response: {
          id: `resp_${calls}`,
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
              content: [{ type: "output_text", text: "Hello" }],
            },
          ],
        },
      } as StreamEvent;
    },
  };
  return {
    model: model as unknown as Parameters<typeof AptyAgent.create>[0]["model"],
    calls: () => calls,
  };
}

async function collect(agent: AptyAgent, input: string) {
  const events: AgentEvent[] = [];
  for await (const event of agent.chat(input)) events.push(event);
  return events;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function run(agent: AptyAgent, input: string) {
  const pending = collect(agent, input);
  await vi.runAllTimersAsync();
  return pending;
}

describe("AptyAgent LLM retry with the real run()", () => {
  it("retries a 429 that happens before any output, and the user sees the reply", async () => {
    const { model, calls } = scriptedModel([httpError(429)]);
    const agent = AptyAgent.create({
      instructions: "t",
      model,
      conversation: false,
    });

    const events = await run(agent, "Hi");

    expect(calls()).toBe(2);
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    expect(
      events.filter((e) => e.type === "content_delta").map((e) => e.delta),
    ).toEqual(["Hello"]);
  });

  it("does not duplicate the user message in the session when it retries", async () => {
    const { model } = scriptedModel([httpError(500)]);
    const storage = new SessionStorage(new InMemoryStorage());
    const agent = AptyAgent.create({
      instructions: "t",
      model,
      conversationManager: new ConversationManager(storage),
    });

    const events = await run(agent, "Only once");
    const sessionId = (
      events.find((e) => e.type === "session_created") as {
        sessionId: string;
      }
    ).sessionId;
    const session = await agent.getConversationManager()?.getSession(sessionId);
    const userItems = ((await session?.getItems()) ?? []).filter(
      (item) => (item as { role?: string }).role === "user",
    );

    expect(JSON.stringify(userItems).match(/Only once/g)).toHaveLength(1);
  });

  it("never retries once output has reached the caller", async () => {
    const { model, calls } = scriptedModel(["stream-then-fail"]);
    const agent = AptyAgent.create({
      instructions: "t",
      model,
      conversation: false,
    });

    const events = await run(agent, "Hi");

    expect(calls()).toBe(1);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("does not retry a 401", async () => {
    const { model, calls } = scriptedModel([httpError(401)]);
    const agent = AptyAgent.create({
      instructions: "t",
      model,
      conversation: false,
    });

    const events = await run(agent, "Hi");

    expect(calls()).toBe(1);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("logs only the classified code and status, never the error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { model } = scriptedModel([httpError(429, "SECRET-PAGE-TEXT")]);
    const agent = AptyAgent.create({
      instructions: "t",
      model,
      conversation: false,
    });

    await run(agent, "Hi");

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain("SECRET-PAGE-TEXT");
    expect(logged).toMatch(/429/);
  });
});
