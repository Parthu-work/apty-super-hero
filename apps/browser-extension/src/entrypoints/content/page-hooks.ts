/**
 * DOM Health hooks that must run in the page's own world.
 *
 * `history.pushState` / `replaceState` are JavaScript methods, and a content
 * script's isolated world has its own JavaScript wrappers for `history`:
 * replacing the method there (as the frame responder used to) never sees
 * the page's calls, so a pushState-routed application such as athenaOne
 * read as "no client-side routing" (re-audit finding N-3). Wrapping the
 * `History.prototype` methods here, at document_start, before the page's
 * scripts run, sees every call. `popstate` and `hashchange` are counted here
 * too, so a navigation that happens while the frame responder is still
 * loading (it loads asynchronously) is not lost: the totals since the
 * document started are announced after each event and whenever the
 * responder asks (`HISTORY_SYNC_REQUEST_EVENT`).
 *
 * Installed by the console bridge, the existing MAIN-world script, and
 * held to the same rules: never throw into the page, never change what the
 * wrapped method returns or throws, install once per frame. A page can
 * dispatch the same events itself; the counts are routing evidence, never
 * identity or a security decision, so a forged event only inflates them.
 */
import {
  HISTORY_API_EVENT,
  HISTORY_SYNC_REQUEST_EVENT,
  type HistoryApiMethod,
  type HistoryApiTotals,
  ZERO_HISTORY_TOTALS,
} from "./page-events";

const INSTALLED_KEY = "__aptyDomHealthPageHooks";

/** `window` with the `History` interface object, which the DOM typings leave off `Window`. */
type PageWindow = Window & { History?: typeof History };

function announce(win: Window, totals: HistoryApiTotals): void {
  try {
    win.dispatchEvent(
      new CustomEvent(HISTORY_API_EVENT, { detail: JSON.stringify(totals) }),
    );
  } catch {
    // Announcing is best effort; the page's navigation already happened.
  }
}

function wrapHistoryMethod(
  win: Window,
  method: "pushState" | "replaceState",
  totals: HistoryApiTotals,
): void {
  const proto = (win as PageWindow).History?.prototype;
  const original = proto?.[method];
  if (!proto || typeof original !== "function") return;
  proto[method] = function wrappedHistoryMethod(
    this: History,
    ...args: Parameters<History["pushState"]>
  ) {
    const result = original.apply(this, args);
    totals[method]++;
    announce(win, totals);
    return result;
  };
}

/** Install the page-world hooks once in `win`. Returns false when they were already installed. */
export function installPageHooks(win: Window = window): boolean {
  try {
    if (Object.hasOwn(win, INSTALLED_KEY)) return false;
    Object.defineProperty(win, INSTALLED_KEY, {
      value: true,
      writable: false,
      enumerable: false,
      configurable: false,
    });
    const totals: HistoryApiTotals = { ...ZERO_HISTORY_TOTALS };
    wrapHistoryMethod(win, "pushState", totals);
    wrapHistoryMethod(win, "replaceState", totals);
    for (const event of [
      "popstate",
      "hashchange",
    ] as const satisfies HistoryApiMethod[]) {
      win.addEventListener(event, () => {
        totals[event]++;
        announce(win, totals);
      });
    }
    win.addEventListener(HISTORY_SYNC_REQUEST_EVENT, () =>
      announce(win, totals),
    );
    return true;
  } catch {
    return false;
  }
}
