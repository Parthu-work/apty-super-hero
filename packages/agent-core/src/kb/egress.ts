/**
 * The KB source tag (KB-RAG K22, hard rule 3): KB content is known by the tag
 * it gets where it is made (`kbToolResult`), never by matching its text.
 * The outbound filter, the summary request and the MCP bridge act on the tag.
 */
import type { AgentInputItem } from "@openai/agents";
import type { KbLayer } from "./pack.js";

export const KB_SOURCE = "kb";

/** One card a tagged result carries, by page id and (for a chunk) layer. */
export interface KbCardRef {
  pageId: string;
  layer?: KbLayer;
}

/** What every KB result carries next to its own fields. */
export interface KbSourceTag {
  source: typeof KB_SOURCE;
  /** The cards whose text the result holds; empty when it holds none. */
  cards: KbCardRef[];
}

/** The tag for a result holding `cards`. */
export function kbSourceTag(cards: KbCardRef[]): KbSourceTag {
  return { source: KB_SOURCE, cards };
}

/** The tag of a value (a result object, or its JSON text), or undefined when it is not KB content. */
export function kbTagOf(value: unknown): KbSourceTag | undefined {
  let parsed = value;
  if (typeof value === "string") {
    const trimmed = value.trimStart();
    if (!trimmed.startsWith("{")) return undefined;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as { source?: unknown; cards?: unknown };
  if (record.source !== KB_SOURCE || !Array.isArray(record.cards)) {
    return undefined;
  }
  const cards = record.cards.flatMap((card): KbCardRef[] => {
    const { pageId, layer } = (card ?? {}) as Record<string, unknown>;
    if (typeof pageId !== "string") return [];
    return [
      {
        pageId,
        ...(layer === 1 || layer === 2 || layer === 3 || layer === 4
          ? { layer }
          : {}),
      },
    ];
  });
  return kbSourceTag(cards);
}

/** "101, 202": each card once, in order. */
export function kbCardIds(cards: readonly KbCardRef[]): string {
  return [...new Set(cards.map((card) => card.pageId))].join(", ");
}

/** What the model gets instead of KB card text it may not have. */
export function kbWithheldText(cards: readonly KbCardRef[]): string {
  return `KB card text withheld by organization policy. Cards shown to the user: ${kbCardIds(cards)}.`;
}

/** What the MCP bridge gets instead of a KB result (D-SEC5). */
export function kbWithheldForMcp(cards: readonly KbCardRef[]): string {
  return `KB result withheld by policy. Cards: ${kbCardIds(cards)}.`;
}

function textOf(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  const text = (output as { type?: unknown; text?: unknown } | null)?.text;
  return (output as { type?: unknown } | null)?.type === "text" &&
    typeof text === "string"
    ? text
    : undefined;
}

/** A function result's KB tag, when its output is a tagged KB result. */
function tagOfItem(item: AgentInputItem): KbSourceTag | undefined {
  if (item.type !== "function_call_result") return undefined;
  const text = textOf((item as { output?: unknown }).output);
  return text === undefined ? undefined : kbTagOf(text);
}

/** The KB cards whose text `items` carry (a tagged result with cards). */
export function kbCardsIn(items: readonly AgentInputItem[]): KbCardRef[] {
  return items.flatMap((item) => tagOfItem(item)?.cards ?? []);
}

/**
 * `items` with each tagged KB result that holds card text replaced by
 * `kbWithheldText`, in the same output shape. Nothing is dropped or
 * reordered, so a function call keeps its result.
 */
export function withholdKbText(items: AgentInputItem[]): AgentInputItem[] {
  return items.map((item) => {
    const tag = tagOfItem(item);
    if (!tag || tag.cards.length === 0) return item;
    const output = (item as { output?: unknown }).output;
    const text = kbWithheldText(tag.cards);
    return {
      ...item,
      output:
        typeof output === "string" ? text : { type: "text" as const, text },
    } as AgentInputItem;
  });
}
