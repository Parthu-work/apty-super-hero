/**
 * Restrict `chrome.storage.local`/`session` to trusted contexts (the
 * background service worker, options page, side panel) only.
 *
 * `chrome.storage.local` defaults to `TRUSTED_AND_UNTRUSTED_CONTEXTS` for
 * backward compatibility — meaning this extension's own isolated-world
 * content script, which runs on `<all_urls>`, can read and write it too.
 * LLM API keys and Apty peer approvals (extension IDs the user has
 * explicitly trusted) live in `chrome.storage.local`; a hostile page has no
 * business being able to read those back out through the content script it
 * shares an isolated world with. `chrome.storage.session` already defaults
 * to `TRUSTED_CONTEXTS`; the call here is defense-in-depth, not a fix for
 * an existing gap.
 *
 * Must be called from the background service worker (a trusted context) —
 * calling it from anywhere else throws.
 */
export function lockdownStorageAccess(): void {
  chrome.storage.local
    .setAccessLevel({
      accessLevel: chrome.storage.AccessLevel.TRUSTED_CONTEXTS,
    })
    .catch((error) => {
      console.error("Failed to restrict chrome.storage.local access:", error);
    });

  chrome.storage.session
    .setAccessLevel({
      accessLevel: chrome.storage.AccessLevel.TRUSTED_CONTEXTS,
    })
    .catch((error) => {
      console.error("Failed to restrict chrome.storage.session access:", error);
    });
}
