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
  ContentKind | "widget" | "logs" | "page" | "dapty",
  ...Array<ContentKind | "logs" | "page" | "dapty">,
] = [
  "widget",
  "logs",
  "page",
  "dapty",
  ...(Object.keys(KINDS) as ContentKind[]),
];

/** @internal */
export const runDiagnosisTool = tool({
  name: "run_diagnosis",
  description:
    "Runs Apty's read-only checks on the Apty Client's files and the page; each finding cites its KB card. kind 'widget': why the widget is not visible; 'logs': errors in the Client's logs and calls and the page console; 'page': what stops element selection on the page (DOM Health); 'dapty': what the widget's Ask Dapty chat answered, whether its call got through and whether each item it suggested would open. A content kind: why that item is not visible (unpublished, hidden, unnamed in the user's language, an unmatchable segment, outside the widget's audience, no environment for the page), or with problem 'element-not-found', its stored selector run in every frame the way the player does. Without a name it lists every item of the kind with its blockers. Call it before other diagnostics for a 'not visible' or 'element not found' question.",
  parameters: z.object({
    kind: z
      .enum(KIND_NAMES)
      .describe(
        "What is missing: a content kind, 'widget', 'logs', 'page' or 'dapty'.",
      ),
    name: z
      .string()
      .optional()
      .describe("The item's name or sourceId, if given."),
    problem: z
      .enum(["not-visible", "element-not-found"])
      .optional()
      .describe(
        "'element-not-found' when Apty cannot find its element or uses the wrong one; default 'not-visible'.",
      ),
    step: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "The failing workflow step, a whole number, 1 or more, if named.",
      ),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional()
      .describe(
        "The users' language, two lowercase letters ('fr'), if one language.",
      ),
  }),
  execute: async ({ kind, name, language, problem, step }, context) => {
    const runContext = (context as ToolRunContext)?.context;
    recordToolCall(runContext?.conversationId, RUN_DIAGNOSIS, { kind });
    const config = await getAptyIntegrationConfig();
    return runPack(
      kind === "dapty"
        ? { packId: "dapty-conversation" }
        : kind === "widget"
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
