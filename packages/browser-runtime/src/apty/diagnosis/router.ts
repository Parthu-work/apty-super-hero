/**
 * Maps an SE's message to a check pack with plain patterns, the same way
 * `tool-relevance.ts` picks tool groups: a message that names a content kind
 * and says it is not visible is a content check; one that says the widget
 * itself is missing, or works in one environment or on some pages only, is a
 * widget check; one that quotes a message the KB cards name, or asks about
 * CSP, CORS, Apty's 404s or the errors in the logs, is a logs check; one
 * that names an item and says Apty cannot find its element, or that it sits
 * on the wrong one, is a selector check; one that says nothing can be
 * selected on the page is a page check; a how-to question, a request to
 * investigate that only mentions the console or the network, or anything
 * else is left to the model.
 */
import { LANGUAGE_CODES } from "./languages.js";
import type { ContentKind } from "./types.js";

export type Route =
  | {
      packId: "content-not-visible";
      kind: ContentKind;
      /** The item's name or sourceId, when the message gives one. */
      query?: string;
      /** The language the message names, as a code ("fr"). */
      language?: string;
    }
  | { packId: "widget-not-visible" }
  | {
      packId: "element-not-found";
      kind: ContentKind;
      query?: string;
      /** The workflow step the message names, 1-based. */
      step?: number;
    }
  | { packId: "page-readiness" }
  | {
      packId: "logs-and-errors";
      /** The message suspects Apty of the application's 404s (JA 1496645781). */
      about404?: boolean;
    };

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
const NOT_A_NAME = /^(?:my|our|the|a|an|this|that|new|published|apty|its)$/i;
const POSSESSIVE = /['’]s?$/;
const TRAILING_STEP = /\s+(?:at\s+)?step\s+\d{1,3}$/i;

/** Words of a clause, not a name: "the selector is green in Studio but the launcher". */
const CLAUSE = /\b(?:is|are|was|were|but|when|if|because)\b/i;

function itemName(message: string): string | undefined {
  for (const pattern of [QUOTED, CALLED, BEFORE_KIND, AFTER_KIND]) {
    const name = pattern.exec(message)?.[1]?.trim().replace(TRAILING_STEP, "");
    if (pattern === BEFORE_KIND && name && CLAUSE.test(name)) continue;
    if (name && !NOT_A_NAME.test(name) && !POSSESSIVE.test(name)) return name;
  }
  return undefined;
}

const WIDGET = /\bwidget\b/;
const ONE_ENVIRONMENT_ONLY =
  /\bworks? (?:in|on) (?:the )?[\w-]{2,20} but not (?:in|on) /;
const SOME_PAGES_ONLY =
  /\b(?:only (?:works|shows|appears|loads) on (?:one|some|certain|a few) pages?|(?:works|shows|appears) on (?:one|some|the main) pages? but not)\b/;

const LANGUAGE_NAMES = Object.keys(LANGUAGE_CODES).join("|");
const LANGUAGE = new RegExp(
  `\\b(?:in|for) (?:the )?(${LANGUAGE_NAMES})\\b|\\b(${LANGUAGE_NAMES})[- ](?:users?|speakers?|speaking|translation|version|language)\\b`,
);

function languageOf(lower: string): string | undefined {
  const match = LANGUAGE.exec(lower);
  const name = match?.[1] ?? match?.[2];
  return name ? LANGUAGE_CODES[name] : undefined;
}

const LOG_EVIDENCE =
  /\b(?:no active (?:application|environment) found|error registering ioc|error fetching data|error parsing response|no matching version found|failed to load widget snippet|csp|content security policy|cors|nonce)\b/;
const APTY_404 = /\b404s?\b[^.?!]*\bapty\b|\bapty\b[^.?!]*\b404s?\b/;
const INVESTIGATE = /\binvestigat(?:e|ion)\b/;
const LOGS_GENERIC =
  /\b(?:console|logs?|service worker)\b[^.?!]{0,30}\b(?:errors?|warnings?)\b|\b(?:errors?|warnings?)\b[^.?!]{0,20}\b(?:in|from) the (?:console|logs?|service worker)\b|\b(?:check|read|show) (?:me )?(?:the )?(?:apty )?(?:client )?(?:logs?|console)\b|\b(?:failed|failing) (?:requests?|calls?)\b|\bnetwork errors?\b/;

function asksForLogs(lower: string): Route | undefined {
  return LOGS_GENERIC.test(lower) && !INVESTIGATE.test(lower)
    ? { packId: "logs-and-errors" }
    : undefined;
}

const ELEMENT_PROBLEM = new RegExp(
  [
    "\\b(?:cannot|can't|can not|could not|couldn't|does not|doesn't|did not|didn't|unable to|fails? to|failed to|not able to)\\s+(?:find|identify|locate|track|detect)\\b[^.?!]{0,30}\\b(?:element|target|field|button)s?\\b",
    "\\b(?:element|target)s? (?:is |was )?(?:not|never) (?:found|identified|detected|tracked)\\b",
    "\\bselectors?\\b[^.?!]{0,30}\\b(?:not working|doesn't work|does not work|stopped working|fails?|failing|failed|broken|invalid|changed)\\b",
    "\\b(?:green|valid(?:ates)?) in studio\\b",
    "\\b(?:on|to|at) (?:the |a )?wrong element\\b",
    "\\bstep\\b[^.?!]{0,30}\\b(?:fails?|failing|failed|errors?|breaks?|broke|stuck)\\b",
    "\\bmissing after (?:a |the )?(?:page )?(?:reload|refresh)\\b",
  ].join("|"),
);
const STEP_NUMBER = /\bstep\s+(\d{1,3})\b/;
const PAGE_SELECTION =
  /\b(?:cannot|can't|can not|unable to|not able to|could not|couldn't)\s+(?:select|pick)\s+(?:any(?:thing)?|(?:the |any )?elements?)\b|\belement picker\b[^.?!]{0,40}\b(?:doesn't|does not|can't|cannot|won't|not|fails?)\b|\bonly (?:the )?header and footer\b|\bis (?:this|the) page (?:apty[- ])?(?:ready|supported)\b/;

function elementRoute(message: string, kind: ContentKind): Route {
  const query = itemName(message);
  const step = Number(STEP_NUMBER.exec(message.toLowerCase())?.[1] ?? 0);
  return {
    packId: "element-not-found",
    kind,
    ...(query ? { query } : {}),
    ...(step > 0 ? { step } : {}),
  };
}

/** The pack, kind and item a message asks about, or undefined to leave it to the model. */
export function routeSymptom(message: string): Route | undefined {
  const lower = message.toLowerCase();
  if (HOW_TO.test(lower)) return undefined;
  if (APTY_404.test(lower))
    return { packId: "logs-and-errors", about404: true };
  if (LOG_EVIDENCE.test(lower)) return { packId: "logs-and-errors" };
  const kind = KIND_WORDS.find(([, pattern]) => pattern.test(lower))?.[0];
  if (kind && ELEMENT_PROBLEM.test(lower)) return elementRoute(message, kind);
  if (!kind) {
    if (PAGE_SELECTION.test(lower)) return { packId: "page-readiness" };
    const widgetMissing = WIDGET.test(lower) && NOT_VISIBLE.test(lower);
    if (
      widgetMissing ||
      ONE_ENVIRONMENT_ONLY.test(lower) ||
      SOME_PAGES_ONLY.test(lower)
    ) {
      return { packId: "widget-not-visible" };
    }
    return asksForLogs(lower);
  }
  if (!NOT_VISIBLE.test(lower)) {
    return asksForLogs(lower);
  }
  const query = itemName(message);
  const language = languageOf(lower);
  return {
    packId: "content-not-visible",
    kind,
    ...(query ? { query } : {}),
    ...(language ? { language } : {}),
  };
}
