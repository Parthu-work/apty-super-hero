/**
 * Apty Service Worker diagnostics
 *
 * STATUS: consumer side implemented; producer side requires Apty-side work.
 * A Chrome extension cannot inspect another extension's (or another
 * origin's) service-worker memory directly; there is no Chrome API for
 * that. This provider only supports mechanisms Apty explicitly exposes:
 *
 *   1. Cross-extension messaging (Option A, current priority): if Apty's
 *      Widget service worker implements `onMessageExternal` and allowlists
 *      this extension's ID, we send it
 *      `{type: "apty-debug-agent:get-service-worker-status"}` /
 *      `{type: "apty-debug-agent:get-service-worker-logs"}` and validate
 *      whatever comes back — never trust an external response blindly.
 *   2. An HTTP diagnostic endpoint (Option B, future): if/when Apty exposes
 *      one, `GET <endpoint>/status` and `GET <endpoint>/logs`.
 *
 * See `apty-widget-service-worker.reference.ts` in this directory for a
 * complete, ready-to-adapt reference implementation of the Option A
 * producer side (what needs to live inside the Apty Widget's service
 * worker) — that file is documentation/hand-off code, not part of this
 * extension's build.
 *
 * Configure at most one of `extensionId` / `diagnosticEndpoint` (see
 * config.ts / .env.example in packages/browser-ext). With neither
 * configured, this always reports `status: "not_configured"` — do not
 * treat that as a failure, it means the integration hasn't been set up.
 *
 * IMPORTANT — evidence scope: the Apty service worker is a single global
 * process shared across every tab, not scoped to whichever tab/session
 * asked for it. Every result here is tagged `scope: "shared-global"` so
 * the agent (and any session-isolation logic built on top of this) never
 * falsely attributes a service-worker log to one specific tab or
 * conversation — see PROJECT_PROGRESS.md's Known Limitations for the
 * broader multi-session work this feeds into.
 */

import { z } from "zod";
import { redactLogs } from "./redact.js";
import type {
  AptyLog,
  AptyServiceWorkerDiagnosticsProvider,
  AptyServiceWorkerStatus,
} from "./types.js";

const REQUEST_TIMEOUT_MS = 3000;

// Bounded so a hostile/misbehaving Widget extension can't hand us an
// unbounded array and balloon memory/token usage — this is a defensive
// ceiling, not a target; see apty-widget-service-worker.reference.ts for
// the producer-side bound (MAX_ENTRIES = 1000) that should keep responses
// well under this anyway.
const MAX_LOGS_ACCEPTED = 2000;

const aptyLogSchema = z.object({
  level: z.enum(["debug", "log", "info", "warn", "error"]).catch("log"),
  message: z.string().max(10_000),
  timestamp: z.number().finite(),
});

const statusResponseSchema = z.object({
  running: z.boolean().optional(),
  lastActivity: z.number().finite().optional(),
});

const logsResponseSchema = z.object({
  logs: z.array(aptyLogSchema).max(MAX_LOGS_ACCEPTED).optional(),
});

/** Result of validating an untrusted external response. */
type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

function validate<T>(
  schema: z.ZodType<T>,
  data: unknown,
): ValidationResult<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? "invalid shape" };
  }
  return { ok: true, value: parsed.data };
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

/**
 * Send a message to a specific, already-configured extension ID and wait
 * for a response with a timeout. Never broadcasts and never targets an
 * ID the caller didn't explicitly configure — there is no wildcard path.
 */
function sendExternalMessage(
  extensionId: string,
  message: unknown,
  timeoutMs: number,
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
      const raw = await sendExternalMessage(
        this.config.extensionId,
        { type: "apty-debug-agent:get-service-worker-status" },
        REQUEST_TIMEOUT_MS,
      );
      if (raw === undefined) return { status: "unavailable" };

      const result = validate(statusResponseSchema, raw);
      if (!result.ok) {
        return { status: "error", error: `malformed status response: ${result.reason}` };
      }
      return { status: "ok", running: result.value.running, lastActivity: result.value.lastActivity };
    }

    if (this.config.diagnosticEndpoint) {
      const response = await fetchWithTimeout(
        `${this.config.diagnosticEndpoint}/status`,
        REQUEST_TIMEOUT_MS,
      );
      if (!response?.ok) return { status: "unavailable" };

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { status: "error", error: "diagnostic endpoint returned invalid JSON" };
      }

      const result = validate(statusResponseSchema, body);
      if (!result.ok) {
        return { status: "error", error: `malformed status response: ${result.reason}` };
      }
      return { status: "ok", running: result.value.running, lastActivity: result.value.lastActivity };
    }

    return { status: "not_configured" };
  }

  async getLogs(): Promise<AptyLog[]> {
    if (this.config.extensionId) {
      const raw = await sendExternalMessage(
        this.config.extensionId,
        { type: "apty-debug-agent:get-service-worker-logs" },
        REQUEST_TIMEOUT_MS,
      );
      if (raw === undefined) return [];

      const result = validate(logsResponseSchema, raw);
      if (!result.ok) return [];
      return redactLogs(result.value.logs ?? []);
    }

    if (this.config.diagnosticEndpoint) {
      const response = await fetchWithTimeout(
        `${this.config.diagnosticEndpoint}/logs`,
        REQUEST_TIMEOUT_MS,
      );
      if (!response?.ok) return [];

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return [];
      }

      const result = validate(logsResponseSchema, body);
      if (!result.ok) return [];
      return redactLogs(result.value.logs ?? []);
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
