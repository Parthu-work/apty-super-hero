/**
 * Console/runtime event classification
 *
 * `get_apty_page_logs` and `get_runtime_diagnostics` capture raw browser log
 * entries/exceptions. Without this, the model has to re-derive "is this a
 * CSP violation, a CORS failure, or an Apty-widget error" from free text on
 * every single investigation. This buckets each entry into one category so
 * that judgment is made once, consistently, here.
 *
 * This is text/metadata pattern-matching only — it never changes what is
 * captured, redacted, or recorded as evidence, only how an already-captured
 * entry is labeled. Classification runs on already-redacted text.
 */

export type LogCategory =
  | "csp-violation"
  | "cors-error"
  | "unhandled-rejection"
  | "js-exception"
  | "network-resource-error"
  | "deprecation-warning"
  | "apty-error"
  | "console-error"
  | "console-warning"
  | "info";

const CSP_PATTERN =
  /content security policy|refused to (load|execute|connect|frame)|violates the following content security policy directive/i;
const CORS_PATTERN =
  /\bcors\b|cross-origin request blocked|access-control-allow-origin|has been blocked by cors policy/i;
const UNHANDLED_REJECTION_PATTERN = /uncaught \(in promise\)/i;
const JS_EXCEPTION_PATTERN =
  /typeerror|referenceerror|syntaxerror|rangeerror|^uncaught\b/i;
const NETWORK_RESOURCE_PATTERN =
  /failed to load resource|net::err_|404 \(not found\)|500 \(internal server error\)|503 \(service unavailable\)/i;
const DEPRECATION_PATTERN = /deprecat/i;
const APTY_PATTERN = /\bapty\b|__apty_|apty[_-](widget|client|studio)/i;

/** Structured source hints the two callers can supply when they have one — a CDP `Log.entryAdded` `entry.source`, or the console bridge's own `source` field. Free-text pattern matching alone still drives most classification; these hints only help resolve genuinely ambiguous text. */
export type LogClassificationHint =
  | "console"
  | "window-error"
  | "unhandled-rejection"
  | "exception"
  | "javascript"
  | "security"
  | "violation"
  | "network"
  | "deprecation"
  | (string & {});

export interface ClassifiableLogEntry {
  text: string;
  level?: string;
  hint?: LogClassificationHint;
}

/** Classify a single log/exception entry. Order matters: more specific categories are checked before falling back to a generic level-based one. */
export function classifyLogEntry({
  text,
  level,
  hint,
}: ClassifiableLogEntry): LogCategory {
  if (CSP_PATTERN.test(text) || hint === "security" || hint === "violation") {
    return "csp-violation";
  }
  if (CORS_PATTERN.test(text)) {
    return "cors-error";
  }
  if (
    UNHANDLED_REJECTION_PATTERN.test(text) ||
    hint === "unhandled-rejection"
  ) {
    return "unhandled-rejection";
  }
  if (
    JS_EXCEPTION_PATTERN.test(text) ||
    hint === "window-error" ||
    hint === "exception" ||
    hint === "javascript"
  ) {
    return "js-exception";
  }
  if (NETWORK_RESOURCE_PATTERN.test(text) || hint === "network") {
    return "network-resource-error";
  }
  if (DEPRECATION_PATTERN.test(text) || hint === "deprecation") {
    return "deprecation-warning";
  }
  if (APTY_PATTERN.test(text)) {
    return "apty-error";
  }
  if (level === "error") {
    return "console-error";
  }
  if (level === "warn" || level === "warning") {
    return "console-warning";
  }
  return "info";
}

/** Tally how many entries fall into each category — a quick-glance summary alongside the full entry list. Only categories that actually occurred are included. */
export function summarizeLogCategories(
  categories: LogCategory[],
): Partial<Record<LogCategory, number>> {
  const counts: Partial<Record<LogCategory, number>> = {};
  for (const category of categories) {
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
}
