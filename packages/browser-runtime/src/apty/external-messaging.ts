/**
 * Cross-extension messaging helper — the ONLY mechanism Chrome allows one
 * extension to use to ask another extension for data.
 *
 * IMPORTANT ARCHITECTURAL NOTE (verified against real Chrome, not assumed):
 * `chrome.debugger.attach({targetId})` unconditionally fails with "Cannot
 * access a chrome-extension:// URL of different extension" when the target
 * belongs to a different extension than the caller — this is a hard Chrome
 * security boundary with no permission or flag that lifts it. A previous
 * design in this codebase (see git history of extension-network-inspector.ts)
 * assumed cross-extension `chrome.debugger` attach was possible and built a
 * whole capture session around it; every test for that design mocked
 * `chrome.debugger.attach()` to unconditionally succeed, which is why the
 * flaw went undetected until tested against a real browser. The only
 * legitimate mechanism left is `chrome.runtime.sendMessage(extensionId, ...)`
 * cross-extension messaging, which requires the TARGET extension to
 * cooperate: its manifest must list this extension's id under
 * `externally_connectable`, and its service worker must implement a
 * `chrome.runtime.onMessageExternal` handler for the message types below.
 * Without that cooperation, every call here reports `unavailable` /
 * `not_configured` — never a fabricated result.
 */

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Send a message to a specific, already-configured extension ID and wait
 * for a response with a timeout. Never broadcasts and never targets an ID
 * the caller didn't explicitly configure — there is no wildcard path.
 */
export function sendExternalMessage(
  extensionId: string,
  message: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<unknown | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    try {
      chrome.runtime.sendMessage(extensionId, message, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          // Expected when the target extension isn't installed, doesn't
          // allowlist us, or its service worker isn't currently running
          // and failed to wake — all of these are "unavailable", not
          // exceptional errors worth surfacing as a crash.
          resolve(undefined);
          return;
        }
        resolve(response);
      });
    } catch {
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}
