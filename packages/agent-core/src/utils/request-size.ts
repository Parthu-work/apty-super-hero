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

/** One image as providers bill it, about 1,600 tokens for a screenshot at most (an estimate). */
const IMAGE_TOKENS = 1_600;

const isImagePart = (part: unknown) => {
  const type = (part as { type?: unknown } | null)?.type;
  return type === "input_image" || type === "image";
};

/**
 * Estimated tokens of a request as sent: characters / 4 of the instructions,
 * the tool schemas and each item's content, arguments or output, and each
 * image at a fixed estimate: the rule the request budget counts by.
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
  let images = 0;
  for (const item of request.input) {
    const content = (item as { content?: unknown }).content;
    if (Array.isArray(content) && content.some(isImagePart)) {
      images += content.filter(isImagePart).length;
      chars += textOf(content.filter((p) => !isImagePart(p))).length;
      continue;
    }
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
  return Math.ceil(chars / 4) + images * IMAGE_TOKENS;
}
