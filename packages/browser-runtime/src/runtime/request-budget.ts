/**
 * Keeps tool results from growing a request without bound.
 *
 * - Cap: one result larger than MAX_TOOL_RESULT_TOKENS is cut, with a note
 *   saying how much was cut. A result that carries an `evidenceId` and a
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

export const MAX_TOOL_RESULT_TOKENS = 2000;
export const FULL_RESULTS_KEPT = 4;
export const STUB_PREVIEW_CHARS = 200;

const MAX_RESULT_CHARS = MAX_TOOL_RESULT_TOKENS * CHARS_PER_TOKEN;
/** Evidence previews are bounded at about the cap; past twice that the "preview" is not one. */
const MAX_EVIDENCE_RESULT_CHARS = MAX_RESULT_CHARS * 2;

const TRUNCATION_NOTE_PATTERN =
  /\n\[truncated: first \d+ of \d+ characters sent\]$/;
const EVIDENCE_ID_PATTERN = /"evidenceId"\s*:\s*"([^"]+)"/;

function textOf(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  if (typeof output === "object" && output !== null) {
    const record = output as { type?: unknown; text?: unknown };
    if (record.type === "text" && typeof record.text === "string") {
      return record.text;
    }
  }
  return undefined;
}

function withText(output: unknown, text: string): unknown {
  return typeof output === "string" ? text : { ...(output as object), text };
}

function isUserTurnStart(item: AgentInputItem): boolean {
  const role = (item as { role?: string }).role;
  return (
    (item.type === "message" || item.type === undefined) &&
    role === "user" &&
    !isTransientScreenshotItem(item)
  );
}

function isStub(text: string): boolean {
  return text.startsWith('{"stubbed":true');
}

function capped(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  if (TRUNCATION_NOTE_PATTERN.test(text)) return text;
  if (
    EVIDENCE_ID_PATTERN.test(text) &&
    text.length <= MAX_EVIDENCE_RESULT_CHARS
  ) {
    return text;
  }
  return `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated: first ${MAX_RESULT_CHARS} of ${text.length} characters sent]`;
}

function stubOf(name: string | undefined, text: string): string {
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
          : capped(text);
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
