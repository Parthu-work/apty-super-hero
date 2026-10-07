/**
 * Apty Client resource/log inspection tools (V1).
 *
 * Resource-agnostic by design: `resourceQuery` is whatever string the model
 * decides identifies the resource the user asked about (a filename, a path,
 * a URL fragment) — there is no fixed list of known Apty resources anywhere
 * in this file or in `../apty/extension-network-inspector.ts`. The model
 * decides *what* it's looking for; the browser runtime deterministically
 * decides *which reported resource* actually matches (see `matchResources`).
 *
 * TRANSPORT: these tools ask the Apty Client extension for its own data via
 * `chrome.runtime.sendMessage` cross-extension messaging — the only
 * mechanism Chrome allows for this (see
 * `../apty/extension-network-inspector.ts`'s header for why a
 * `chrome.debugger`-based design was tried first and found to be
 * impossible against real Chrome). This requires the Apty Client to
 * cooperate: allowlist this extension under `externally_connectable` and
 * implement the `apty-debug-agent:*` message contract. Without that
 * cooperation, connect_apty_client reports a clear, honest failure —
 * never a fabricated success.
 *
 * `inspect_extension_network` auto-connects using the configured
 * `clientExtensionId` (see `../apty/config.ts`) if no connection is active
 * yet, so the primary chat flow ("Get segments.json") doesn't force an
 * explicit connect step. `connect_apty_client` / `disconnect_apty_client`
 * remain available to trigger that connection explicitly.
 *
 * SECURITY: none of these tools accept an `extensionId` parameter. A page
 * the model is investigating can inject arbitrary text into a tool call's
 * arguments (prompt injection) — if the model could be steered into
 * supplying an extension ID, a hostile page could redirect this
 * cross-extension messaging at an attacker-controlled extension instead of
 * the user's actual Apty Client. The only extension ID ever contacted is
 * the one the user explicitly configured via the Options UI
 * (`clientExtensionId`); there is no code path from model input to which
 * extension gets messaged.
 */
import { tool } from "@apty/agent-core";
import { z } from "zod";
import { queryEvidenceJson } from "../apty/evidence-json-query.js";
import {
  connectExtensionClient,
  disconnectExtensionClient,
  getExtensionConnectionStatus,
  inspectResource,
  listObservedResources,
  listServiceWorkerLogs,
} from "../apty/extension-network-inspector.js";
import { getAptyIntegrationConfig, recordToolCall } from "../apty/index.js";
import type { ToolRunContext } from "./tab-utils";

const NOT_CONFIGURED_ERROR =
  "No Apty Client extension is configured. Configure its extension ID in the Apty Client connection settings (Options) — the model cannot supply one directly.";

async function resolveConfiguredExtensionId(): Promise<string | undefined> {
  const config = await getAptyIntegrationConfig();
  return config.clientExtensionId;
}

export const connectAptyClientTool = tool({
  name: "connect_apty_client",
  description:
    "Verify the Apty Client extension is installed and actually responds to Apty Agent's resource-inspection message contract, then remember it for this conversation. " +
    "Call this before inspect_extension_network / list_extension_network_resources unless a connection is already active (idempotent if already connected to the same extension). " +
    "Always connects to the extension ID configured in the Apty Client connection settings (Options) — this tool never accepts an extension ID as input. " +
    "If the extension is installed but does not respond (it hasn't implemented the message contract, or doesn't allowlist this extension under externally_connectable), this reports a clear failure rather than a false success.",
  parameters: z.object({}),
  execute: async (_input, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    recordToolCall(conversationId, "connect_apty_client");

    const id = await resolveConfiguredExtensionId();
    if (!id) {
      return {
        connected: false,
        error: NOT_CONFIGURED_ERROR,
      };
    }
    return connectExtensionClient(conversationId, id);
  },
});

export const disconnectAptyClientTool = tool({
  name: "disconnect_apty_client",
  description:
    "Forget this conversation's connected Apty Client extension (there is no persistent session to tear down — each request is independent). " +
    "Returns an error if no connection is currently active for this conversation.",
  parameters: z.object({}),
  execute: async (_input, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    recordToolCall(conversationId, "disconnect_apty_client");
    return disconnectExtensionClient(conversationId);
  },
});

export const getAptyClientConnectionStatusTool = tool({
  name: "get_apty_client_connection_status",
  description:
    "Check whether this conversation is currently connected to a cooperating Apty Client extension.",
  parameters: z.object({}),
  execute: async (_input, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    recordToolCall(conversationId, "get_apty_client_connection_status");
    return getExtensionConnectionStatus(conversationId);
  },
});

