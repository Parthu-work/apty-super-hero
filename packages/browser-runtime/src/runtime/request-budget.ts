/**
 * Keeps tool results from growing a request without bound.
 *
 * - Cap: one result larger than MAX_TOOL_RESULT_TOKENS is cut, with a note
 *   saying how much was cut. A JSON result stays valid JSON: its long strings
 *   and arrays are trimmed instead, so keys and scores survive. A result that carries an `evidenceId` and a
 *   preview that is already bounded is left as it is; the model can page the
 *   rest through the evidence tools.
 * - Prune: results from earlier turns beyond the newest FULL_RESULTS_KEPT
 *   become a small stub (tool, size, evidence id, first characters). Results
 *   from the current turn are never stubbed.
 *
 * Only outputs change: items are never dropped or reordered, so a function
 * call keeps its result. Token estimates are characters / 4.
 */
import {
  type AgentInputItem,
  isTransientScreenshotItem,
  type OutboundFilter,
} from "@apty/agent-core";
import { CHARS_PER_TOKEN } from "./request-anatomy.js";

/** @internal */
export const MAX_TOOL_RESULT_TOKENS = 2000;
/** @internal */
export const FULL_RESULTS_KEPT = 4;
/** @internal */
export const STUB_PREVIEW_CHARS = 200;

/**
 * Tools whose result is a report the model is told to relay exactly (DOM
 * Health), with a higher ceiling than the default cap.
 * @internal
 */
export const REPORT_RESULT_TOKENS: Readonly<Record<string, number>> = {
  run_dom_health_audit: 12_000,
  run_application_dom_health_audit: 12_000,
};

const MAX_RESULT_CHARS = MAX_TOOL_RESULT_TOKENS * CHARS_PER_TOKEN;
/** Evidence previews are bounded at about the cap; past twice that the "preview" is not one. */
const MAX_EVIDENCE_RESULT_CHARS = MAX_RESULT_CHARS * 2;

const TRUNCATION_NOTE_PATTERN =
  /\n\[truncated: first \d+ of \d+ characters sent\]$/;
const EVIDENCE_ID_PATTERN = /"evidenceId"\s*:\s*"([^"]+)"/;

export function textOf(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  if (typeof output === "object" && output !== null) {
    const record = output as { type?: unknown; text?: unknown };
    if (record.type === "text" && typeof record.text === "string") {
      return record.text;
    }
  }
  return undefined;
}

export function withText(output: unknown, text: string): unknown {
  return typeof output === "string" ? text : { ...(output as object), text };
}

export function isUserTurnStart(item: AgentInputItem): boolean {
  const role = (item as { role?: string }).role;
  return (
    (item.type === "message" || item.type === undefined) &&
    role === "user" &&
    !isTransientScreenshotItem(item)
  );
}

export function isStub(text: string): boolean {
  return text.startsWith('{"stubbed":true');
}

interface ShrinkRound {
  maxString: number;
  maxItems: number;
  /** Arrays and objects nested deeper than this become a one-line marker. */
  maxDepth: number;
  /** Keys kept per nested object; the top-level object keeps all of its keys. */
  maxKeys: number;
}

const SHRINK_ROUNDS: ShrinkRound[] = [
  { maxString: 2000, maxItems: 50, maxDepth: Infinity, maxKeys: Infinity },
  { maxString: 1000, maxItems: 25, maxDepth: Infinity, maxKeys: Infinity },
  { maxString: 500, maxItems: 12, maxDepth: Infinity, maxKeys: Infinity },
  { maxString: 250, maxItems: 6, maxDepth: Infinity, maxKeys: Infinity },
  { maxString: 120, maxItems: 3, maxDepth: Infinity, maxKeys: Infinity },
  { maxString: 60, maxItems: 1, maxDepth: Infinity, maxKeys: Infinity },
  { maxString: 60, maxItems: 1, maxDepth: 4, maxKeys: Infinity },
  { maxString: 60, maxItems: 1, maxDepth: 3, maxKeys: Infinity },
  { maxString: 60, maxItems: 1, maxDepth: 2, maxKeys: 20 },
  { maxString: 60, maxItems: 1, maxDepth: 1, maxKeys: 20 },
  { maxString: 60, maxItems: 1, maxDepth: 1, maxKeys: 5 },
];

