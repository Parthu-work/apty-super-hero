/**
 * Applies the URL policy (and, in Strict, the page-title rule) to a tool
 * result before it leaves the runtime, for the model and for MCP clients
 * alike. URLs carry record numbers and dates of birth in their queries, and
 * tab titles often name the patient.
 */
import { applyUrlPolicy, type ValuePolicy } from "@apty/dom-snapshot";

const URL_KEYS = new Set([
  "url",
  "tabUrl",
  "pageUrl",
  "finalUrl",
  "documentUrl",
  "frameUrl",
  "requestUrl",
  "href",
  "src",
  "favicon",
  "ogImage",
]);

const PAGE_TITLE_KEYS = new Set(["title", "tabTitle", "pageTitle"]);

const WEB_URL = /^https?:\/\//i;
const WEB_URL_IN_TEXT = /https?:\/\/[^\s"'<>()[\]{}`\\]+/gi;

function rewriteText(text: string, policy: ValuePolicy): string {
  if (!text.includes("://")) return text;
  return text.replace(
    WEB_URL_IN_TEXT,
    (url) => applyUrlPolicy(url, policy) ?? url,
  );
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function isPageDescriptor(record: Record<string, unknown>): boolean {
  const hasTitle = [...PAGE_TITLE_KEYS].some(
    (k) => typeof record[k] === "string",
  );
  const hasUrl = [...URL_KEYS].some(
    (k) => typeof record[k] === "string" && WEB_URL.test(record[k] as string),
  );
  return hasTitle && hasUrl;
}

function rewriteRecord(
  record: Record<string, unknown>,
  policy: ValuePolicy,
): Record<string, unknown> {
  const strictPage = policy === "withhold" && isPageDescriptor(record);
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (strictPage && PAGE_TITLE_KEYS.has(key)) {
      changed = true;
      continue;
    }
    let next: unknown;
    if (typeof value === "string" && URL_KEYS.has(key) && WEB_URL.test(value)) {
      next = strictPage ? originOf(value) : applyUrlPolicy(value, policy);
    } else {
      next = rewrite(value, policy);
    }
    if (next !== value) changed = true;
    out[key] = next;
  }
  return changed ? out : record;
}

function rewrite(value: unknown, policy: ValuePolicy): unknown {
  if (typeof value === "string") return rewriteText(value, policy);
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = rewrite(item, policy);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : value;
  }
  if (typeof value === "object" && value !== null) {
    return rewriteRecord(value as Record<string, unknown>, policy);
  }
  return value;
}

export function applyResultPrivacy(
  result: unknown,
  policy: ValuePolicy,
): unknown {
  if (policy === "show") return result;
  if (typeof result === "string") {
    const trimmed = result.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(result);
        const next = rewrite(parsed, policy);
        return next === parsed ? result : JSON.stringify(next);
      } catch {
        // Not JSON: treat as text.
      }
    }
  }
  return rewrite(result, policy);
}
