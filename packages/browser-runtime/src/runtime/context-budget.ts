/**
 * Keeps a request under the request budget set in Settings, with no model
 * call: older history gives way in fixed steps until the request fits.
 *
 * 1. Tool results from earlier turns become stubs (tool, size, evidence id,
 *    first characters), as `request-budget.ts` already does past the newest 4.
 * 2. Long earlier messages are shortened.
 * 3. The oldest turns are left out whole, so a function call never loses its
 *    result, and the first message sent says how many were left out.
 * 4. The current turn's tool results, except the newest, become stubs.
 *
 * A request that still does not fit (the system prompt, the tool schemas and
 * the current message alone are over the budget) stops with
 * `REQUEST_OVER_BUDGET` instead of reaching the provider. Only what is sent
 * changes; the session keeps everything. Sizes are characters / 4, the same
 * estimate the request reports use.
 */
import {
  AgentError,
  type AgentInputItem,
  ErrorCode,
  type OutboundFilter,
  type OutboundRequestContext,
} from "@apty/agent-core";
import {
  type MeasurableItem,
  type MeasurableTool,
  measureRequest,
} from "./request-anatomy.js";
import {
  isStub,
  isUserTurnStart,
  stubOf,
  textOf,
  withText,
} from "./request-budget.js";

/** @internal */
export const SHORTENED_MESSAGE_CHARS = 400;

export interface ContextBudgetOptions {
  /** Read on every request, so a budget changed in Settings applies to the next one. */
  getBudget: () => number | undefined | Promise<number | undefined>;
}

function sizeOf(
  items: readonly AgentInputItem[],
  request: OutboundRequestContext,
): number {
  return measureRequest({
    instructions: request.instructions ?? "",
    tools: request.tools as readonly MeasurableTool[],
    input: items as unknown as readonly MeasurableItem[],
  }).totalTokens;
}

function stubResult(item: AgentInputItem): AgentInputItem {
  if (item.type !== "function_call_result") return item;
  const { output, name } = item as unknown as {
    output: unknown;
    name?: string;
  };
  const text = textOf(output);
  if (text === undefined || isStub(text)) return item;
  const stub = stubOf(name, text);
  return stub.length < text.length
    ? ({ ...item, output: withText(output, stub) } as AgentInputItem)
    : item;
}

function shortened(text: string): string {
  if (text.length <= SHORTENED_MESSAGE_CHARS) return text;
  return `${text.slice(0, SHORTENED_MESSAGE_CHARS)}…[${text.length - SHORTENED_MESSAGE_CHARS} more characters left out to fit the request budget]`;
}

function mapMessageText(
  item: AgentInputItem,
  map: (text: string) => string,
): AgentInputItem {
  if (item.type !== "message" && item.type !== undefined) return item;
  const content = (item as { content?: unknown }).content;
  if (typeof content === "string") {
    const next = map(content);
    return next === content
      ? item
      : ({ ...item, content: next } as AgentInputItem);
  }
  if (!Array.isArray(content)) return item;
  let changed = false;
  const parts = content.map((part: { type?: string; text?: unknown }) => {
    if (typeof part?.text !== "string") return part;
    const next = map(part.text);
    if (next === part.text) return part;
    changed = true;
    return { ...part, text: next };
  });
  return changed ? ({ ...item, content: parts } as AgentInputItem) : item;
}

function withOmittedNote(item: AgentInputItem, turns: number): AgentInputItem {
  const note = `[${turns} earlier ${turns === 1 ? "turn" : "turns"} of this chat ${turns === 1 ? "was" : "were"} left out of this request to fit the request budget.]\n\n`;
  let added = false;
  return mapMessageText(item, (text) => {
    if (added) return text;
    added = true;
    return `${note}${text}`;
  });
}

/** Indices where each user turn starts; items before the first belong to no turn. */
function turnStarts(items: readonly AgentInputItem[]): number[] {
  const starts: number[] = [];
  items.forEach((item, i) => {
    if (isUserTurnStart(item)) starts.push(i);
  });
  return starts;
}

export function createContextBudgetFilter(
  options: ContextBudgetOptions,
): OutboundFilter {
  return async (items, request) => {
    const budget = await options.getBudget();
    if (!budget || sizeOf(items, request) <= budget) return items;

    const starts = turnStarts(items);
    const current = starts.at(-1) ?? 0;
    const fits = (list: AgentInputItem[]) => sizeOf(list, request) <= budget;

    let out = items.map((item, i) => (i < current ? stubResult(item) : item));
    if (fits(out)) return out;

    out = out.map((item, i) =>
      i < current ? mapMessageText(item, shortened) : item,
    );
    if (fits(out)) return out;

    const earlier = starts.slice(0, -1);
    for (let dropped = 1; dropped <= earlier.length; dropped++) {
      const keepFrom = starts[dropped] ?? current;
      const kept = out.slice(keepFrom);
      kept[0] = withOmittedNote(kept[0] as AgentInputItem, dropped);
      if (fits(kept)) return kept;
      if (dropped === earlier.length) out = kept;
    }

    const turnStart = earlier.length > 0 ? 0 : current;
    let newestResult = -1;
    for (let i = out.length - 1; i >= turnStart; i--) {
      if (out[i]?.type === "function_call_result") {
        newestResult = i;
        break;
      }
    }
    out = out.map((item, i) =>
      i >= turnStart && i !== newestResult ? stubResult(item) : item,
    );
    if (fits(out)) return out;

    const needed = sizeOf(out, request);
    const fixed = sizeOf([], request);
    throw new AgentError(
      `This message needs about ${needed.toLocaleString("en-US")} tokens, more than the request budget of ${budget.toLocaleString("en-US")} set in Settings → AI, even with the earlier turns left out. The system prompt and the ${request.tools.length} tool schemas offered for it are about ${fixed.toLocaleString("en-US")}. Raise the budget, or ask for less at once.`,
      ErrorCode.REQUEST_OVER_BUDGET,
      false,
      { needed, budget, fixed },
    );
  };
}
