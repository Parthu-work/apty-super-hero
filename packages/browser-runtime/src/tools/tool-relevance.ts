/**
 * Deterministic, keyword-based tool exposure for a single chat turn.
 *
 * `allBrowserTools` is ~59 tools across a large system prompt; sending
 * every tool's schema on every request wastes tokens on requests that
 * don't need most of them (e.g. "hi" doesn't need Apty diagnostics).
 *
 * The principle: ALL TOOLS EXIST + ONLY RELEVANT TOOLS ARE EXPOSED for the
 * current message. Every tool stays fully registered and callable
 * (`allBrowserTools`, `registerDefaultBrowserTools`) — this module only
 * narrows what's offered to the model's tool schema for one turn, via
 * `ChatOptions.tools` (see `browser-agent-config.ts`'s `useSelectRelevantTools`
 * and `@apty/ui`'s `ChatConfig.selectTools`).
 *
 * This is plain keyword matching, not a second model call: the categories
 * below have stable, recognizable vocabulary, so a deterministic rule set
 * is testable and fast where an LLM-based router would add latency and
 * non-determinism for a problem regex already solves (same reasoning as
 * `log-classification.ts` and the investigation planner's `PLAN_TEMPLATES`
 * — see `DECISIONS.md`).
 */

import type { FunctionTool } from "@apty/agent-core";
import { getInvestigation } from "../apty/investigation-session.js";
import {
  hasSymptomWord,
  isBareHowTo,
  isMostlyNonLatin,
} from "../kb/kb-intent.js";
import { type BrowserToolGroupName, browserToolGroups } from "./index.js";

const GROUP_KEYWORDS: Record<BrowserToolGroupName, string[]> = {
  tabs: [
    "tab",
    "tabs",
    "current tab",
    "which page am i on",
    "switch to",
    "new tab",
    "close tab",
    "open tab",
  ],
  ui: [
    "click",
    "type into",
    "fill in",
    "fill out",
    "hover",
    "upload",
    "form field",
    "input field",
    "press the button",
    "interact with",
  ],
  page: [
    "dom",
    "page structure",
    "html",
    "highlight",
    "scroll to",
    "page metadata",
    "what's on this page",
    "what is on this page",
    "structure of the page",
  ],
  screenshot: [
    "screenshot",
    "capture the page",
    "what does it look like",
    "visual",
    "take a picture",
    "image of the page",
  ],
  download: ["download"],
  intervention: [
    "intervention",
    "permission",
    "confirm this action",
    "approve this",
  ],
  skill: ["skill", "macro", "run script", "automation recipe"],
  devtools: [
    "devtools",
    "cdp",
    "console error",
    "console log",
    "console command",
    "run javascript",
    "run js",
    "execute javascript",
    "execute js",
    "runtime error",
    "javascript error",
    "js error",
    "network tab",
    "network request",
    "xhr",
    "fetch request",
    "http error",
  ],
  domHealth: [
    "dom health",
    "dom readiness",
    "readiness score",
    "selector quality",
    "selector stability",
    "check dom health",
    "apty dom readiness",
    "application dom health",
    "application audit",
    "audit the whole application",
    "audit across pages",
    "manual selector dependency",
  ],
  apty: [
    "apty",
    "widget",
    "player",
    "studio",
    "launcher",
    "tooltip",
    "announcement",
    "need help",
    "workflow",
    "validation",
    "flow",
    "segment",
    "content loading",
  ],
  investigation: [
    "investigate",
    "debug",
    "diagnose",
    "diagnosis",
    "why is",
    "why isn't",
    "why doesn't",
    "not working",
    "broken",
    "bug",
    "hypothesis",
    "evidence",
    "root cause",
    "reproduce",
  ],
  selector: [
    "selector",
    "css selector",
    "xpath",
    "find element",
    "locate element",
    "element selector",
  ],
  networkCapture: [
    "network",
    "network request",
    "network response",
    "api call",
    "http traffic",
    "resource loaded",
    "resources loaded",
  ],
  diagnosis: [
    "not visible",
    "isn't visible",
    "not showing",
    "isn't showing",
    "not appearing",
    "doesn't appear",
    "does not appear",
    "doesn't show",
    "does not show",
    "missing from the widget",
    "missing in the widget",
    "hidden from the widget",
    "not in the widget",
    "can't see",
    "cannot see",
    // The selector and page checks (element-not-found, page-readiness).
    "find the element",
    "find its element",
    "element not found",
    "wrong element",
    "selector stopped",
    "selector not working",
    "selector is not working",
    "selector isn't working",
    "selector broke",
    "selector is broken",
    "green in studio",
    "element picker",
    "select any element",
    "select anything",
    "apty-ready",
    "apty ready",
    "fails at step",
    // The Ask Dapty check: the Widget's AI assistant and its suggestions.
    "dapty",
    "ai assistant",
    "ai chat",
    "widget chat",
    "chatbot",
    "助手",
  ],
  // Product facts behind a finding (KB-RAG K4): the card's settings,
  // checks, data and support contacts.
  kb: [
    "turn off",
    "turn on",
    "turn it off",
    "turn it on",
    "switch off",
    "setting",
    "in studio",
    "in admin",
    "kb card",
    "knowledge base",
    "contact support",
    "send support",
  ],
  extensionNetwork: [
    "segments.json",
    "app.json",
    "flow.json",
    "flows.json",
    "apty client",
    "service worker",
    "extension network",
    "captured resource",
    "captured resources",
    "get segments",
    "get flow",
    "get app.json",
    ".json",
  ],
  aptyContent: [
    "tenant id",
    "tenant-",
    "environment id",
    "env id",
    "env-",
    "application id",
    "app id",
    "published file",
    "is it published",
    "content host",
    "content url",
    "content cdn",
  ],
};