function shrinkValue(value: unknown, round: ShrinkRound, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length > round.maxString
      ? `${value.slice(0, round.maxString)}…[${value.length - round.maxString} more characters not sent]`
      : value;
  }
  if (Array.isArray(value)) {
    if (depth > round.maxDepth) {
      return `[array with ${value.length} items not sent]`;
    }
    const kept = value
      .slice(0, round.maxItems)
      .map((v) => shrinkValue(v, round, depth + 1));
    return value.length > round.maxItems
      ? [...kept, `[${value.length - round.maxItems} more items not sent]`]
      : kept;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    if (depth > round.maxDepth) {
      return `[object with ${entries.length} keys not sent]`;
    }
    const limit = depth === 0 ? Infinity : round.maxKeys;
    const kept = entries
      .slice(0, limit)
      .map(([k, v]) => [k, shrinkValue(v, round, depth + 1)]);
    if (entries.length > limit) {
      kept.push(["…", `[${entries.length - limit} more keys not sent]`]);
    }
    return Object.fromEntries(kept);
  }
  return value;
}

/**
 * A JSON result made to fit by trimming long strings and arrays, then deep
 * objects, more each round, so it stays valid JSON with its top-level keys
 * and scalars in place. Undefined when even the tightest round does not fit.
 */
function shrunkJson(text: string, maxChars: number): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const isObject =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  for (const round of SHRINK_ROUNDS) {
    const shrunk = shrinkValue(parsed, round);
    const candidate = JSON.stringify(
      isObject
        ? {
            ...(shrunk as object),
            truncatedForModel: { originalChars: text.length },
          }
        : shrunk,
    );
    if (candidate.length <= maxChars) return candidate;
  }
  return undefined;
}

function capped(text: string, name: string | undefined): string {
  const maxChars =
    (name !== undefined && REPORT_RESULT_TOKENS[name] !== undefined
      ? REPORT_RESULT_TOKENS[name]
      : MAX_TOOL_RESULT_TOKENS) * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  if (TRUNCATION_NOTE_PATTERN.test(text)) return text;
  if (
    EVIDENCE_ID_PATTERN.test(text) &&
    text.length <= MAX_EVIDENCE_RESULT_CHARS
  ) {
    return text;
  }
  return (
    shrunkJson(text, maxChars) ??
    `${text.slice(0, maxChars)}\n[truncated: first ${maxChars} of ${text.length} characters sent]`
  );
}

export function stubOf(name: string | undefined, text: string): string {
  const evidenceId = EVIDENCE_ID_PATTERN.exec(text)?.[1];
  return JSON.stringify({
    stubbed: true,
    tool: name ?? "tool",
    size: text.length,
    ...(evidenceId ? { evidenceId } : {}),
    preview: text.slice(0, STUB_PREVIEW_CHARS),
  });
}

export function createRequestBudgetFilter(): OutboundFilter {
  return (items) => {
    let turnStart = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      if (isUserTurnStart(items[i] as AgentInputItem)) {
        turnStart = i;
        break;
      }
    }

    const out = [...items];
    let seen = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i] as AgentInputItem;
      if (item.type !== "function_call_result") continue;
      const { output, name } = item as unknown as {
        output: unknown;
        name?: string;
      };
      const text = textOf(output);
      if (text === undefined) continue;

      seen += 1;
      const inCurrentTurn = i > turnStart;
      const replacement =
        !inCurrentTurn && seen > FULL_RESULTS_KEPT && !isStub(text)
          ? stubOf(name, text)
          : capped(text, name);
      if (replacement !== text) {
        out[i] = {
          ...item,
          output: withText(output, replacement),
        } as AgentInputItem;
      }
    }
    return out;
  };
}
