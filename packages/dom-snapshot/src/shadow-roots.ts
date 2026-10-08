/** Ids of the elements the Agent's content script adds to a page; audits skip them. */
export const AGENT_UI_ROOT_IDS: readonly string[] = [
  "aipex-content-root",
  "aipex-border-overlay",
];

interface ChromeDomApi {
  openOrClosedShadowRoot?: (element: HTMLElement) => ShadowRoot | null;
}

/**
 * The shadow root attached to `element`, open or closed. Closed roots are
 * only reachable from an extension content script through
 * `chrome.dom.openOrClosedShadowRoot` (Chrome 88+); elsewhere this returns
 * open roots only.
 */
export function shadowRootOf(element: Element): ShadowRoot | null {
  if (element.shadowRoot) return element.shadowRoot;
  const dom = (globalThis as { chrome?: { dom?: ChromeDomApi } }).chrome?.dom;
  if (!dom?.openOrClosedShadowRoot) return null;
  try {
    return dom.openOrClosedShadowRoot(element as HTMLElement) ?? null;
  } catch {
    return null;
  }
}