export const inspectExtensionNetworkTool = tool({
  name: "inspect_extension_network",
  description:
    "Retrieve the actual response body for a resource the Apty Client extension reports having requested itself — e.g. resourceQuery 'segments.json', 'app.json', a path, or a fragment. " +
    "Tolerant matching (case/plural/extension-insensitive); alsoMatched lists other candidates if several matched. Auto-connects using the configured extension ID (never accepts one as input). " +
    "Body returns for ANY status, including 4xx/5xx. A large JSON body comes back as a bounded summary (response.json) plus evidenceId — use get_evidence_json for more. " +
    "Status: not_observed (use returned suggestions), failed/http_error, pending, body_unavailable. Never fabricated.",
  parameters: z.object({
    resourceQuery: z
      .string()
      .min(1)
      .describe(
        "The resource to look for: a filename (segments.json), a path (/api/segments.json), or a fragment (segments).",
      ),
  }),
  execute: async ({ resourceQuery }, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    recordToolCall(conversationId, "inspect_extension_network", {
      resourceQuery,
    });

    if (!getExtensionConnectionStatus(conversationId).connected) {
      const id = await resolveConfiguredExtensionId();
      if (!id) {
        return {
          found: false,
          status: "not_connected",
          resourceQuery,
          error: NOT_CONFIGURED_ERROR,
        };
      }
      const connectResult = await connectExtensionClient(conversationId, id);
      if (!connectResult.connected) {
        return {
          found: false,
          status: "not_connected",
          resourceQuery,
          error: connectResult.error,
        };
      }
    }

    return inspectResource(conversationId, resourceQuery);
  },
});

export const listExtensionNetworkResourcesTool = tool({
  name: "list_extension_network_resources",
  description:
    "List every resource the Apty Client extension reports having requested itself — useful to answer 'what resources did the Apty Client load?' before picking one to inspect with inspect_extension_network. " +
    "Auto-connects using the configured Apty Client extension ID if not already connected (this tool never accepts an extension ID as input).",
  parameters: z.object({}),
  execute: async (_input, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    recordToolCall(conversationId, "list_extension_network_resources");

    if (!getExtensionConnectionStatus(conversationId).connected) {
      const id = await resolveConfiguredExtensionId();
      if (!id) {
        return {
          connected: false,
          error: NOT_CONFIGURED_ERROR,
        };
      }
      const connectResult = await connectExtensionClient(conversationId, id);
      if (!connectResult.connected) {
        return { connected: false, error: connectResult.error };
      }
    }

    return listObservedResources(conversationId);
  },
});

export const getExtensionServiceWorkerLogsTool = tool({
  name: "get_extension_service_worker_logs",
  description:
    "Get console messages, warnings, and errors the Apty Client extension's Service Worker reports about itself. Auto-connects (never accepts an extension ID as input). " +
    "Bounded output: capped to `limit` entries (default 50), consecutive identical lines collapsed (repeatCount), messages truncated to 500 chars (full:true to expand), plus a header with per-level counts. " +
    "onlyErrors (= minLevel:'warn') or minLevel for finer filtering.",
  parameters: z.object({
    onlyErrors: z
      .boolean()
      .default(false)
      .describe(
        "If true, only return exceptions and warning/error-level log entries. Equivalent to minLevel:'warn'.",
      ),
    minLevel: z
      .enum(["debug", "log", "info", "warn", "error"])
      .optional()
      .describe("Only return entries at or above this severity."),
    limit: z
      .number()
      .int()
      .positive()
      .max(500)
      .default(50)
      .describe("Max entries to return, most-recent-first."),
    full: z
      .boolean()
      .default(false)
      .describe(
        "If true, don't truncate individual log messages to 500 chars.",
      ),
  }),
  execute: async ({ onlyErrors, minLevel, limit, full }, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    recordToolCall(conversationId, "get_extension_service_worker_logs", {
      onlyErrors,
      minLevel,
      limit,
      full,
    });

    if (!getExtensionConnectionStatus(conversationId).connected) {
      const id = await resolveConfiguredExtensionId();
      if (!id) {
        return {
          connected: false,
          error: NOT_CONFIGURED_ERROR,
        };
      }
      const connectResult = await connectExtensionClient(conversationId, id);
      if (!connectResult.connected) {
        return { connected: false, error: connectResult.error };
      }
    }

    return listServiceWorkerLogs(conversationId, {
      onlyErrors,
      minLevel,
      limit,
      full,
    });
  },
});

export const getEvidenceJsonTool = tool({
  name: "get_evidence_json",
  description:
    "Query a previously-recorded JSON body (from inspect_extension_network's evidenceId) by path, without re-fetching. Use for follow-ups needing more than the initial bounded sample ('how many segments', 'show segment 20'). " +
    "path is dot/bracket ('items[3].name', or '' for root); limit/offset page an array (max 50). Returns found:false with a specific error if not resolvable — never fabricated.",
  parameters: z.object({
    evidenceId: z
      .string()
      .min(1)
      .describe(
        "The evidenceId from a prior inspect_extension_network result.",
      ),
    path: z
      .string()
      .default("")
      .describe(
        "Dot/bracket path into the JSON body, e.g. 'items[3].name'. Empty string means the root value.",
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(50)
      .default(20)
      .describe(
        "Max array elements to return when the resolved value is an array.",
      ),
    offset: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe("Starting index when the resolved value is an array."),
  }),
  execute: async ({ evidenceId, path, limit, offset }, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    recordToolCall(conversationId, "get_evidence_json", {
      evidenceId,
      path,
      limit,
      offset,
    });
    return queryEvidenceJson(conversationId, evidenceId, path, limit, offset);
  },
});

export const extensionNetworkTools = [
  connectAptyClientTool,
  disconnectAptyClientTool,
  getAptyClientConnectionStatusTool,
  inspectExtensionNetworkTool,
  listExtensionNetworkResourcesTool,
  getExtensionServiceWorkerLogsTool,
  getEvidenceJsonTool,
];
