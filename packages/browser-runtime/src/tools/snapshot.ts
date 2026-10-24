import { tool } from "@apty/agent-core";
import { z } from "zod";
import * as snapshotProvider from "../automation/snapshot-provider";

export const searchElementsTool = tool({
  name: "search_elements",
  description: `[FAST - USE FIRST] Search for elements in the current page using a query string with grep/glob pattern support. Returns all matching elements with their UIDs for direct interaction via click/fill_element_by_uid.

Example queries:
- Broad scan: '{button,link,input,StaticText}*'
- Find buttons: 'button*' or '*[Ss]ubmit*'
- Find inputs: '{input,textarea,select}*'
- Find by text: '*login*', '*search*'

This is the PREFERRED first step for page interaction - faster and more reliable than screenshots.`,
  parameters: z.object({
    tabId: z.number().describe("The ID of the tab to search the elements in"),
    query: z
      .string()
      .describe("Search query string with grep/glob pattern support"),
    contextLevels: z
      .number()
      .optional()
      .default(1)
      .describe("Number of context lines to include"),
  }),
  execute: async ({ tabId, query, contextLevels = 1 }) => {
    try {
      // Verify tab exists
      const tab = await chrome.tabs.get(tabId);
      if (!tab) {
        return {
          success: false,
          message: "No accessible tab found",
          data: "",
        };
      }

      const result = await snapshotProvider.searchAndFormat(
        tabId,
        query,
        contextLevels,
      );

      if (!result) {
        return {
          success: false,
          message: "Failed to search snapshot text",
          data: "",
        };
      }

      return {
        success: true,
        message: "Search completed successfully",
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        data: "",
      };
    }
  },
});