// Cheap, deterministic context every investigative request benefits from,
// used only when the message isn't clearly casual chat and no category
// matched (an ambiguous "what's going on here?" style question).
const DEFAULT_FALLBACK_GROUPS: BrowserToolGroupName[] = ["tabs", "page"];

// Investigation-lifecycle tools (evidence, hypotheses, verification) are
// pulled in by these categories even when the wording doesn't literally
// say "investigate" — an Apty/network/extension question about *why*
// something happens is a debugging request either way.
// Apty product facts come from the KB cards (KB-RAG K4, K16): any Apty,
// network, DevTools, selector or symptom question gets search_kb, so the
// model does not answer it from general knowledge. A bare how-to does not
// (D-KB1: Ask Dapty answers those), nor a request to fetch a file.
const GROUPS_THAT_IMPLY_KB: BrowserToolGroupName[] = [
  "apty",
  "extensionNetwork",
  "devtools",
  "selector",
  "diagnosis",
];

const GROUPS_THAT_IMPLY_INVESTIGATION: BrowserToolGroupName[] = [
  "apty",
  "devtools",
  "networkCapture",
  "extensionNetwork",
];

// "get config.json" asks for a file, not an investigation: offering the
// investigation group's schemas with it cost thousands of tokens a turn
// and pushed small-limit providers over their per-minute budget.
const RETRIEVAL_REQUEST =
  /^(?:please\s+|can you\s+|could you\s+)?(?:get|show|read|fetch|open|list|view|display|print|give me)\b/;

const CASUAL_PATTERNS: RegExp[] = [
  /^(hi|hello|hey|yo)\b/,
  /^(thanks|thank you|thx)\b/,
  /^(ok|okay|got it|sounds good|sure)$/,
  /^good (morning|afternoon|evening|night)/,
  /^(bye|goodbye|see you)\b/,
  /^how are you/,
  /^who are you/,
  /^what can you do/,
  /^(yes|no|yep|nope)$/,
];

