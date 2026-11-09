/**
 * The model's way into the KB pack (KB-RAG K4). It searches only the pack
 * imported in Options: the model cannot name a pack, a URL or a page to
 * fetch, and nothing leaves the browser but the result.
 */
import { tool } from "@apty/agent-core";
import { z } from "zod";
import { tabUrlOf } from "../apty/diagnosis/responder.js";
import { kbToolResult, sharedKbIndexSource } from "../kb/kb-index.js";
import { kbVersionForUrl } from "../kb/kb-version.js";
import type { ToolRunContext } from "./tab-utils.js";

/** @internal */
export const searchKbTool = tool({
  name: "search_kb",
  description:
    "Searches the KB pack of Apty RAG Answer Cards loaded in this browser for the settings, page checks, data to read or support contacts behind a finding or symptom. Results are chunks of cards, each with a cite id (kb://<pageId>#L<layer>), its card's link, Apty version (4.x, 5.x or common), 'Verified on' line and a notVerified mark; mixedVersions true means the top cards are for different versions: ask which one the tenant runs and never merge them into one instruction. Answer Apty product questions only from these results and cite each claim with its cite id. status 'not_covered': the KB does not cover the question, with reason 'no_match' (no card matched), 'low_coverage' (the best card matches too little of it) or 'unknown_setting' (the question names a setting, listed in missingPhrases, that no card has: say so and do not suggest a similar one); 'stub': the KB has a card for this (stub: its title, link and Apty version) but its text is not written yet: say so and give the link, and do not answer from elsewhere; 'no_pack': no KB pack is loaded.",
  parameters: z.object({
    query: z
      .string()
      .min(1)
      .max(300)
      .describe(
        "The symptom or finding in the user's words, in English (the cards are English: translate a question asked in another language), at most 300 characters.",
      ),
    topK: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("How many chunks to return, 1 to 5; default 3."),
    layers: z
      .array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]))
      .max(4)
      .optional()
      .describe(
        "Only these card layers: 1 product settings, 2 Console and Elements, 3 network data, 4 contacting support.",
      ),
    aptyVersion: z
      .enum(["4.x", "5.x"])
      .optional()
      .describe(
        "The tenant's Apty version, only when the user said it; otherwise the tab's known version, or every loaded pack.",
      ),
  }),
  execute: async ({ query, topK, layers, aptyVersion }, context) => {
    const version =
      aptyVersion ??
      kbVersionForUrl(
        await tabUrlOf((context as ToolRunContext | undefined)?.context),
      );
    return kbToolResult(await sharedKbIndexSource().current(version), query, {
      topK: topK ?? 3,
      ...(layers ? { layers } : {}),
    });
  },
});

export const kbTools = [searchKbTool];
