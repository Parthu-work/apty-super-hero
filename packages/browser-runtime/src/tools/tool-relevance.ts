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

/**
 * Select which browser tools to expose to the model for one chat message.
 *
 * @param userMessage The current user message text (not the full history —
 *   this is a per-turn decision, deliberately simple for a first rollout).
 * @returns The relevant tool objects (sourced from the same canonical
 *   `browserToolGroups`), or `[]` for messages that read as casual chat.
 */
export function selectRelevantTools(userMessage: string): FunctionTool[] {
  const text = userMessage.toLowerCase();
  const matchedGroups = new Set<BrowserToolGroupName>();

  for (const [group, keywords] of Object.entries(GROUP_KEYWORDS) as Array<
    [BrowserToolGroupName, string[]]
  >) {
    if (keywords.some((kw) => text.includes(kw))) {
      matchedGroups.add(group);
    }
  }

  if (GROUPS_THAT_IMPLY_INVESTIGATION.some((g) => matchedGroups.has(g))) {
    matchedGroups.add("investigation");
  }

  if (matchedGroups.size === 0) {
    if (isLikelyCasualMessage(text)) {
      return [];
    }
    for (const group of DEFAULT_FALLBACK_GROUPS) {
      matchedGroups.add(group);
    }
  }

  const seenNames = new Set<string>();
  const selected: FunctionTool[] = [];
  for (const group of matchedGroups) {
    for (const tool of browserToolGroups[group]) {
      if (!seenNames.has(tool.name)) {
        seenNames.add(tool.name);
        selected.push(tool as unknown as FunctionTool);
      }
    }
  }
  return selected;
}
