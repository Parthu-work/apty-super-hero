/**
 * The model's way into the check packs, for wording the router does not
 * recognise. It runs the same deterministic check the chat runs without a
 * model, and reads the Apty Client's files only from the extension ID saved
 * in Options: it takes no ID from the model.
 */
import { tool } from "@apty/agent-core";
import { z } from "zod";
import { getAptyIntegrationConfig } from "../apty/config.js";
import {
  RUN_DIAGNOSIS,
  runPack,
  tabUrlOf,
} from "../apty/diagnosis/responder.js";
import { type ContentKind, KINDS } from "../apty/diagnosis/types.js";
import { tabElementProbeOf } from "../apty/element-probe.js";
import { recordToolCall } from "../apty/index.js";
import { tabConsoleOf } from "./apty.js";
import { tabDomHealthOf } from "./dom-health.js";
import type { ToolRunContext } from "./tab-utils";

const KIND_NAMES: [
  ContentKind | "widget" | "logs" | "page",
  ...Array<ContentKind | "logs" | "page">,
] = ["widget", "logs", "page", ...(Object.keys(KINDS) as ContentKind[])];

/** @internal */
export const runDiagnosisTool = tool({
  name: "run_diagnosis",
  description:
    "Find why Apty content, or the widget itself (kind 'widget'), is not visible, or read the errors in the Apty Client's logs and calls and the page's console (kind 'logs'), from the Apty Client's own files: whether it is published in this environment, hidden from the widget, nameless or unnamed in the user's language, in a segment that cannot match, outside the widget's audience, or on a page no environment's URL pattern covers. With problem 'element-not-found' it runs a tooltip's, launcher's, validation's or workflow step's stored selector in every frame of the page the way the player does (no match, several, hidden, only in a frame or a shadow root, a generated value); kind 'page' reads DOM Health's audit of the page for what stops element selection there. Deterministic and read-only; each finding cites its KB card. Without a name it lists every item of the kind with the blockers the files show. Call this before other diagnostics for a 'not visible' or 'element not found' question.",
  parameters: z.object({
    kind: z
      .enum(KIND_NAMES)
      .describe(
        "The kind of content that is missing, 'widget' for the widget itself, or 'logs' for the errors in the logs and the page's console.",
      ),
    name: z
      .string()
      .optional()
      .describe("The item's name or sourceId, when the user gave one."),
    problem: z
      .enum(["not-visible", "element-not-found"])
      .optional()
      .describe(
        "'element-not-found' when Apty cannot find the item's element, or shows it on the wrong one; default 'not-visible'.",
      ),
    step: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "The workflow step that fails, 1-based, when the user named one.",
      ),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional()
      .describe(
        "The users' language as a two-letter code, when the problem is one language.",
      ),
  }),
  execute: async ({ kind, name, language, problem, step }, context) => {
    const runContext = (context as ToolRunContext)?.context;
    recordToolCall(runContext?.conversationId, RUN_DIAGNOSIS, { kind });
    const config = await getAptyIntegrationConfig();
    return runPack(
      kind === "widget"
        ? { packId: "widget-not-visible" }
        : kind === "logs"
          ? { packId: "logs-and-errors" }
          : kind === "page"
            ? { packId: "page-readiness" }
            : problem === "element-not-found"
              ? {
                  packId: "element-not-found",
                  kind,
                  ...(name ? { query: name } : {}),
                  ...(step ? { step } : {}),
                }
              : {
                  packId: "content-not-visible",
                  kind,
                  ...(name ? { query: name } : {}),
                  ...(language ? { language } : {}),
                },
      config.clientExtensionId,
      {
        pageUrl: () => tabUrlOf(runContext),
        pageConsole: () => tabConsoleOf(runContext),
        probeElement: tabElementProbeOf(runContext),
        domHealth: () => tabDomHealthOf(runContext),
      },
    );
  },
});

export const diagnosisTools = [runDiagnosisTool];
