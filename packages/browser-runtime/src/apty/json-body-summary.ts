/**
 * The shape of a large JSON body, for the model, with no values beyond the
 * bounded preview: root type, length, keys and the types under them. The
 * model reads this first and pages the rest with `get_evidence_json`.
 */

/** Keys listed per object; the count of all of them is reported alongside. */
export const MAX_SUMMARY_KEYS = 30;
/** Array items in the preview, at most. */
export const MAX_PREVIEW_ITEMS = 5;
/** The summary's own size limit, in characters of JSON. */
export const MAX_SUMMARY_CHARS = 1_500;

export interface JsonBodySummary {
  kind: "array" | "object";
  /** Array length. */
  itemCount?: number;
  /** Root object: its keys (at most 30). */
  topLevelKeys?: string[];
  /** Root object: the type of each listed key. */
  keyTypes?: Record<string, string>;
  /** Root object: how many keys it has in all. */
  keyCount?: number;
  /** Array of objects: every key seen across all items (at most 30), with the types seen under it. */
  itemKeys?: Record<string, string>;
  /** Array of objects: how many distinct keys the items have in all. */
  itemKeyCount?: number;
  /** How many array items, or root keys, `bodyPreview` holds. */
  inPreview: number;
  /** Whether `bodyPreview` leaves anything out. */
  previewIsPartial: boolean;
}

export interface SummarizedJsonBody {
  summary: JsonBodySummary;
  /** JSON text of what the model may see, at most `maxPreviewChars` long. */
  preview: string;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joinTypes(types: Set<string>): string {
  return [...types].sort().join("|");
}

/** The longest prefix of `parts` whose JSON fits `maxChars`, at least one part when that one fits. */
function fitPrefix<T>(
  parts: readonly T[],
  render: (taken: readonly T[]) => string,
  maxChars: number,
): { taken: number; text: string } {
  let taken = Math.min(parts.length, MAX_PREVIEW_ITEMS);
  while (taken > 0) {
    const text = render(parts.slice(0, taken));
    if (text.length <= maxChars) return { taken, text };
    taken -= 1;
  }
  return { taken: 0, text: render([]) };
}

/** Drop listed keys from the end until the summary fits its size limit. */
function shrinkToLimit(summary: JsonBodySummary): JsonBodySummary {
  const fits = (s: JsonBodySummary) =>
    JSON.stringify(s).length <= MAX_SUMMARY_CHARS;
  let current = summary;
  while (!fits(current)) {
    if (current.itemKeys && Object.keys(current.itemKeys).length > 0) {
      const entries = Object.entries(current.itemKeys).slice(0, -1);
      current = { ...current, itemKeys: Object.fromEntries(entries) };
    } else if (current.topLevelKeys && current.topLevelKeys.length > 0) {
      const keys = current.topLevelKeys.slice(0, -1);
      current = {
        ...current,
        topLevelKeys: keys,
        keyTypes: Object.fromEntries(
          keys.map((k) => [k, current.keyTypes?.[k] ?? "unknown"]),
        ),
      };
    } else {
      return current;
    }
  }
  return current;
}

/**
 * Summarize already-redacted JSON text, or return undefined when it is not a
 * JSON array or object. `maxPreviewChars` bounds the preview.
 */
export function summarizeJsonBody(
  text: string,
  maxPreviewChars: number,
): SummarizedJsonBody | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (Array.isArray(parsed)) {
    const keyTypes = new Map<string, Set<string>>();
    for (const item of parsed) {
      if (!isPlainObject(item)) continue;
      for (const [key, value] of Object.entries(item)) {
        let types = keyTypes.get(key);
        if (!types) {
          types = new Set();
          keyTypes.set(key, types);
        }
        types.add(typeOf(value));
      }
    }
    const { taken, text: preview } = fitPrefix(
      parsed,
      (items) => JSON.stringify(items),
      maxPreviewChars,
    );
    const summary: JsonBodySummary = {
      kind: "array",
      itemCount: parsed.length,
      ...(keyTypes.size > 0
        ? {
            itemKeys: Object.fromEntries(
              [...keyTypes]
                .slice(0, MAX_SUMMARY_KEYS)
                .map(([key, types]) => [key, joinTypes(types)]),
            ),
            itemKeyCount: keyTypes.size,
          }
        : {}),
      inPreview: taken,
      previewIsPartial: taken < parsed.length,
    };
    return { summary: shrinkToLimit(summary), preview };
  }

  if (isPlainObject(parsed)) {
    const entries = Object.entries(parsed);
    const listed = entries.slice(0, MAX_SUMMARY_KEYS);
    const whole = JSON.stringify(parsed);
    const { taken, text: preview } =
      whole.length <= maxPreviewChars
        ? { taken: entries.length, text: whole }
        : fitPrefix(
            entries,
            (kept) => JSON.stringify(Object.fromEntries(kept)),
            maxPreviewChars,
          );
    const summary: JsonBodySummary = {
      kind: "object",
      topLevelKeys: listed.map(([key]) => key),
      keyTypes: Object.fromEntries(
        listed.map(([key, value]) => [key, typeOf(value)]),
      ),
      keyCount: entries.length,
      inPreview: taken,
      previewIsPartial: taken < entries.length,
    };
    return { summary: shrinkToLimit(summary), preview };
  }

  return undefined;
}
