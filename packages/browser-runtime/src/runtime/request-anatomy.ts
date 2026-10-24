/**
 * Size of one model request, split into the parts that make it up. Pure
 * counting: no content is kept, only character-derived token estimates
 * (characters / 4, the same rule everywhere so numbers stay comparable).
 */

export const CHARS_PER_TOKEN = 4;

/** @internal */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface MeasurableTool {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface MeasurableItem {
  name?: string;
  callId?: string;
  type?: string;
  role?: string;
  content?: unknown;
  arguments?: unknown;
  output?: unknown;
}

export interface RequestAnatomy {
  systemPromptTokens: number;
  toolCount: number;
  toolSchemaTokens: number;
  historyTokens: number;
  toolResultTokens: number;
  totalTokens: number;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/** @internal */
export function toolSchemaTokens(tools: readonly MeasurableTool[]): number {
  return tools.reduce(
    (sum, t) =>
      sum +
      estimateTokens(
        JSON.stringify({
          name: t.name,
          description: t.description ?? "",
          parameters: t.parameters ?? {},
        }),
      ),
    0,
  );
}

export function measureRequest(request: {
  instructions: string;
  tools: readonly MeasurableTool[];
  input: readonly MeasurableItem[];
}): RequestAnatomy {
  let historyTokens = 0;
  let toolResultTokens = 0;
  for (const item of request.input) {
    if (item.type === "function_call_result") {
      toolResultTokens += estimateTokens(textOf(item.output));
    } else if (item.type === "function_call") {
      historyTokens += estimateTokens(textOf(item.arguments));
    } else {
      historyTokens += estimateTokens(textOf(item.content));
    }
  }
  const systemPromptTokens = estimateTokens(request.instructions);
  const schemaTokens = toolSchemaTokens(request.tools);
  return {
    systemPromptTokens,
    toolCount: request.tools.length,
    toolSchemaTokens: schemaTokens,
    historyTokens,
    toolResultTokens,
    totalTokens:
      systemPromptTokens + schemaTokens + historyTokens + toolResultTokens,
  };
}
