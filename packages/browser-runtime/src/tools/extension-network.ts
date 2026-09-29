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
    "Retrieve the actual response body for a resource the Apty Client extension reports having requested itself — e.g. resourceQuery 'segments.json', 'app.json', 'flow.json', a path like '/api/segments.json', or a fragment like 'segments'. " +
    "Not hardcoded to any resource name — matches whatever the Apty Client actually reports (exact filename > path suffix > substring fragment, most-recent match wins ties). " +
    "Auto-connects using the configured Apty Client extension ID if not already connected (this tool never accepts an extension ID as input). " +
    "Returns status: 'not_observed' if the Apty Client didn't report a matching request (ask the user to reproduce the action, or reload the Apty Client, then try again), 'failed'/'http_error' if the request failed, 'pending' if seen but no response yet, or 'body_unavailable' if the Apty Client couldn't provide the body. Never returns fabricated data.",
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
    "Get console messages, warnings, and errors the Apty Client extension's Service Worker reports about itself — e.g. 'show me errors from the Apty Client Service Worker'. " +
    "Auto-connects using the configured Apty Client extension ID if not already connected (this tool never accepts an extension ID as input). " +
    "Depends entirely on what the Apty Client itself has recorded and is willing to report — if it only keeps a bounded recent history, older entries may no longer be available; that is the Apty Client's limitation, not fabricated data on this side. " +
    "Set onlyErrors to true to see just warning/error-level entries.",
  parameters: z.object({
    onlyErrors: z
      .boolean()
      .default(false)
      .describe(
        "If true, only return exceptions and warning/error-level log entries.",
      ),
  }),
  execute: async ({ onlyErrors }, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    recordToolCall(conversationId, "get_extension_service_worker_logs", {
      onlyErrors,
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

    return listServiceWorkerLogs(conversationId, { onlyErrors });
  },
});

export const extensionNetworkTools = [
  connectAptyClientTool,
  disconnectAptyClientTool,
  getAptyClientConnectionStatusTool,
  inspectExtensionNetworkTool,
  listExtensionNetworkResourcesTool,
  getExtensionServiceWorkerLogsTool,
];
