/**
 * Maps an SE's message to a check pack with plain patterns, the same way
 * `tool-relevance.ts` picks tool groups: a message that names a content kind
 * and says it is not visible is a visibility check; a how-to question or
 * anything else is left to the model.
 */
import type { ContentKind } from "./types.js";

export interface Route {
  packId: "content-not-visible";
  kind: ContentKind;
  /** The item's name or sourceId, when the message gives one. */
  query?: string;
}

const KIND_WORDS: Array<[ContentKind, RegExp]> = [
  ["workflow", /\b(work)?flows?\b/],
  ["tooltip", /\btool-?tips?\b/],
  ["launcher", /\blaunchers?\b/],
  ["announcement", /\bannouncements?\b/],
  ["validation", /\bvalidations?\b/],
  ["checklist", /\b(checklists?|learning paths?)\b/],
  [
    "knowledgeContent",
    /\b(knowledge (content|centre|center)|help library|resource library)\b/,
  ],
];

const KIND_NOUN =
  "(?:work)?flows?|tool-?tips?|launchers?|announcements?|validations?|checklists?";

const NOT_VISIBLE = new RegExp(
  [
    "(?:\\bnot|n't|\\bnever|\\bno longer)\\b[^.?!]{0,40}\\b(?:visible|showing|show(?:n)?|appear(?:ing)?|displayed?|listed|in the widget|in the list)\\b",
    "\\b(?:can't|cannot|can not|unable to)\\s+(?:see|find)\\b",
    "\\b(?:missing|hidden|disappeared|gone)\\b",
  ].join("|"),
);

const HOW_TO =
  /^\s*(?:how (?:do|can|to|should)|what (?:is|are|does)|where (?:do|can|is)|explain|tell me how)\b/;

const QUOTED = /(?:^|[\s(])["“'‘]([^"”'’\n]{2,80})["”'’](?=$|[\s.,!?;:)])/;
const CALLED =
  /\b(?:called|named|titled)\s+(.{2,60}?)(?=\s+(?:is|isn't|was|does|doesn't|did|didn't|has|not|won't|in|on|for)\b|[.,!?]|$)/i;
const BEFORE_KIND = new RegExp(
  `\\b(?:the|our)\\s+(.{2,60}?)\\s+(?:${KIND_NOUN})\\b`,
  "i",
);
const AFTER_KIND = new RegExp(
  `\\b(?:${KIND_NOUN})\\s+(?!is\\b|isn't\\b|are\\b|was\\b|does\\b|doesn't\\b|not\\b|in\\b|on\\b|for\\b|that\\b|which\\b)(.{2,60}?)\\s+(?:is|isn't|was|does|doesn't|did|didn't|won't|has|are)\\b`,
  "i",
);
const NOT_A_NAME = /^(?:my|our|the|a|an|this|that|new|published|apty)$/i;
const POSSESSIVE = /['’]s?$/;

function itemName(message: string): string | undefined {
  for (const pattern of [QUOTED, CALLED, BEFORE_KIND, AFTER_KIND]) {
    const name = pattern.exec(message)?.[1]?.trim();
    if (name && !NOT_A_NAME.test(name) && !POSSESSIVE.test(name)) return name;
  }
  return undefined;
}

/** The pack, kind and item a message asks about, or undefined to leave it to the model. */
export function routeSymptom(message: string): Route | undefined {
  const lower = message.toLowerCase();
  if (HOW_TO.test(lower) || !NOT_VISIBLE.test(lower)) return undefined;
  const kind = KIND_WORDS.find(([, pattern]) => pattern.test(lower))?.[0];
  if (!kind) return undefined;
  const query = itemName(message);
  return { packId: "content-not-visible", kind, ...(query ? { query } : {}) };
}
