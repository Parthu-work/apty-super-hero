import {
  AgentError,
  type AgentInputItem,
  ErrorCode,
  type OutboundRequestContext,
} from "@apty/agent-core";
import { describe, expect, it } from "vitest";
import {
  createContextBudgetFilter,
  SHORTENED_MESSAGE_CHARS,
} from "./context-budget";
import { type MeasurableItem, measureRequest } from "./request-anatomy";

const REQUEST: OutboundRequestContext = {
  instructions: "s".repeat(4_000),
  tools: [],
};

const user = (text: string) =>
  ({ type: "message", role: "user", content: text }) as AgentInputItem;
const assistant = (text: string) =>
  ({
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text }],
  }) as AgentInputItem;
let calls = 0;
function toolTurn(chars: number, name = "read_page"): AgentInputItem[] {
  const callId = `c${++calls}`;
  return [
    { type: "function_call", callId, name, arguments: "{}" } as AgentInputItem,
    {
      type: "function_call_result",
      callId,
      name,
      status: "completed",
      output: { type: "text", text: "r".repeat(chars) },
    } as AgentInputItem,
  ];
}

function turn(question: string, resultChars: number, answer = "done") {
  return [user(question), ...toolTurn(resultChars), assistant(answer)];
}

const sizeOf = (items: AgentInputItem[], request = REQUEST) =>
  measureRequest({
    instructions: request.instructions ?? "",
    tools: request.tools,
    input: items as unknown as MeasurableItem[],
  }).totalTokens;

const budgetOf = (budget: number | undefined) =>
  createContextBudgetFilter({ getBudget: () => budget });

const outputText = (item: AgentInputItem | undefined) =>
  (item as { output: { text: string } }).output.text;

function pairsIntact(items: AgentInputItem[]) {
  const calls = new Set(
    items
      .filter((i) => i.type === "function_call")
      .map((i) => (i as { callId: string }).callId),
  );
  const results = items
    .filter((i) => i.type === "function_call_result")
    .map((i) => (i as { callId: string }).callId);
  return results.every((id) => calls.has(id)) && results.length === calls.size;
}

describe("createContextBudgetFilter", () => {
  it("sends the request unchanged with no budget, or when it fits", async () => {
    const items = [...turn("first", 4_000), user("second")];

    expect(await budgetOf(undefined)(items, REQUEST)).toBe(items);
    expect(await budgetOf(sizeOf(items))(items, REQUEST)).toBe(items);
  });

  it("first turns earlier tool results into stubs, leaving the current turn alone", async () => {
    const items = [...turn("first", 8_000), user("second"), ...toolTurn(2_000)];
    const budget = sizeOf(items) - 1_000;

    const out = await budgetOf(budget)(items, REQUEST);

    expect(outputText(out[2])).toMatch(/^\{"stubbed":true,"tool":"read_page"/);
    expect(outputText(out.at(-1))).toBe("r".repeat(2_000));
    expect(out).toHaveLength(items.length);
    expect(sizeOf(out)).toBeLessThanOrEqual(budget);
  });

  it("then shortens long earlier messages", async () => {
    const long = "q".repeat(6_000);
    const items = [...turn(long, 100), user("second")];
    const budget = sizeOf(items) - 1_000;

    const out = await budgetOf(budget)(items, REQUEST);

    const first = (out[0] as { content: string }).content;
    expect(first.startsWith("q".repeat(SHORTENED_MESSAGE_CHARS))).toBe(true);
    expect(first).toContain("5600 more characters left out");
    expect((out.at(-1) as { content: string }).content).toBe("second");
    expect(sizeOf(out)).toBeLessThanOrEqual(budget);
  });

  it("then leaves out the oldest turns whole, and says so in the first message sent", async () => {
    const items = [
      ...turn("one", 200),
      ...turn("two", 200),
      ...turn("three", 200),
      user("now"),
    ];
    const withoutFirst = items.slice(4);
    const budget = sizeOf(withoutFirst) + 30;

    const out = await budgetOf(budget)(items, REQUEST);

    expect(JSON.stringify(out)).not.toContain('"one"');
    expect((out[0] as { content: string }).content).toBe(
      "[1 earlier turn of this chat was left out of this request to fit the request budget.]\n\ntwo",
    );
    expect(pairsIntact(out)).toBe(true);
    expect(sizeOf(out)).toBeLessThanOrEqual(budget);
    expect((items[4] as { content: string }).content).toBe("two");
  });

  it("then stubs the current turn's results except the newest", async () => {
    const items = [
      ...turn("earlier", 100),
      user("investigate"),
      ...toolTurn(6_000),
      ...toolTurn(6_000),
      ...toolTurn(1_000),
    ];
    const budget = sizeOf([user("x")]) + 900;

    const out = await budgetOf(budget)(items, REQUEST);

    expect((out[0] as { content: string }).content).toMatch(
      /^\[1 earlier turn of this chat was left out.*\]\n\ninvestigate$/s,
    );
    const results = out.filter((i) => i.type === "function_call_result");
    expect(results.map((r) => outputText(r).startsWith('{"stubbed"'))).toEqual([
      true,
      true,
      false,
    ]);
    expect(pairsIntact(out)).toBe(true);
    expect(sizeOf(out)).toBeLessThanOrEqual(budget);
  });

  it("stops with a named error when even the current message cannot fit", async () => {
    const request = { ...REQUEST, tools: [{ name: "a", description: "d" }] };
    const items = [...turn("earlier", 100), user("q".repeat(20_000))];

    const error = await budgetOf(2_000)(items, request).catch((e) => e);

    expect(error).toBeInstanceOf(AgentError);
    expect(error.code).toBe(ErrorCode.REQUEST_OVER_BUDGET);
    expect(error.message).toMatch(
      /needs about [\d,]+ tokens, more than the request budget of 2,000 .*1 tool schemas offered for it are about [\d,]+/,
    );
  });

  it("reads the budget on every request", async () => {
    let budget: number | undefined;
    const filter = createContextBudgetFilter({ getBudget: () => budget });
    const items = [...turn("first", 8_000), user("second")];

    expect(await filter(items, REQUEST)).toBe(items);
    budget = sizeOf(items) - 1_000;
    expect(await filter(items, REQUEST)).not.toBe(items);
  });
});

describe("a screenshot under a request budget (5)", () => {
  it("counts the image as an image, not its data as text, so the turn is sent", async () => {
    const screenshot: AgentInputItem = {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "here is the page" },
        {
          type: "input_image",
          image: `data:image/png;base64,${"A".repeat(200_000)}`,
          detail: "auto",
        },
      ],
    } as AgentInputItem;

    const sent = await budgetOf(8_000)([screenshot], REQUEST);

    expect(sent).toEqual([screenshot]);
    expect(sizeOf([screenshot])).toBeLessThan(8_000);
  });
});
