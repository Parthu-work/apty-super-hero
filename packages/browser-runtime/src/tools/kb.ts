/**
 * The model's way into the KB pack (KB-RAG K4). It searches only the pack
 * imported in Options: the model cannot name a pack, a URL or a page to
 * fetch, and nothing leaves the browser but the result.
 */
import { tool } from "@apty/agent-core";
import { z } from "zod";
import { tabUrlOf } from "../apty/diagnosis/responder.js";
import {
  kbToolResult,
  packUnusableResult,
  sharedKbIndexSource,
  unusablePackOf,
} from "../kb/kb-index.js";
import { kbVersionForUrl } from "../kb/kb-version.js";
import type { ToolRunContext } from "./tab-utils.js";

/** @internal */
export const searchKbTool = tool({
  name: "search_kb",
  description:
    "Searches the loaded KB packs of Apty RAG Answer Cards for the settings, page checks, data or support contacts behind a finding or symptom. Each result is a card chunk with its cite id (kb://<pageId>#L<layer>), Apty version, 'Verified on' line and notVerified mark; mixedVersions: the top cards are for different versions. status: 'ok'; 'not_covered' with reason no_match (no card word matched), low_coverage (the best card covers too little of the question), no_strong_term (only words most cards share matched) or unknown_setting (missingPhrases: settings no card has); 'stub' (a card whose text is not written yet); 'no_pack'; 'not_in_version' (absent: the feature has no equivalent in that Apty version, with absentReason and its link; results, if any, are other versions' cards); 'pack_unusable' (the version's pack is loaded but not used: expired, unsigned, untrusted or revoked; say so and ask for a new pack).",
  parameters: z.object({
    query: z
      .string()
      .min(1)
      .max(300)
      .describe(
        "The symptom or finding in the user's words, in English, at most 300 characters.",
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
      .describe("The tenant's Apty version, only when the user said it."),
  }),
  execute: async ({ query, topK, layers, aptyVersion }, context) => {
    const version =
      aptyVersion ??
      kbVersionForUrl(
        await tabUrlOf((context as ToolRunContext | undefined)?.context),
      );
    const source = sharedKbIndexSource();
    const index = await source.current(version);
    if (!index) {
      const unusable = unusablePackOf((await source.unusable?.(version)) ?? []);
      if (unusable) return packUnusableResult(unusable);
    }
    return kbToolResult(index, query, {
      topK: topK ?? 3,
      ...(layers ? { layers } : {}),
    });
  },
});

export const kbTools = [searchKbTool];