function isLikelyCasualMessage(lowerText: string): boolean {
  const trimmed = lowerText.trim();
  if (trimmed.length === 0) return true;
  if (CASUAL_PATTERNS.some((re) => re.test(trimmed))) return true;
  // K28, F4: a short message the KB reads as a symptom ("widget is missing") is not chat.
  if (hasSymptomWord(trimmed)) return false;
  // A script written without spaces, such as Chinese, is not counted in words.
  if (isMostlyNonLatin(trimmed)) return [...trimmed].length < 4;
  return trimmed.split(/\s+/).length <= 3;
}

function keywordGroups(text: string): Set<BrowserToolGroupName> {
  const matchedGroups = new Set<BrowserToolGroupName>();
  for (const [group, keywords] of Object.entries(GROUP_KEYWORDS) as Array<
    [BrowserToolGroupName, string[]]
  >) {
    if (keywords.some((kw) => text.includes(kw))) {
      matchedGroups.add(group);
    }
  }
  return matchedGroups;
}

const CONTENT_WORD =
  /\b(?:work)?flows?\b|\bsegments?\b|\brules?\b|\blaunchers?\b/;
const LOOKUP_WORD =
  /\b(?:present|exists?|contains?|belongs?|assigned)\b|\bin the\b/;
const CONTENT_FILE = /\b(?:flows?|workflows?|segments?|rules?)\.json\b/;

/**
 * A question about what the Apty Client's content holds (K27, F5): "is
 * workflow X present in segment Y", or one naming a content file in either
 * version's spelling. It gets the Client file-read tools.
 */
function isContentLookup(text: string): boolean {
  return (
    CONTENT_FILE.test(text) ||
    (CONTENT_WORD.test(text) && LOOKUP_WORD.test(text))
  );
}

function selectRelevantGroups(userMessage: string): Set<BrowserToolGroupName> {
  const text = userMessage.toLowerCase();
  const matchedGroups = keywordGroups(text);
  if (isContentLookup(text)) matchedGroups.add("extensionNetwork");

  if (
    !RETRIEVAL_REQUEST.test(text.trim()) &&
    GROUPS_THAT_IMPLY_INVESTIGATION.some((g) => matchedGroups.has(g))
  ) {
    matchedGroups.add("investigation");
  }

  if (
    !RETRIEVAL_REQUEST.test(text.trim()) &&
    !isBareHowTo(userMessage) &&
    !isLikelyCasualMessage(text) &&
    (GROUPS_THAT_IMPLY_KB.some((g) => matchedGroups.has(g)) ||
      hasSymptomWord(userMessage) ||
      isMostlyNonLatin(userMessage))
  ) {
    matchedGroups.add("kb");
  }

  if (matchedGroups.size === 0 && !isLikelyCasualMessage(text)) {
    for (const group of DEFAULT_FALLBACK_GROUPS) {
      matchedGroups.add(group);
    }
  }
  return matchedGroups;
}

const REGISTRY_ORDER = Object.keys(browserToolGroups) as BrowserToolGroupName[];

// In the registry's order, not the order the groups matched in, so the same
// groups always produce the same tool list: a provider's prompt cache keys
// on the exact prefix, and the tools come first in it.
function toolsOf(groups: ReadonlySet<BrowserToolGroupName>): FunctionTool[] {
  const seenNames = new Set<string>();
  const selected: FunctionTool[] = [];
  for (const group of REGISTRY_ORDER) {
    if (!groups.has(group)) continue;
    for (const tool of browserToolGroups[group]) {
      if (!seenNames.has(tool.name)) {
        seenNames.add(tool.name);
        selected.push(tool as unknown as FunctionTool);
      }
    }
  }
  return selected;
}

/**
 * What a turn is about, which decides how many tools it is offered (KB-RAG
 * K27, F1): a file's meaning or content gets the Client file-read tools and
 * search_kb, a symptom gets the investigation basics, and the whole
 * investigation set waits until the SE asks for an investigation or one has
 * started. Anthropic refuses a request with more than 20 strict tools.
 */
