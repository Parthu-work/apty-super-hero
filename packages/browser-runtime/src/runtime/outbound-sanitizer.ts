/**
 * The outbound filter that masks what is about to be sent to the model.
 *
 * Tool results are redacted in the current redaction mode. User messages only
 * get structural secrets (tokens, keys, JWTs, emails) masked, and only in
 * Strict and Standard: prose is left alone, and Off means the person chose to
 * send what they typed. Items are never dropped or reordered, so a function
 * call keeps its result.
 */
import type { AgentInputItem, OutboundFilter } from "@apty/agent-core";
import type { RedactionMode } from "@apty/debug-contract";
import { redactStructuralSecrets, redactTextInMode } from "./redaction-mode.js";

const MAX_CACHED_RESULTS = 256;

export interface OutboundSanitizerOptions {
  /** Read on every call, so a mode changed in Settings applies to the next request. */
  getMode: () => RedactionMode;
}

interface CachedResult {
  mode: RedactionMode;
  source: unknown;
  redacted: unknown;
}

function redactOutput(output: unknown, mode: RedactionMode): unknown {
  if (typeof output === "string") return redactTextInMode(output, mode);
  if (Array.isArray(output)) {
    return output.map((part) => redactOutput(part, mode));
  }
  if (typeof output === "object" && output !== null) {
    const record = output as Record<string, unknown>;
    if (typeof record.text === "string" && record.type === "text") {
      return { ...record, text: redactTextInMode(record.text, mode) };
    }
    if (record.type === "image" || record.type === "input_image") {
      return output;
    }
    const json = JSON.stringify(output);
    const redacted = redactTextInMode(json, mode);
    return redacted === json ? output : redacted;
  }
  return output;
}

function redactUserContent(content: unknown): unknown {
  if (typeof content === "string") return redactStructuralSecrets(content);
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    const p = part as { type?: string; text?: unknown };
    return p?.type === "input_text" && typeof p.text === "string"
      ? { ...p, text: redactStructuralSecrets(p.text) }
      : part;
  });
}

function sameContent(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function createOutboundSanitizer(
  options: OutboundSanitizerOptions,
): OutboundFilter {
  const cache = new Map<string, CachedResult>();

  function remember(callId: string, entry: CachedResult): void {
    cache.delete(callId);
    cache.set(callId, entry);
    if (cache.size > MAX_CACHED_RESULTS) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }

  function sanitizeResult(
    item: AgentInputItem,
    mode: RedactionMode,
  ): AgentInputItem {
    const { callId, output } = item as unknown as {
      callId?: string;
      output: unknown;
    };
    const cached = callId ? cache.get(callId) : undefined;
    if (cached && cached.mode === mode && cached.source === output) {
      return sameContent(cached.redacted, output)
        ? item
        : ({ ...item, output: cached.redacted } as AgentInputItem);
    }
    const redacted = redactOutput(output, mode);
    if (callId) remember(callId, { mode, source: output, redacted });
    return sameContent(redacted, output)
      ? item
      : ({ ...item, output: redacted } as AgentInputItem);
  }

  return (items) => {
    const mode = options.getMode();
    return items.map((item) => {
      if (item.type === "function_call_result") {
        return sanitizeResult(item, mode);
      }
      const isUserMessage =
        (item.type === "message" || item.type === undefined) &&
        (item as { role?: string }).role === "user";
      if (isUserMessage && mode !== "off") {
        const content = (item as { content?: unknown }).content;
        const redacted = redactUserContent(content);
        return sameContent(redacted, content)
          ? item
          : ({ ...item, content: redacted } as AgentInputItem);
      }
      return item;
    });
  };
}
