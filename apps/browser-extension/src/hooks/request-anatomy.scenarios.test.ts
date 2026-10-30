import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  AgentError,
  type AgentInputItem,
  ConversationCompressor,
  ConversationManager,
  ErrorCode,
  InMemoryStorage,
  type SerializedSession,
  SessionStorage,
} from "@apty/agent-core";
import { createContextBudgetFilter } from "@apty/browser-runtime/runtime/context-budget";
import {
  type MeasurableItem,
  type MeasurableTool,
  measureRequest,
  type RequestAnatomy,
} from "@apty/browser-runtime/runtime/request-anatomy";
import { allBrowserTools } from "@apty/browser-runtime/tools/index";
import { createStickyToolSelector } from "@apty/browser-runtime/tools/tool-relevance";
import { composeSystemPrompt } from "@apty/ui/components/chatbot/constants";
import { describe, expect, it } from "vitest";
import {
  createOutboundFilters,
  EARLIER_TURN_SUMMARIES,
} from "./outbound-filters";

/**
 * Names the request shapes the agent produces today, with fixed synthetic
 * tool-result sizes, so every later change reports comparable numbers.
 * `npm run report:request-size` runs this file and prints the table.
 */

const user = (text: string): MeasurableItem => ({
  type: "message",
  role: "user",
  content: text,
});
const assistant = (text: string): MeasurableItem => ({
  type: "message",
  role: "assistant",
  content: text,
});
let nextCall = 0;
const call = (name: string): MeasurableItem => ({
  type: "function_call",
  name,
  callId: `call_${++nextCall}`,
  arguments: JSON.stringify({ name }),
});
const result = (chars: number, name = "read_page"): MeasurableItem => ({
  type: "function_call_result",
  name,
  callId: `call_${nextCall}`,
  output: "r".repeat(chars),
});

interface Scenario {
  name: string;
  message: string;
  history: MeasurableItem[];
  /** A request of its own, such as a summary's: these instructions and no tools. */
  instructions?: string;
}

const investigation: MeasurableItem[] = [];
for (let i = 0; i < 10; i++) {
  investigation.push(call(`step_${i}`), result(3000));
}

export const SCENARIOS: Scenario[] = [
  { name: "casual", message: "hi", history: [] },
  {
    name: "followup",
    message: "ok go ahead",
    history: [
      user("check dom health"),
      call("run_dom_health_audit"),
      result(6000),
      assistant("I can run the audit across pages. Shall I?"),
    ],
  },
  {
    name: "apty-question",
    message: "why isn't my Apty widget showing",
    history: [],
  },
  {
    name: "segments-json",
    message: "get the data from segments.json",
    history: [],
  },
  { name: "dom-health", message: "check dom health", history: [] },
  { name: "click-task", message: "click the login button", history: [] },
  {
    name: "investigation-10-turns",
    message: "why isn't my Apty widget showing",
    history: investigation,
  },
  {
    name: "long-chat-8-turns",
    message: "why isn't my Apty widget showing",
    history: Array.from({ length: 8 }, (_, i) => [
      user(`question ${i}`),
      call("read_page"),
      result(3000),
      assistant(`answer ${i}`),
    ]).flat(),
  },
  {
    name: "snapshot-heavy",
    message: "what is on this page",
    history: [call("take_snapshot"), result(60_000)],
  },
];

/** The tools the extension offers: each earlier user message is a turn of the same chat. */
function toolsFor(scenario: Scenario): MeasurableTool[] {
  if (scenario.instructions !== undefined) return [];
  const select = createStickyToolSelector();
  for (const item of scenario.history) {
    if (item.type === "message" && item.role === "user") {
      select(String(item.content), scenario.name);
    }
  }
  return select(scenario.message, scenario.name) as MeasurableTool[];
}

const instructionsFor = (scenario: Scenario, tools: MeasurableTool[]) =>
  scenario.instructions ?? composeSystemPrompt(tools);

interface RecordedRequest {
  systemInstructions?: string;
  input: MeasurableItem[];
}

/**
 * The chat after the extension's summary settings run over it, and the
 * summary request they sent, with a model that answers at the summary
 * length limit.
 */
