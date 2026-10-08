/**
 * True when a runtime message comes from one of this extension's own pages
 * or its service worker, never from a content script.
 *
 * Decided by the sender's URL: a content script reports the web page it
 * runs in, while an extension page reports a chrome-extension://<own id>/
 * URL. `sender.tab` cannot be used for this, because the options page opens
 * in a tab and a side panel page can too.
 */
export function isOwnExtensionPage(
  sender: chrome.runtime.MessageSender,
): boolean {
  const ownId = chrome.runtime?.id;
  if (!ownId || sender.id !== ownId) return false;
  const origin = `chrome-extension://${ownId}`;
  const url = sender.url ?? sender.origin ?? "";
  return url === origin || url.startsWith(`${origin}/`);
}
