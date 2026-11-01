/**
 * Reads the Ask Dapty conversation shown in the Apty Widget's chat panel,
 * from the open shadow root of `<apty-widget>` in the tab's top frame.
 *
 * Best effort: only the turn markers below are known to be stable, and the
 * DOM carries suggestion names but not their ids ("names only").
 * - An assistant turn has `data-chat-dialog="show.feedback"`; its first child
 *   is the reply, and each MUI Button after it is one suggestion.
 * - A user turn is a sibling holding a `MuiTypography-body2`.
 * - An error turn holds a `MuiTypography-body1`.
 * Returns text only, never HTML.
 */
import { isOwnExtensionPage } from "../runtime/trusted-sender.js";

/** @internal Used by the Ask Dapty check. */
export interface RawDaptyDomTurn {
  role: "user" | "assistant" | "error";
  text: string;
  suggestionNames: string[];
}

/** @internal Used by the Ask Dapty check. */
export type DaptyWidgetRead =
  | { ok: true; turns: RawDaptyDomTurn[] }
  | { ok: false; reason: "no-widget" | "no-chat-open" | "not-readable" };

/** @internal */
export const MAX_DOM_TURNS = 50;
/** @internal */
export const MAX_DOM_TEXT_CHARS = 4000;
const MAX_SUGGESTIONS_PER_TURN = 20;
const DAPTY_WIDGET_TURNS_MESSAGE = "apty-agent:dapty-widget-turns";

/**
 * Runs in the page (it must stay self-contained: `chrome.scripting` sends
 * only its source).
 * @internal
 */
export function readDaptyTurnsInPage(
  maxTurns: number,
  maxChars: number,
  maxSuggestions: number,
): DaptyWidgetRead {
  const host = document.querySelector("apty-widget");
  if (!host) return { ok: false, reason: "no-widget" };
  const root = host.shadowRoot;
  if (!root) return { ok: false, reason: "not-readable" };

  const textOf = (el: Element): string => {
    const raw = (el as HTMLElement).innerText ?? el.textContent ?? "";
    return raw
      .replace(/[ \t\f\v ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, maxChars);
  };

  const firstAssistant = root.querySelector(
    '[data-chat-dialog="show.feedback"]',
  );
  const container = firstAssistant?.parentElement;
  if (!container) return { ok: false, reason: "no-chat-open" };

  const turns: RawDaptyDomTurn[] = [];
  for (const child of Array.from(container.children)) {
    if (child.getAttribute("data-chat-dialog") === "show.feedback") {
      const bubble = child.firstElementChild;
      if (!bubble) continue;
      const suggestionNames = Array.from(
        child.querySelectorAll(".MuiButton-root"),
      )
        .filter((button) => !bubble.contains(button))
        .map(textOf)
        .filter(Boolean)
        .slice(0, maxSuggestions);
      turns.push({ role: "assistant", text: textOf(bubble), suggestionNames });
      continue;
    }
    const user = child.querySelector(".MuiTypography-body2");
    if (user) {
      turns.push({ role: "user", text: textOf(user), suggestionNames: [] });
      continue;
    }
    const error = child.querySelector(".MuiTypography-body1");
    if (error) {
      turns.push({ role: "error", text: textOf(error), suggestionNames: [] });
    }
  }
  return { ok: true, turns: turns.slice(-maxTurns) };
}

/**
 * The turns of the Ask Dapty chat open in the tab's Widget, oldest first.
 * @internal Used by the Ask Dapty check.
 */
export async function readDaptyWidgetTurns(
  tabId: number,
): Promise<DaptyWidgetRead> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: readDaptyTurnsInPage,
      args: [MAX_DOM_TURNS, MAX_DOM_TEXT_CHARS, MAX_SUGGESTIONS_PER_TURN],
    });
    const result = first?.result as DaptyWidgetRead | undefined;
    if (!result || typeof result !== "object" || !("ok" in result)) {
      return { ok: false, reason: "not-readable" };
    }
    return result;
  } catch {
    return { ok: false, reason: "not-readable" };
  }
}

/**
 * The service worker's answer to `apty-agent:dapty-widget-turns` with
 * `{ tabId }`, for this extension's own pages only: the same read, for a
 * caller that runs where it cannot inject scripts. Returns whether it will
 * answer.
 */
export function handleDaptyWidgetTurnsMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): boolean {
  const { type, tabId } = (message ?? {}) as {
    type?: unknown;
    tabId?: unknown;
  };
  if (type !== DAPTY_WIDGET_TURNS_MESSAGE) return false;
  if (!isOwnExtensionPage(sender) || typeof tabId !== "number") {
    sendResponse(undefined);
    return false;
  }
  readDaptyWidgetTurns(tabId).then(sendResponse);
  return true;
}