async function summarized(history: MeasurableItem[]) {
  const requests: RecordedRequest[] = [];
  const model = {
    async getResponse(request: RecordedRequest) {
      requests.push(request);
      const text = "s".repeat(EARLIER_TURN_SUMMARIES.maxSummaryLength ?? 0);
      return {
        usage: {
          requests: 1,
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          inputTokensDetails: [],
          outputTokensDetails: [],
        },
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
  } as unknown as ConstructorParameters<typeof ConversationCompressor>[0];
  const manager = new ConversationManager(
    new SessionStorage(new InMemoryStorage<SerializedSession>()),
    {
      compressor: new ConversationCompressor(
        model,
        { ...EARLIER_TURN_SUMMARIES, getTokenWatermark: () => 0 },
        createOutboundFilters(),
      ),
    },
  );
  const session = await manager.createSession();
  await session.addItems(history as AgentInputItem[]);
  session.setMetadata("lastPromptTokens", 1);
  await manager.saveSession(session);
  return {
    history: (await session.getItems()) as MeasurableItem[],
    request: requests[0] as RecordedRequest,
  };
}

/** `sent` runs the outbound filters the extension installs; `raw` does not. */
async function measure(
  scenario: Scenario,
  sent: boolean,
): Promise<RequestAnatomy> {
  const tools = toolsFor(scenario);
  let input = [...scenario.history, user(scenario.message)];
  if (sent) {
    for (const filter of createOutboundFilters()) {
      input = (await filter(input as AgentInputItem[], {
        instructions: instructionsFor(scenario, tools),
        tools,
      })) as MeasurableItem[];
    }
  }
  return measureRequest({
    instructions: instructionsFor(scenario, tools),
    tools,
    input,
  });
}

const rows = await Promise.all(
  SCENARIOS.map(async (s) => ({
    scenario: s.name,
    ...(await measure(s, false)),
  })),
);
const sent = await Promise.all(
  SCENARIOS.map(async (s) => ({
    scenario: s.name,
    ...(await measure(s, true)),
  })),
);
/** Request budgets to report: Groq's free tier allows about 8,000 tokens a minute. */
const BUDGETS = [8_000, 12_000] as const;

/** The total sent under `budget`, or "stopped" when the request cannot fit it. */
async function measureWithBudget(
  scenario: Scenario,
  budget: number,
): Promise<number | "stopped"> {
  const tools = toolsFor(scenario);
  let input = [...scenario.history, user(scenario.message)] as AgentInputItem[];
  const filters = [
    ...createOutboundFilters(),
    createContextBudgetFilter({ getBudget: () => budget }),
  ];
  try {
    for (const filter of filters) {
      input = await filter(input, {
        instructions: instructionsFor(scenario, tools),
        tools,
      });
    }
  } catch (error) {
    if (
      error instanceof AgentError &&
      error.code === ErrorCode.REQUEST_OVER_BUDGET
    ) {
      return "stopped";
    }
    throw error;
  }
  return measureRequest({
    instructions: instructionsFor(scenario, tools),
    tools,
    input: input as unknown as MeasurableItem[],
  }).totalTokens;
}

const budgeted = await Promise.all(
  SCENARIOS.map(async (s) => {
    const row: Record<string, string | number> = { scenario: s.name };
    for (const budget of BUDGETS) {
      row[`budget${budget}`] = await measureWithBudget(s, budget);
    }
    return row;
  }),
);

const longChat = SCENARIOS.find(
  (s) => s.name === "long-chat-8-turns",
) as Scenario;
const summary = await summarized(longChat.history);
const SUMMARY_SCENARIOS: Scenario[] = [
  {
    name: "long-chat-8-turns-summarized",
    message: longChat.message,
    history: summary.history,
  },
  {
    name: "summary-request",
    message: String(summary.request.input[0]?.content ?? ""),
    history: [],
    instructions: summary.request.systemInstructions ?? "",
  },
];
const summaryRows = await Promise.all(
  SUMMARY_SCENARIOS.map(async (s) => ({
    scenario: s.name,
    ...(await measure(s, true)),
  })),
);

const byName = (list: typeof rows, name: string) =>
  list.find((r) => r.scenario === name) as (typeof rows)[number];

describe("request anatomy scenarios", () => {
  it("measures every named scenario with consistent totals", () => {
    expect(rows).toHaveLength(SCENARIOS.length);
    for (const row of rows) {
      expect(row.systemPromptTokens).toBeGreaterThan(0);
      expect(row.totalTokens).toBe(
        row.systemPromptTokens +
          row.toolSchemaTokens +
          row.historyTokens +
          row.toolResultTokens,
      );
    }
  });

  it("the outbound filters shrink only the requests that carry oversized or old results", () => {
    for (const name of ["snapshot-heavy", "long-chat-8-turns"]) {
      expect(byName(sent, name).toolResultTokens).toBeLessThan(
        byName(rows, name).toolResultTokens,
      );
    }
    expect(byName(sent, "snapshot-heavy").toolResultTokens).toBeLessThanOrEqual(
      2100,
    );
    for (const name of [
      "casual",
      "apty-question",
      "dom-health",
      "click-task",
    ]) {
      expect(byName(sent, name)).toEqual(byName(rows, name));
    }
  });

  it("a follow-up is offered the tools of the turn it continues", () => {
    const followup = byName(rows, "followup");
    expect(followup.toolCount).toBeGreaterThan(0);
    expect(followup.toolCount).toBe(byName(rows, "dom-health").toolCount);
    expect(byName(rows, "casual").toolCount).toBe(0);
  });

  it("a summary carries a long chat's earlier turns in one message, at the cost of one request without tools", () => {
    const whole = byName(sent, "long-chat-8-turns");
    const after = byName(summaryRows, "long-chat-8-turns-summarized");
    const request = byName(summaryRows, "summary-request");

    expect(after.toolCount).toBe(whole.toolCount);
    expect(after.systemPromptTokens).toBe(whole.systemPromptTokens);
    expect(after.totalTokens).toBeLessThan(whole.totalTokens);
    expect(request.toolCount).toBe(0);
    expect(request.totalTokens).toBeGreaterThan(0);
    expect(summary.request.systemInstructions).toMatch(/summarizer/);
  });

  it("a request budget sends at most the budget, or stops the request", () => {
    for (const row of budgeted) {
      const sentTotal = byName(sent, row.scenario as string).totalTokens;
      for (const budget of BUDGETS) {
        const total = row[`budget${budget}`];
        if (total === "stopped") {
          expect(sentTotal).toBeGreaterThan(budget);
        } else {
          expect(total).toBeLessThanOrEqual(Math.max(budget, 0));
          expect(total).toBeLessThanOrEqual(sentTotal);
          if (sentTotal <= budget) expect(total).toBe(sentTotal);
        }
      }
    }
  });

  it("reports the whole registry size for reference", () => {
    const all = measureRequest({
      instructions: composeSystemPrompt(allBrowserTools),
      tools: allBrowserTools as unknown as MeasurableTool[],
      input: [],
    });
    expect(all.toolCount).toBeGreaterThan(50);
    const out = process.env.REQUEST_ANATOMY_OUT;
    if (out) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(
        out,
        JSON.stringify(
          {
            registry: all,
            raw: rows,
            sent,
            budgeted,
            summaries: summaryRows,
          },
          null,
          2,
        ),
      );
    }
  });
});
