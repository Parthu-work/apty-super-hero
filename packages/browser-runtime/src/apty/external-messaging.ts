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
 * Why a cross-extension message got no usable answer:
 * - `no_receiver`: Chrome found no listener for us — the target does not
 *   list this extension under `externally_connectable.ids`, or registers
 *   no `chrome.runtime.onMessageExternal` handler.
 * - `no_response`: a handler ran but answered nothing, so it does not
 *   implement this message type. Chrome reports this as "The message port
 *   closed before a response was received." (some builds instead leave the
 *   call hanging, which ends as `timeout`).
 * - `timeout`: nothing came back in time (a stuck handler, or a service
 *   worker that did not wake).
 * - `send_failed`: Chrome rejected the send itself.
 */
export type ExternalMessageFailure =
  | "no_receiver"
  | "no_response"
  | "timeout"
  | "send_failed";

export type ExternalMessageOutcome =
  | { ok: true; response: unknown }
  | { ok: false; failure: ExternalMessageFailure; detail?: string };

const NO_RECEIVER_PATTERN =
  /receiving end does not exist|could not establish connection/i;
const PORT_CLOSED_PATTERN = /message port closed before a response/i;

function classifyLastError(message: string): ExternalMessageFailure {
  if (NO_RECEIVER_PATTERN.test(message)) return "no_receiver";
  if (PORT_CLOSED_PATTERN.test(message)) return "no_response";
  return "send_failed";
}

/**
 * Send a message to a specific, already-configured extension ID and report
 * either its answer or why there was none. Never broadcasts and never
 * targets an ID the caller didn't explicitly configure.
 */
export function sendExternalMessageDetailed(
  extensionId: string,
  message: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ExternalMessageOutcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, failure: "timeout" }),
      timeoutMs,
    );
    try {
      chrome.runtime.sendMessage(extensionId, message, (response) => {
        clearTimeout(timer);
        const lastError = chrome.runtime.lastError?.message;
        if (lastError) {
          resolve({
            ok: false,
            failure: classifyLastError(lastError),
            detail: lastError,
          });
          return;
        }
        if (response === undefined) {
          resolve({ ok: false, failure: "no_response" });
          return;
        }
        resolve({ ok: true, response });
      });
    } catch (error) {
      clearTimeout(timer);
      resolve({
        ok: false,
        failure: "send_failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/** `sendExternalMessageDetailed` for callers that only need the answer. */
export async function sendExternalMessage(
  extensionId: string,
  message: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<unknown | undefined> {
  const outcome = await sendExternalMessageDetailed(
    extensionId,
    message,
    timeoutMs,
  );
  return outcome.ok ? outcome.response : undefined;
}
