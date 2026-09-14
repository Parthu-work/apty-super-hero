/**
 * Apty Client Service Worker network inspection tools (V1).
 *
 * Resource-agnostic by design: `resourceQuery` is whatever string the model
 * decides identifies the resource the user asked about (a filename, a path,
 * a URL fragment) — there is no fixed list of known Apty resources anywhere
 * in this file or in `../apty/extension-network-inspector.ts`. The model
 * decides *what* it's looking for; the browser runtime deterministically
 * decides *which observed request* actually matches (see `matchResources`).
 *
 * `inspect_extension_network` auto-connects using `extensionId` (or the
 * configured `clientExtensionId`, see `../apty/config.ts`) if no connection
 * is active yet, so the primary chat flow ("Get segments.json") doesn't
 * force an explicit connect step. `connect_apty_client` /
 * `disconnect_apty_client` remain available for the explicit
 * "Use Apty Client extension: <id>" / Options-panel flow.
 */
import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";
import {
  connectExtensionClient,
  disconnectExtensionClient,
  getExtensionConnectionStatus,
  inspectResource,
  listObservedResources,
} from "../apty/extension-network-inspector.js";
import { getAptyIntegrationConfig, recordToolCall } from "../apty/index.js";
import type { ToolRunContext } from "./tab-utils";

async function resolveExtensionId(
  provided: string | undefined,
): Promise<string | undefined> {
  if (provided) return provided;
  const config = await getAptyIntegrationConfig();
  return config.clientExtensionId;
}

export const connectAptyClientTool = tool({
  name: "connect_apty_client",
  description:
    "Connect to the Apty Client extension's Service Worker to begin observing its Network activity — attaches the Chrome debugger and enables Network capture. " +
    "Call this before inspect_extension_network / list_extension_network_resources unless a connection is already active (idempotent if already connected to the same extension). " +
    "extensionId is optional — if omitted, uses the configured Apty Client extension ID (see the Apty Client connection settings). " +
    "IMPORTANT: only traffic that occurs AFTER this call is observed — anything the Service Worker already fetched before connecting is invisible.",
  parameters: z.object({
    extensionId: z
      .string()
      .optional()
      .describe(
        "The Apty Client Chrome extension ID (32 lowercase a-p characters). Omit to use the configured default.",
      ),
  }),
  execute: async ({ extensionId }, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    recordToolCall(conversationId, "connect_apty_client", { extensionId });

    const id = await resolveExtensionId(extensionId);
    if (!id) {
      return {
        connected: false,
        error:
          "No Apty Client extension ID was provided and none is configured. Provide an extension ID or configure one in the Apty Client connection settings.",
      };
    }
    return connectExtensionClient(conversationId, id);
  },
});

export const disconnectAptyClientTool = tool({
  name: "disconnect_apty_client",
  description:
    "Disconnect from the Apty Client extension's Service Worker, stop Network capture, and detach the debugger. " +
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
    "Check whether this conversation is currently connected to an Apty Client extension Service Worker, and how many network resources have been observed so far.",
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
    "Retrieve the actual Network response body for a resource observed on the Apty Client extension's Service Worker — e.g. resourceQuery 'segments.json', 'app.json', 'flow.json', a path like '/api/segments.json', or a fragment like 'segments'. " +
    "Not hardcoded to any resource name — matches whatever was actually observed (exact filename > path suffix > substring fragment, most-recent match wins ties). " +
    "Auto-connects using extensionId (or the configured Apty Client extension ID) if not already connected. " +
    "Returns status: 'not_observed' if the resource hasn't been seen since connecting (capture is not retroactive — ask the user to reproduce the action, or reload the Apty Client, then try again), 'failed'/'http_error' if the request failed, 'pending' if seen but no response yet, or 'body_unavailable' if Chrome couldn't return the body. Never returns fabricated data.",
  parameters: z.object({
    resourceQuery: z
      .string()
      .min(1)
      .describe(
        "The resource to look for: a filename (segments.json), a path (/api/segments.json), or a fragment (segments).",
      ),
    extensionId: z
      .string()
      .optional()
      .describe(
        "The Apty Client Chrome extension ID. Omit to use the configured default or an already-active connection.",
      ),
  }),
  execute: async ({ resourceQuery, extensionId }, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    recordToolCall(conversationId, "inspect_extension_network", {
      resourceQuery,
      extensionId,
    });

    if (!getExtensionConnectionStatus(conversationId).connected) {
      const id = await resolveExtensionId(extensionId);
      if (!id) {
        return {
          found: false,
          status: "not_connected",
          resourceQuery,
          error:
            "Not connected to an Apty Client extension and no extension ID was provided or configured.",
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
    "List every network resource observed so far on the Apty Client extension's Service Worker since connecting — useful to answer 'what resources did the Apty Client load?' before picking one to inspect with inspect_extension_network. " +
    "Auto-connects using extensionId (or the configured Apty Client extension ID) if not already connected.",
  parameters: z.object({
    extensionId: z
      .string()
      .optional()
      .describe(
        "The Apty Client Chrome extension ID. Omit to use the configured default or an already-active connection.",
      ),
  }),
  execute: async ({ extensionId }, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    recordToolCall(conversationId, "list_extension_network_resources", {
      extensionId,
    });

    if (!getExtensionConnectionStatus(conversationId).connected) {
      const id = await resolveExtensionId(extensionId);
      if (!id) {
        return {
          connected: false,
          error:
            "Not connected to an Apty Client extension and no extension ID was provided or configured.",
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

export const extensionNetworkTools = [
  connectAptyClientTool,
  disconnectAptyClientTool,
  getAptyClientConnectionStatusTool,
  inspectExtensionNetworkTool,
  listExtensionNetworkResourcesTool,
];
