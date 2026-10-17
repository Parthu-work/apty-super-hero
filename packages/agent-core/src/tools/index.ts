import { tool as sdkTool } from "@openai/agents";

type SchemaNode = Record<string, unknown>;

/**
 * Strict schemas turn an optional field into `{description, anyOf: [{...,
 * description}, {type: "null"}]}`; the inner copy of the description is
 * sent with every request and tells the model nothing new.
 */
function withoutRepeatedDescriptions(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) withoutRepeatedDescriptions(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  const schema = node as SchemaNode;
  if (typeof schema.description === "string" && Array.isArray(schema.anyOf)) {
    for (const variant of schema.anyOf as SchemaNode[]) {
      if (variant?.description === schema.description)
        delete variant.description;
    }
  }
  for (const value of Object.values(schema)) withoutRepeatedDescriptions(value);
}

/**
 * The SDK's `tool`, reporting a failed run to the model with the error's
 * message, as @openai/agents 0.7 did (0.20 sends a generic sentence). Tools
 * rely on it to say why they refused (for example "disabled in background
 * mode"), and the result still passes through the outbound filters.
 */
export const tool = ((options: Parameters<typeof sdkTool>[0]) => {
  const created = sdkTool({
    errorFunction: (_context, error) =>
      `An error occurred while running the tool. Please try again. Error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ...options,
  } as Parameters<typeof sdkTool>[0]);
  if ("parameters" in created) withoutRepeatedDescriptions(created.parameters);
  return created;
}) as typeof sdkTool;
