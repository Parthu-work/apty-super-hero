/**
 * Apty Service Worker diagnostics
 *
 * STATUS: not implemented — requires Apty-side integration. A Chrome
 * extension cannot inspect another extension's (or another origin's)
 * service-worker memory directly; there is no Chrome API for that. This
 * provider only supports mechanisms Apty explicitly exposes:
 *
 *   1. Cross-extension messaging: if Apty's service worker belongs to an
 *      extension that implements `onMessageExternal` and allowlists this
 *      extension's ID, we can ask it for status/logs the same way
 *      studio-diagnostics.ts does.
 *   2. An HTTP diagnostic endpoint: if Apty exposes one (e.g. the Widget's
 *      own backend surfaces recent service-worker log lines), we can fetch
 *      it directly.
 *
 * Configure at most one of `extensionId` / `diagnosticEndpoint` (see
 * config.ts / .env.example in packages/browser-ext). With neither
 * configured, this always reports `status: "not_configured"` — do not
 * treat that as a failure, it means the integration hasn't been set up.
 */

import type {
  AptyLog,
  AptyServiceWorkerDiagnosticsProvider,
  AptyServiceWorkerStatus,
} from "./types";

const REQUEST_TIMEOUT_MS = 3000;

interface ServiceWorkerDiagnosticResponse {
  running?: boolean;
  lastActivity?: number;
  logs?: AptyLog[];
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<Response | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
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

export interface ServiceWorkerDiagnosticsConfig {
  extensionId?: string;
  diagnosticEndpoint?: string;
}

export class ConfiguredServiceWorkerDiagnosticsProvider
  implements AptyServiceWorkerDiagnosticsProvider
{
  constructor(private readonly config: ServiceWorkerDiagnosticsConfig) {}

  async getStatus(): Promise<AptyServiceWorkerStatus> {
    if (this.config.extensionId) {
      const response =
        await sendExternalMessage<ServiceWorkerDiagnosticResponse>(
          this.config.extensionId,
          { type: "apty-debug-agent:get-service-worker-status" },
          REQUEST_TIMEOUT_MS,
        );
      if (!response) return { status: "unavailable" };
      return {
        status: "ok",
        running: response.running,
        lastActivity: response.lastActivity,
      };
    }

    if (this.config.diagnosticEndpoint) {
      const response = await fetchWithTimeout(
        `${this.config.diagnosticEndpoint}/status`,
        REQUEST_TIMEOUT_MS,
      );
      if (!response?.ok) return { status: "unavailable" };
      const body = (await response.json()) as ServiceWorkerDiagnosticResponse;
      return {
        status: "ok",
        running: body.running,
        lastActivity: body.lastActivity,
      };
    }

    return { status: "not_configured" };
  }

  async getLogs(): Promise<AptyLog[]> {
    if (this.config.extensionId) {
      const response =
        await sendExternalMessage<ServiceWorkerDiagnosticResponse>(
          this.config.extensionId,
          { type: "apty-debug-agent:get-service-worker-logs" },
          REQUEST_TIMEOUT_MS,
        );
      return response?.logs ?? [];
    }

    if (this.config.diagnosticEndpoint) {
      const response = await fetchWithTimeout(
        `${this.config.diagnosticEndpoint}/logs`,
        REQUEST_TIMEOUT_MS,
      );
      if (!response?.ok) return [];
      const body = (await response.json()) as ServiceWorkerDiagnosticResponse;
      return body.logs ?? [];
    }

    return [];
  }
}

export class NotConfiguredServiceWorkerDiagnosticsProvider
  implements AptyServiceWorkerDiagnosticsProvider
{
  async getStatus(): Promise<AptyServiceWorkerStatus> {
    return { status: "not_configured" };
  }
  async getLogs(): Promise<AptyLog[]> {
    return [];
  }
}
