/**
 * Apty Studio diagnostics
 *
 * STATUS: not implemented — requires Apty-side integration. Unlike the
 * Widget/Client, Studio is assumed to be a separate Chrome extension (per
 * the project brief), so this cannot be probed via a page-injected global.
 * The only Chrome-supported mechanism for one extension to ask another for
 * data is cross-extension messaging, which requires BOTH sides to agree:
 *
 *   1. Studio's manifest.json must list this extension's ID in its own
 *      `externally_connectable.ids` (or vice versa via `chrome.runtime.connect`
 *      with Studio's ID, which requires Studio to declare
 *      `externally_connectable` addressable by ID).
 *   2. Studio must implement a handler (e.g. `onMessageExternal`) that
 *      responds to a diagnostic-request message with real status/logs.
 *
 * Neither side of that contract exists today. This provider is wired to
 * attempt `chrome.runtime.sendMessage(studioExtensionId, ...)` once an
 * extension ID is configured (see config.ts / .env.example in
 * apps/browser-extension), but until Studio implements the corresponding
 * listener, every call will resolve to `status: "unavailable"` — that is
 * the honest, expected result, not a bug in this code.
 */

import type {
  AptyLog,
  AptyStudioDiagnosticsProvider,
  AptyStudioStatus,
} from "./types";

const REQUEST_TIMEOUT_MS = 3000;

interface StudioDiagnosticResponse {
  active?: boolean;
  selectionMode?: boolean;
  lastSelectedSelector?: string;
  logs?: AptyLog[];
}

function sendExternalMessage<T>(
  extensionId: string,
  message: unknown,
  timeoutMs: number,
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    try {
      chrome.runtime.sendMessage(extensionId, message, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        resolve(response as T);
      });
    } catch {
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}

export class ExternalMessageStudioDiagnosticsProvider
  implements AptyStudioDiagnosticsProvider
{
  constructor(private readonly studioExtensionId: string | undefined) {}

  async getStatus(): Promise<AptyStudioStatus> {
    if (!this.studioExtensionId) {
      return { status: "not_configured" };
    }

    const response = await sendExternalMessage<StudioDiagnosticResponse>(
      this.studioExtensionId,
      { type: "apty-debug-agent:get-studio-status" },
      REQUEST_TIMEOUT_MS,
    );

    if (!response) {
      return { status: "unavailable" };
    }

    return {
      status: "ok",
      active: response.active,
      selectionMode: response.selectionMode,
      lastSelectedSelector: response.lastSelectedSelector,
    };
  }

  async getLogs(): Promise<AptyLog[]> {
    if (!this.studioExtensionId) {
      return [];
    }
    const response = await sendExternalMessage<StudioDiagnosticResponse>(
      this.studioExtensionId,
      { type: "apty-debug-agent:get-studio-logs" },
      REQUEST_TIMEOUT_MS,
    );
    return response?.logs ?? [];
  }
}

export class NotConfiguredStudioDiagnosticsProvider
  implements AptyStudioDiagnosticsProvider
{
  async getStatus(): Promise<AptyStudioStatus> {
    return { status: "not_configured" };
  }
  async getLogs(): Promise<AptyLog[]> {
    return [];
  }
}
