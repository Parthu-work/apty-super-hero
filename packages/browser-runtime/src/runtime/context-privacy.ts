/**
 * Page and tab contexts the user attaches go into the user message, so they
 * get the same URL and page-title policy as tool results.
 */
import type { Context } from "@apty/agent-core";
import type { ValuePolicy } from "@apty/dom-snapshot";
import { applyResultPrivacy } from "./result-privacy.js";

const WITHHELD_TITLE = "[title withheld]";

function originOf(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const { origin } = new URL(url);
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}

/** Shorter titles ("Home", "Inbox") are common words: replacing them everywhere would garble the page text. */
const TITLE_REPLACED_EVERYWHERE_FROM = 12;

function withoutTitle(text: string, title: unknown): string {
  if (typeof title !== "string" || !title.trim()) return text;
  if (title.trim().length >= TITLE_REPLACED_EVERYWHERE_FROM) {
    return text.split(title).join(WITHHELD_TITLE);
  }
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === title.trim()) return WITHHELD_TITLE;
      if (trimmed === `Title: ${title.trim()}`)
        return `Title: ${WITHHELD_TITLE}`;
      return line;
    })
    .join("\n");
}

function privateContext(ctx: Context, policy: ValuePolicy): Context {
  if (typeof ctx.value !== "string") return ctx;
  const title = ctx.metadata?.title;
  let value = applyResultPrivacy(ctx.value, policy) as string;
  let label = applyResultPrivacy(ctx.label, policy) as string;
  if (policy === "withhold") {
    value = withoutTitle(value, title);
    if (typeof title === "string" && label.includes(title)) {
      label = originOf(ctx.metadata?.url) ?? WITHHELD_TITLE;
    }
  }
  return { ...ctx, label, value };
}

export function privateContexts(
  contexts: Context[],
  policy: ValuePolicy,
): Context[] {
  if (policy === "show") return contexts;
  return contexts.map((ctx) => privateContext(ctx, policy));
}
