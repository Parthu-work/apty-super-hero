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
  diagnoseContentNotVisible,
  filesFor,
} from "../apty/diagnosis/content-not-visible.js";
import { loadClientEvidence } from "../apty/diagnosis/loader.js";
import { RUN_DIAGNOSIS } from "../apty/diagnosis/responder.js";
import { type ContentKind, KINDS } from "../apty/diagnosis/types.js";
import { recordToolCall } from "../apty/index.js";
import type { ToolRunContext } from "./tab-utils";

const KIND_NAMES = Object.keys(KINDS) as [ContentKind, ...ContentKind[]];

export const runDiagnosisTool = tool({
  name: "run_diagnosis",
  description:
    "Find why Apty content is not visible in the widget, from the Apty Client's own files: whether it is published in this environment, hidden from the widget, nameless, in a segment that cannot match, or outside the widget's audience. Deterministic and read-only; each finding cites its KB card. Without a name it lists every item of the kind with the blockers the files show. Call this before other diagnostics for a 'not visible' question.",
  parameters: z.object({
    kind: z.enum(KIND_NAMES).describe("The kind of content that is missing."),
    name: z
      .string()
      .optional()
      .describe("The item's name or sourceId, when the user gave one."),
  }),
  execute: async ({ kind, name }, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    recordToolCall(conversationId, RUN_DIAGNOSIS, { kind });
    const config = await getAptyIntegrationConfig();
    const evidence = await loadClientEvidence(
      config.clientExtensionId,
      filesFor(kind),
    );
    return diagnoseContentNotVisible(evidence, kind, name);
  },
});

export const diagnosisTools = [runDiagnosisTool];
