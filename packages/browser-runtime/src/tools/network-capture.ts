/**
 * Investigation-aware network capture tools.
 *
 * `get_network_diagnostics` (devtools.ts) is a fixed-window capture: attach,
 * wait 500ms-15s, detach. That's fine for a request that fires the instant
 * a button is clicked, but it misses anything triggered by a slower,
 * multi-step reproduction (navigate, wait for a workflow step, then click).
 * These three tools implement the alternative flow from the master
 * prompt's network-investigation section: start a capture, let the user
 * reproduce the issue across as many turns as it takes, then stop and get
 * everything that happened in between — see
 * `../apty/network-capture-session.ts` for the session mechanics.
 */
import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";
import {
  getNetworkCaptureStatus,
  startNetworkCapture,
  stopNetworkCapture,
} from "../apty/network-capture-session.js";
import { resolveDiagnosticTab, type ToolRunContext } from "./tab-utils";

export const startNetworkCaptureTool = tool({
  name: "start_network_capture",
  description:
    "Start capturing network requests on the current tab in the background — unlike get_network_diagnostics, this does not block on a fixed time window. Call this right before asking the user to reproduce the issue (or before you perform the reproducing action yourself), then continue the investigation normally; call stop_network_capture whenever you're ready to see what happened. " +
    "If an investigation is active (start_investigation), the capture is tagged with it so any failed requests found are traceable back to it. " +
    "Only one capture can run per conversation at a time — call stop_network_capture (or get_network_capture_status) if one may already be running.",
  parameters: z.object({}),
  execute: async (_input, context) => {
    const tab = await resolveDiagnosticTab(context as ToolRunContext);
    if (!tab.id) {
      return { started: false, error: "No active tab found" };
    }
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    return startNetworkCapture(conversationId, tab.id);
  },
});

export const stopNetworkCaptureTool = tool({
  name: "stop_network_capture",
  description:
    "Stop the network capture started by start_network_capture and return every request seen while it was running — correlated request/response pairs, status codes, resource types, and failures. Failed/4xx/5xx requests are also recorded as investigation evidence (see get_investigation_timeline). " +
    "Returns an error if no capture is currently running for this conversation.",
  parameters: z.object({
    onlyErrors: z
      .boolean()
      .default(false)
      .describe(
        "If true, only return failed requests or responses with status >= 400",
      ),
  }),
  execute: async ({ onlyErrors }, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    const result = await stopNetworkCapture(conversationId, { onlyErrors });
    if (!result.stopped) {
      return result;
    }
    return {
      stopped: true,
      session: result.session,
      count: result.requests?.length ?? 0,
      requests: result.requests,
    };
  },
});

export const getNetworkCaptureStatusTool = tool({
  name: "get_network_capture_status",
  description:
    "Check whether a network capture (start_network_capture) is currently running for this conversation, and how many requests it has seen so far, without stopping it.",
  parameters: z.object({}),
  execute: async (_input, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    const session = getNetworkCaptureStatus(conversationId);
    if (!session) {
      return { active: false };
    }
    return { active: true, session };
  },
});

export const networkCaptureTools = [
  startNetworkCaptureTool,
  stopNetworkCaptureTool,
  getNetworkCaptureStatusTool,
];
