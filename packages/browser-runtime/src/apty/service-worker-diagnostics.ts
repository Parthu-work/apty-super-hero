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
 * config.ts / .env.example in apps/browser-extension). With neither
 * configured, this always reports `status: "not_configured"` — do not
 * treat that as a failure, it means the integration hasn't been set up.
 *
 * IMPORTANT — evidence scope: the Apty service worker is a single global
 * process shared across every tab, not scoped to whichever tab/session
 * asked for it. Every result here is tagged `scope: "shared-global"` so
 * the agent (and any session-isolation logic built on top of this) never
 * falsely attributes a service-worker log to one specific tab or
 * conversation — see docs/development/PROJECT_PROGRESS.md's Known Limitations for the
 * broader multi-session work this feeds into.
 */

import { redactLogs, redactSensitiveText } from "@apty/debug-contract";
import { z } from "zod";
import {
  type ExternalMessageFailure,
  type ExternalMessageOutcome,
  sendExternalMessageDetailed,
} from "./external-messaging.js";
import type {
  AptyLog,
  AptyObservedResource,
  AptyResourceBody,
  AptyServiceWorkerDiagnosticsProvider,
  AptyServiceWorkerStatus,
} from "./types.js";

// A cross-extension message wakes the target's service worker if it was
// suspended (Chrome does this automatically) — but a cold SW start is
// measurably slower than an already-running one responding instantly, and
// this codebase's own usage pattern (long waits between turns for a
// rate-limited LLM provider) means the Apty Client's SW is suspended more
// often than not by the time the next message reaches it. A single short
// timeout turned a cold-start-is-still-in-progress case into a false
// "did not respond" failure. First attempt gets a longer timeout to absorb
// a cold start; if it still times out, one retry follows (matching the v7
// spec's "timeout 5s (8s on the first call) with one retry").
const FIRST_ATTEMPT_TIMEOUT_MS = 8000;
const RETRY_TIMEOUT_MS = 5000;
/** Timeout for the separate HTTP-diagnostic-endpoint fallback path (not cross-extension messaging, so the cold-SW-wake reasoning above doesn't apply here). */
const REQUEST_TIMEOUT_MS = 3000;

/** Send a cross-extension message with one retry when nothing answered — see the comment above for why a single short timeout isn't enough for a cold service-worker wake. A handler that answered with nothing is not retried. */
async function sendWithRetryDetailed(
  extensionId: string,
  message: unknown,
): Promise<ExternalMessageOutcome> {
  const first = await sendExternalMessageDetailed(
    extensionId,
    message,
    FIRST_ATTEMPT_TIMEOUT_MS,
  );
  if (first.ok || first.failure === "no_response") return first;
  return sendExternalMessageDetailed(extensionId, message, RETRY_TIMEOUT_MS);
}

async function sendExternalMessageWithRetry(
  extensionId: string,
  message: unknown,
): Promise<unknown | undefined> {
  const outcome = await sendWithRetryDetailed(extensionId, message);
  return outcome.ok ? outcome.response : undefined;
}

const PEER_FAILURE_MESSAGES: Record<ExternalMessageFailure, string> = {
  no_receiver:
    "Chrome found nothing listening in the Apty Client for this extension. The Client must list this extension's ID under externally_connectable.ids in its manifest and register a chrome.runtime.onMessageExternal handler at the top level of its service worker.",
  no_response:
    "The Apty Client received the message but answered nothing, so it does not implement the apty-debug-agent:get-service-worker-status message. Install the Agent bridge module in the Client's service worker.",
  timeout:
    "The Apty Client accepted the message but never answered, even after a retry. Usually its onMessageExternal handler does not implement the apty-debug-agent:get-service-worker-status message (install or update the Agent bridge module); otherwise its service worker is stuck, so check chrome://extensions for errors on the Client.",
  send_failed: "Chrome refused to send the message to the Apty Client.",
};

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

// Same defensive-ceiling reasoning as MAX_LOGS_ACCEPTED.
const MAX_RESOURCES_ACCEPTED = 1000;
const MAX_BODY_CHARS_ACCEPTED = 200_000;

