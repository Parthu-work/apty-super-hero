import type { AgentInputItem } from "@openai/agents";

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * Estimated tokens of a request as sent: characters / 4 of the instructions,
 * the tool schemas and each item's content, arguments or output, the rule
 * the request budget and the request-size report count by.
 */
export function estimateRequestTokens(request: {
  instructions?: string;
  tools: ReadonlyArray<{
    name: string;
    description?: string;
    parameters?: unknown;
  }>;
  input: readonly AgentInputItem[];
}): number {
  let chars = request.instructions?.length ?? 0;
  for (const tool of request.tools) {
    chars += JSON.stringify({
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.parameters ?? {},
    }).length;
  }
  for (const item of request.input) {
    const part = item as {
      type?: string;
      content?: unknown;
      arguments?: unknown;
      output?: unknown;
    };
    chars += textOf(
      part.type === "function_call_result"
        ? part.output
        : part.type === "function_call"
          ? part.arguments
          : part.content,
    ).length;
  }
  return Math.ceil(chars / 4);
}
