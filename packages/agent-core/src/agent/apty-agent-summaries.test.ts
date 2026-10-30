import type {
  AgentInputItem,
  Model,
  ModelRequest,
  ModelResponse,
  StreamEvent,
} from "@openai/agents";
import { Usage } from "@openai/agents";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, OutboundFilter } from "../types.js";
import { AptyAgent } from "./apty-agent.js";

const SUMMARY = "SUMMARY: the owner was noted";

/** Answers chat turns as a stream that reports no usage, and summary requests whole. */
function fakeModel(summarize: () => Promise<string>) {
  const chats: ModelRequest[] = [];
  const summaries: ModelRequest[] = [];
  const model: Model = {
    async getResponse(request: ModelRequest): Promise<ModelResponse> {
      summaries.push(request);
      const text = await summarize();
      return {
        usage: new Usage({
          requests: 1,
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        }),
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text }],
          },
        ],
      };
    },
    async *getStreamedResponse(
      request: ModelRequest,
    ): AsyncIterable<StreamEvent> {
      chats.push(request);
      yield { type: "output_text_delta", delta: "ok" } as StreamEvent;
      yield {
        type: "response_done",
        response: {
          id: `resp_${chats.length}`,
          usage: {
            requests: 1,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
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
    chats,
    summaries,
  };
}

const maskEmail: OutboundFilter = (input) =>
  JSON.parse(
    JSON.stringify(input).replaceAll("jane@example.com", "[email]"),
  ) as AgentInputItem[];

async function chatTurns(agent: AptyAgent, messages: string[]) {
  let sessionId: string | undefined;
  const events: AgentEvent[] = [];
  for (const message of messages) {
    for await (const event of agent.chat(message, { sessionId })) {
      events.push(event);
      if (event.type === "session_created") sessionId = event.sessionId;
    }
  }
  return events;
}

const TURNS = ["the owner is jane@example.com", "second question", "third"];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AptyAgent summaries of earlier turns", () => {
  it("summarizes with its own model through its outbound filters; the next turn carries the summary and the next summary builds on it", async () => {
    const { model, chats, summaries } = fakeModel(async () => SUMMARY);
    const agent = AptyAgent.create({
      model,
      instructions: "core",
      outboundFilters: [maskEmail],
      compression: {
        getTokenWatermark: () => 10,
        summarizeAfterItems: 2,
        protectRecentMessages: 2,
      },
    });

    await chatTurns(agent, TURNS);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]?.systemInstructions).toMatch(/summarizer/);
    expect(JSON.stringify(summaries[1]?.input)).toContain(SUMMARY);
    const asked = JSON.stringify(summaries[0]?.input);
    expect(asked).toContain("[email]");
    expect(asked).not.toContain("jane@example.com");
    const third = JSON.stringify(chats[2]?.input);
    expect(third).toContain(SUMMARY);
    expect(third).not.toContain("[email]");
    expect(third).toContain("second question");
  });

  it("asks for no summary while the setting reads off", async () => {
    const { model, chats, summaries } = fakeModel(async () => SUMMARY);
    const agent = AptyAgent.create({
      model,
      instructions: "core",
      compression: {
        getTokenWatermark: () => undefined,
        summarizeAfterItems: 2,
        protectRecentMessages: 2,
      },
    });

    await chatTurns(agent, TURNS);

    expect(summaries).toHaveLength(0);
    expect(JSON.stringify(chats[2]?.input)).toContain("jane@example.com");
  });

  it("finishes the turn and keeps the whole chat when the summary request fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { model, chats, summaries } = fakeModel(async () => {
      throw new Error("429 rate limited");
    });
    const agent = AptyAgent.create({
      model,
      instructions: "core",
      compression: {
        getTokenWatermark: () => 10,
        summarizeAfterItems: 2,
        protectRecentMessages: 2,
      },
    });

    const events = await chatTurns(agent, TURNS);

    expect(summaries.length).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === "execution_complete")).toHaveLength(
      3,
    );
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(JSON.stringify(chats[2]?.input)).toContain("jane@example.com");
  });
});