type ToolRoute = "file" | "symptom" | "investigation" | "other";

/**
 * The most tools each route offers; the conformance test holds every probe question to it.
 * @internal
 */
export const TOOL_ROUTE_BUDGETS: Readonly<Record<ToolRoute, number | null>> = {
  file: 11,
  symptom: 12,
  investigation: null,
  other: null,
};

/** A file question keeps only these of the Apty groups. */
const APTY_GROUPS: ReadonlySet<BrowserToolGroupName> = new Set([
  "apty",
  "investigation",
  "devtools",
  "networkCapture",
  "extensionNetwork",
  "aptyContent",
  "diagnosis",
  "selector",
  "kb",
]);

/** A symptom question gets only the basics of these large groups. */
const TRIMMED_FOR_SYMPTOM: ReadonlySet<BrowserToolGroupName> = new Set([
  "apty",
  "investigation",
  "extensionNetwork",
  "aptyContent",
]);

const FILE_ROUTE_GROUPS: ReadonlySet<BrowserToolGroupName> = new Set([
  "extensionNetwork",
  "aptyContent",
  "kb",
]);

/** Symptom basics, most relevant first; at most `TOOL_ROUTE_BUDGETS.symptom`. */
const SYMPTOM_TOOLS: readonly string[] = [
  "search_kb",
  "run_diagnosis",
  "get_apty_widget_diagnostics",
  "get_apty_client_diagnostics",
  "get_apty_page_logs",
  "inspect_extension_network",
  "analyze_element_selectors",
  "get_runtime_diagnostics",
  "get_network_diagnostics",
  "start_investigation",
  "get_next_investigation_action",
  "get_investigation_status",
];

const SYMPTOM_GROUPS: readonly BrowserToolGroupName[] = [
  "apty",
  "diagnosis",
  "selector",
  "devtools",
  "networkCapture",
];

function routeOf(
  groups: ReadonlySet<BrowserToolGroupName>,
  investigationAsked: boolean,
  asksWhy = false,
): ToolRoute {
  if (investigationAsked) return "investigation";
  const symptom = SYMPTOM_GROUPS.filter((g) => groups.has(g) && g !== "apty");
  if (groups.has("extensionNetwork") && symptom.length === 0 && !asksWhy) {
    return "file";
  }
  if (SYMPTOM_GROUPS.some((g) => groups.has(g)) || groups.has("kb")) {
    return "symptom";
  }
  return "other";
}

function toolsOfRoute(
  groups: ReadonlySet<BrowserToolGroupName>,
  route: ToolRoute,
): FunctionTool[] {
  if (route === "investigation" || route === "other") return toolsOf(groups);
  const allowed =
    route === "file"
      ? (group: BrowserToolGroupName) => FILE_ROUTE_GROUPS.has(group)
      : () => true;
  const symptomNames = new Set(SYMPTOM_TOOLS);
  const withRoute = new Set(groups);
  if (route === "symptom") withRoute.add("investigation");
  return toolsOf(withRoute).filter((tool) => {
    const group = groupOfTool.get(tool.name);
    if (!group) return true;
    if (route === "file") return !APTY_GROUPS.has(group) || allowed(group);
    return !TRIMMED_FOR_SYMPTOM.has(group) || symptomNames.has(tool.name);
  });
}

const groupOfTool = new Map<string, BrowserToolGroupName>(
  REGISTRY_ORDER.flatMap((group) =>
    browserToolGroups[group].map((tool) => [tool.name, group] as const),
  ),
);

/** Investigation wording that asks for one, not a symptom such as "not working". */
const INVESTIGATION_ASK = [
  "investigate",
  "debug",
  "diagnose",
  "diagnosis",
  "root cause",
  "reproduce",
  "hypothesis",
  "evidence",
];

const WHY = /\bwhy\b/i;

