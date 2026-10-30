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
};

// Cheap, deterministic context every investigative request benefits from,
// used only when the message isn't clearly casual chat and no category
// matched (an ambiguous "what's going on here?" style question).
const DEFAULT_FALLBACK_GROUPS: BrowserToolGroupName[] = ["tabs", "page"];

// Investigation-lifecycle tools (evidence, hypotheses, verification) are
// pulled in by these categories even when the wording doesn't literally
// say "investigate" — an Apty/network/extension question about *why*
// something happens is a debugging request either way.
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
  return trimmed.split(/\s+/).length <= 3;
}

function selectRelevantGroups(userMessage: string): Set<BrowserToolGroupName> {
  const text = userMessage.toLowerCase();
  const matchedGroups = new Set<BrowserToolGroupName>();

  for (const [group, keywords] of Object.entries(GROUP_KEYWORDS) as Array<
    [BrowserToolGroupName, string[]]
  >) {
    if (keywords.some((kw) => text.includes(kw))) {
      matchedGroups.add(group);
    }
  }

  if (
    !RETRIEVAL_REQUEST.test(text.trim()) &&
    GROUPS_THAT_IMPLY_INVESTIGATION.some((g) => matchedGroups.has(g))
  ) {
    matchedGroups.add("investigation");
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
 * Select which browser tools to expose to the model for one chat message.
 *
 * @param userMessage The current user message text (not the full history;
 *   `createStickyToolSelector` adds the chat's recent turns).
 * @returns The relevant tool objects (sourced from the same canonical
 *   `browserToolGroups`), or `[]` for messages that read as casual chat.
 */
export function selectRelevantTools(userMessage: string): FunctionTool[] {
  return toolsOf(selectRelevantGroups(userMessage));
}

const REMEMBERED_TURNS = 3;

export interface StickyToolSelectorOptions {
  /** Chats remembered at once; the least recently used one is forgotten first. */
  maxSessions?: number;
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
}: StickyToolSelectorOptions = {}): (
  text: string,
  sessionId: string | null,
) => FunctionTool[] {
  const recentTurns = new Map<string, Set<BrowserToolGroupName>[]>();

  return (text, sessionId) => {
    const current = selectRelevantGroups(text);
    if (sessionId === null) return toolsOf(current);
    // A file request stays a file request: the investigation it follows
    // does not ride along (see RETRIEVAL_REQUEST).
    if (RETRIEVAL_REQUEST.test(text.toLowerCase().trim())) {
      return toolsOf(current);
    }

    const turns = recentTurns.get(sessionId) ?? [];
    const groups = new Set([...turns.flatMap((t) => [...t]), ...current]);

    recentTurns.delete(sessionId);
    recentTurns.set(
      sessionId,
      current.size > 0 ? [...turns, current].slice(-REMEMBERED_TURNS) : turns,
    );
    if (recentTurns.size > maxSessions) {
      const oldest = recentTurns.keys().next().value;
      if (oldest !== undefined) recentTurns.delete(oldest);
    }
    return toolsOf(groups);
  };
}
