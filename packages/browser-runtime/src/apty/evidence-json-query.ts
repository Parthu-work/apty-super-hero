/**
 * Query a previously-recorded JSON evidence body by path, without handing
 * the whole thing to the model.
 *
 * `inspectResource` (extension-network-inspector.ts) stores the FULL
 * redacted response body in evidence, but only ever returns a small,
 * bounded sample to the model (see `summarizeJsonBody`). This module lets
 * the model ask follow-up questions ("show me the sales-team segment",
 * "how many segments have isActive:true") against the full stored body —
 * still bounded on the way out, never the whole 100kB+ payload at once.
 */
import { getEvidenceById } from "./evidence-store.js";

export interface EvidenceJsonQueryResult {
  found: boolean;
  error?: string;
  kind?: "array" | "object" | "scalar";
  /** Total element count, when `kind` is `"array"` — the slice returned in `value` may be smaller. */
  total?: number;
  offset?: number;
  limit?: number;
  value?: unknown;
}

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_OUTPUT_CHARS = 4000;

type PathResolution =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Resolve a dot/bracket path (`"items[3].name"` or `"items.3.name"`) against a parsed JSON value. Empty path resolves to the root. */
function resolvePath(root: unknown, path: string): PathResolution {
  if (!path) return { ok: true, value: root };

  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((s) => s.length > 0);

  let current: unknown = root;
  for (const seg of segments) {
    if (current === null || current === undefined) {
      return {
        ok: false,
        error: `path segment "${seg}" not found (reached ${current} before the path ended)`,
      };
    }
    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
        return {
          ok: false,
          error: `array index "${seg}" is out of bounds (array has ${current.length} elements)`,
        };
      }
      current = current[idx];
    } else if (typeof current === "object") {
      const obj = current as Record<string, unknown>;
      if (!(seg in obj)) {
        return { ok: false, error: `key "${seg}" was not found` };
      }
      current = obj[seg];
    } else {
      return {
        ok: false,
        error: `cannot look up "${seg}" inside a non-object value`,
      };
    }
  }
  return { ok: true, value: current };
}

/** If `value`'s JSON serialization is over the output cap, replace it with a bounded preview rather than silently truncating mid-structure. */
function boundOutputSize(value: unknown): unknown {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return value;
  }
  if (text.length <= MAX_OUTPUT_CHARS) return value;
  return {
    truncated: true,
    preview: text.slice(0, MAX_OUTPUT_CHARS),
    fullLength: text.length,
  };
}

/**
 * Query a stored evidence record's JSON body. Never fabricates a result —
 * every failure mode (evidence not found, body not JSON, path not found)
 * returns `found: false` with a specific `error`, never an empty success.
 */
export function queryEvidenceJson(
  conversationId: string | undefined,
  evidenceId: string,
  path = "",
  limit = DEFAULT_LIMIT,
  offset = 0,
): EvidenceJsonQueryResult {
  const evidence = getEvidenceById(conversationId, evidenceId);
  if (!evidence) {
    return {
      found: false,
      error: `No evidence record found with id "${evidenceId}" in this conversation.`,
    };
  }

  const data = evidence.data as { body?: unknown } | undefined;
  const bodyText = data?.body;
  if (typeof bodyText !== "string") {
    return {
      found: false,
      error:
        "This evidence record has no JSON response body to query (it may be binary, or a different evidence type).",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return {
      found: false,
      error: "This evidence record's stored body is not valid JSON.",
    };
  }

  const resolved = resolvePath(parsed, path);
  if (!resolved.ok) {
    return { found: false, error: resolved.error };
  }

  const value = resolved.value;
  const boundedLimit = Math.max(0, Math.min(limit, MAX_LIMIT));
  const boundedOffset = Math.max(0, offset);

  if (Array.isArray(value)) {
    // `limit`/`offset` are already the bounding mechanism for an array
    // result — unlike the object branch below, don't ALSO collapse the
    // slice into an opaque truncated-text blob by char count, which would
    // defeat the whole point of paging through a large array a `limit` at
    // a time.
    const slice = value.slice(boundedOffset, boundedOffset + boundedLimit);
    return {
      found: true,
      kind: "array",
      total: value.length,
      offset: boundedOffset,
      limit: boundedLimit,
      value: slice,
    };
  }
  if (value !== null && typeof value === "object") {
    return { found: true, kind: "object", value: boundOutputSize(value) };
  }
  return { found: true, kind: "scalar", value };
}