function asksForInvestigation(text: string): boolean {
  const lower = text.toLowerCase();
  return INVESTIGATION_ASK.some((kw) => lower.includes(kw));
}

/**
 * The route `selectRelevantTools` takes for one message, for the request-size report and tests.
 * @internal
 */
export function toolRouteOf(userMessage: string): ToolRoute {
  return routeOf(
    selectRelevantGroups(userMessage),
    asksForInvestigation(userMessage),
    WHY.test(userMessage),
  );
}

/**
 * Select which browser tools to expose to the model for one chat message.
 *
 * @param userMessage The current user message text (not the full history;
 *   `createStickyToolSelector` adds the chat's recent turns).
 * @returns The relevant tool objects (sourced from the same canonical
 *   `browserToolGroups`), or `[]` for messages that read as casual chat.
 */
export function selectRelevantTools(userMessage: string): FunctionTool[] {
  const groups = selectRelevantGroups(userMessage);
  return toolsOfRoute(
    groups,
    routeOf(groups, asksForInvestigation(userMessage), WHY.test(userMessage)),
  );
}

const REMEMBERED_TURNS = 3;

export interface StickyToolSelectorOptions {
  /** Chats remembered at once; the least recently used one is forgotten first. */
  maxSessions?: number;
  /** True once the chat has an investigation: it is then offered the whole investigation set. */
  investigationStarted?: (sessionId: string) => boolean;
}

interface RememberedTurn {
  readonly groups: ReadonlySet<BrowserToolGroupName>;
  readonly investigation: boolean;
}

/**
 * `selectRelevantTools` with a memory per chat: a turn is offered its own
 * message's tools plus those of the chat's last three turns that selected
 * any, so a follow-up such as "ok go ahead" keeps the tools the
 * investigation it continues was using, where on its own it reads as
 * casual chat and gets none. A turn that selects nothing is not
 * remembered, so short replies do not push the investigation out. A new
 * chat, or a turn with no session, starts with no memory.
 */
export function createStickyToolSelector({
  maxSessions = 50,
  investigationStarted = (sessionId) =>
    getInvestigation(sessionId) !== undefined,
}: StickyToolSelectorOptions = {}): (
  text: string,
  sessionId: string | null,
) => FunctionTool[] {
  const recentTurns = new Map<string, RememberedTurn[]>();

  return (text, sessionId) => {
    const current = selectRelevantGroups(text);
    const asked = asksForInvestigation(text);
    const why = WHY.test(text);
    if (sessionId === null) {
      return toolsOfRoute(current, routeOf(current, asked, why));
    }
    // A file request stays a file request: the investigation it follows
    // does not ride along (see RETRIEVAL_REQUEST).
    if (RETRIEVAL_REQUEST.test(text.toLowerCase().trim())) {
      return toolsOfRoute(current, routeOf(current, false));
    }

    const turns = recentTurns.get(sessionId) ?? [];
    const groups = new Set([
      ...turns.flatMap((t) => [...t.groups]),
      ...current,
    ]);
    const investigation =
      asked ||
      turns.some((t) => t.investigation) ||
      investigationStarted(sessionId);

    recentTurns.delete(sessionId);
    recentTurns.set(
      sessionId,
      current.size > 0
        ? [...turns, { groups: current, investigation: asked }].slice(
            -REMEMBERED_TURNS,
          )
        : turns,
    );
    if (recentTurns.size > maxSessions) {
      const oldest = recentTurns.keys().next().value;
      if (oldest !== undefined) recentTurns.delete(oldest);
    }
    return toolsOfRoute(groups, routeOf(groups, investigation, why));
  };
}

/**
 * `tools` without search_kb, for a turn where KB text may not reach the
 * model (KB-RAG K22, D-SEC1): its prompt section goes with it, since the
 * system prompt is composed from the tools offered.
 */
export function withoutKbSearch(tools: FunctionTool[]): FunctionTool[] {
  return tools.filter((tool) => tool.name !== "search_kb");
}
