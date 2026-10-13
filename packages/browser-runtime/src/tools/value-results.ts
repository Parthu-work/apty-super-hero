/**
 * How the page-reading tools word their results under a value policy
 * (Strict withholds typed values, Standard masks them, Off shows them).
 */
import {
  applyUrlPolicy,
  MASKED_VALUE,
  type ValuePolicy,
} from "@apty/dom-snapshot";
import { CHARS_PER_TOKEN } from "../runtime/request-anatomy";

export const SNAPSHOT_MAX_TOKENS = 4000;

export type EditorValueResult =
  | { success: true; value: string; length: number }
  | { success: true; value: string; masked: true }
  | { success: false; withheld: true; message: string };

export function describeEditorValue(
  value: string,
  policy: ValuePolicy,
): EditorValueResult {
  if (policy === "show") {
    return { success: true, value, length: value.length };
  }
  if (policy === "mask") {
    return { success: true, value: value ? MASKED_VALUE : "", masked: true };
  }
  return {
    success: false,
    withheld: true,
    message:
      "The value is withheld by Settings → Data handling → Redaction (Strict). Tell the user they can change that setting if reading this value is needed.",
  };
}

export interface PageMetadata {
  title?: string;
  url?: string;
  description?: string;
  keywords?: string;
  author?: string;
  ogImage?: string;
  favicon?: string;
}

export function describePageMetadata<T extends PageMetadata>(
  meta: T | null,
  policy: ValuePolicy,
): T | null {
  if (!meta || policy === "show") return meta;
  return {
    ...meta,
    url: applyUrlPolicy(meta.url, policy),
    ogImage: applyUrlPolicy(meta.ogImage, policy),
    favicon: applyUrlPolicy(meta.favicon, policy),
  };
}

export function capSnapshotText(text: string): string {
  const limit = SNAPSHOT_MAX_TOKENS * CHARS_PER_TOKEN;
  if (text.length <= limit) return text;
  const cut = text.lastIndexOf("\n", limit);
  const kept = text.slice(0, cut > 0 ? cut : limit);
  const total = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  return `${kept}\n[snapshot truncated: showing the first ${kept.split("\n").length} of ${total} lines; use search_elements to find the rest]`;
}