const observedResourceSchema = z.object({
  requestId: z.string().max(200),
  url: z.string().max(4000),
  method: z.string().max(20),
  status: z.number().finite().optional(),
  mimeType: z.string().max(200).optional(),
  failed: z.boolean().optional(),
  errorText: z.string().max(2000).optional(),
  timestamp: z.number().finite(),
});

const resourcesResponseSchema = z.object({
  resources: z.array(observedResourceSchema).max(MAX_RESOURCES_ACCEPTED),
});

const resourceBodyResponseSchema = z.object({
  found: z.boolean(),
  body: z.string().max(MAX_BODY_CHARS_ACCEPTED).optional(),
  base64Encoded: z.boolean().optional(),
});

/** Result of validating an untrusted external response. */
type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

function validate<T>(schema: z.ZodType<T>, data: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.issues[0]?.message ?? "invalid shape",
    };
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
      const outcome = await sendWithRetryDetailed(this.config.extensionId, {
        type: "apty-debug-agent:get-service-worker-status",
      });
      if (!outcome.ok) {
        return {
          status: "unavailable",
          peerFailure: outcome.failure,
          error: outcome.detail
            ? `${PEER_FAILURE_MESSAGES[outcome.failure]} (Chrome: ${outcome.detail})`
            : PEER_FAILURE_MESSAGES[outcome.failure],
        };
      }

      const result = validate(statusResponseSchema, outcome.response);
      if (!result.ok) {
        return {
          status: "error",
          peerFailure: "malformed_response",
          error: `The Apty Client answered with an unexpected shape (${result.reason}). Its bridge module is likely out of date.`,
        };
      }
      return {
        status: "ok",
        running: result.value.running,
        lastActivity: result.value.lastActivity,
      };
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
        return {
          status: "error",
          error: "diagnostic endpoint returned invalid JSON",
        };
      }

      const result = validate(statusResponseSchema, body);
      if (!result.ok) {
        return {
          status: "error",
          error: `malformed status response: ${result.reason}`,
        };
      }
      return {
        status: "ok",
        running: result.value.running,
        lastActivity: result.value.lastActivity,
      };
    }

    return { status: "not_configured" };
  }

  async getLogs(): Promise<AptyLog[]> {
    if (this.config.extensionId) {
      const raw = await sendExternalMessageWithRetry(this.config.extensionId, {
        type: "apty-debug-agent:get-service-worker-logs",
      });
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

  async listResources(): Promise<{
    ok: boolean;
    resources: AptyObservedResource[];
    error?: string;
  }> {
    if (!this.config.extensionId) {
      return {
        ok: false,
        resources: [],
        error:
          "No Apty Client extension ID is configured for resource inspection.",
      };
    }

    const raw = await sendExternalMessageWithRetry(this.config.extensionId, {
      type: "apty-debug-agent:list-observed-resources",
    });
    if (raw === undefined) {
      return {
        ok: false,
        resources: [],
        error:
          "The Apty Client extension did not respond. It may not be installed, may not allowlist this extension (externally_connectable), or may not implement the resource-inspection message contract yet.",
      };
    }

    const result = validate(resourcesResponseSchema, raw);
    if (!result.ok) {
      return {
        ok: false,
        resources: [],
        error: `malformed resources response: ${result.reason}`,
      };
    }
    return { ok: true, resources: result.value.resources };
  }

  async getResourceBody(requestId: string): Promise<AptyResourceBody> {
    if (!this.config.extensionId) {
      return { found: false };
    }

    const raw = await sendExternalMessageWithRetry(this.config.extensionId, {
      type: "apty-debug-agent:get-resource-body",
      requestId,
    });
    if (raw === undefined) return { found: false };

    const result = validate(resourceBodyResponseSchema, raw);
    if (!result.ok) return { found: false };

    return {
      found: result.value.found,
      body:
        result.value.body !== undefined
          ? redactSensitiveText(result.value.body)
          : undefined,
      base64Encoded: result.value.base64Encoded,
    };
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
  async listResources(): Promise<{
    ok: boolean;
    resources: AptyObservedResource[];
    error?: string;
  }> {
    return {
      ok: false,
      resources: [],
      error: "No Apty Client extension ID is configured.",
    };
  }
  async getResourceBody(): Promise<AptyResourceBody> {
    return { found: false };
  }
}
