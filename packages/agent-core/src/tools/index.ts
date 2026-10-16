import { tool as sdkTool } from "@openai/agents";

/**
 * The SDK's `tool`, reporting a failed run to the model with the error's
 * message, as @openai/agents 0.7 did (0.20 sends a generic sentence). Tools
 * rely on it to say why they refused (for example "disabled in background
 * mode"), and the result still passes through the outbound filters.
 */
export const tool = ((options: Parameters<typeof sdkTool>[0]) =>
  sdkTool({
    errorFunction: (_context, error) =>
      `An error occurred while running the tool. Please try again. Error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ...options,
  } as Parameters<typeof sdkTool>[0])) as typeof sdkTool;
