/**
 * DOM events between the MAIN-world page hooks (`page-hooks.ts`) and the
 * isolated-world frame responder, both on `window`. Only a string `detail`
 * crosses from the page's world to the content script's, so totals travel
 * as JSON text.
 */
export const HISTORY_API_EVENT = "apty:dom-health:history-api";

/** Dispatched by the responder when it installs; the hooks answer with a `HISTORY_API_EVENT` carrying the totals so far. */
export const HISTORY_SYNC_REQUEST_EVENT = "apty:dom-health:history-sync";

/** Counts since the document started, kept by the MAIN-world hooks. */
export interface HistoryApiTotals {
  pushState: number;
  replaceState: number;
  popstate: number;
  hashchange: number;
}

export type HistoryApiMethod = keyof HistoryApiTotals;

export const ZERO_HISTORY_TOTALS: HistoryApiTotals = {
  pushState: 0,
  replaceState: 0,
  popstate: 0,
  hashchange: 0,
};

/** The totals in an event's `detail`, or null when it is not a well-formed totals message. */
export function parseHistoryTotals(detail: unknown): HistoryApiTotals | null {
  if (typeof detail !== "string") return null;
  try {
    const parsed = JSON.parse(detail) as Partial<HistoryApiTotals>;
    const totals = { ...ZERO_HISTORY_TOTALS };
    for (const key of Object.keys(ZERO_HISTORY_TOTALS) as HistoryApiMethod[]) {
      const value = parsed[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return null;
      }
      totals[key] = value;
    }
    return totals;
  } catch {
    return null;
  }
}
