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
import { recordToolCall } from "../apty/index.js";
import type { ToolRunContext } from "./tab-utils";

const KIND_NAMES: [ContentKind | "widget", ...ContentKind[]] = [
  "widget",
  ...(Object.keys(KINDS) as ContentKind[]),
];

/** @internal */
export const runDiagnosisTool = tool({
  name: "run_diagnosis",
  description:
    "Find why Apty content, or the widget itself (kind 'widget'), is not visible, from the Apty Client's own files: whether it is published in this environment, hidden from the widget, nameless or unnamed in the user's language, in a segment that cannot match, outside the widget's audience, or on a page no environment's URL pattern covers. Deterministic and read-only; each finding cites its KB card. Without a name it lists every item of the kind with the blockers the files show. Call this before other diagnostics for a 'not visible' question.",
  parameters: z.object({
    kind: z
      .enum(KIND_NAMES)
      .describe(
        "The kind of content that is missing, or 'widget' for the widget itself.",
      ),
    name: z
      .string()
      .optional()
      .describe("The item's name or sourceId, when the user gave one."),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional()
      .describe(
        "The users' language as a two-letter code, when the problem is one language.",
      ),
  }),
  execute: async ({ kind, name, language }, context) => {
    const runContext = (context as ToolRunContext)?.context;
    recordToolCall(runContext?.conversationId, RUN_DIAGNOSIS, { kind });
    const config = await getAptyIntegrationConfig();
    return runPack(
      kind === "widget"
        ? { packId: "widget-not-visible" }
        : {
            packId: "content-not-visible",
            kind,
            ...(name ? { query: name } : {}),
            ...(language ? { language } : {}),
          },
      config.clientExtensionId,
      () => tabUrlOf(runContext),
    );
  },
});

export const diagnosisTools = [runDiagnosisTool];
