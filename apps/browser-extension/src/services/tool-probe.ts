/**
 * Tool-calling probe for Test Connection: the agent only works with models
 * that call functions, so after the basic check one more minimal request
 * offers a single trivial tool and asks the model to call it. The tool is
 * never executed.
 */
import { generateText, jsonSchema, type LanguageModel, tool } from "ai";

export type ToolCallingSupport = "yes" | "no" | "unknown";

/** @internal */
export const PROBE_TOOL_NAME = "report_probe";
const PROBE_TIMEOUT_MS = 15_000;

const UNSUPPORTED_PATTERN =
  /\b(tools?|function[ _-]?call(ing)?|tool[ _-]?choice)\b.*\b(not|un)\s*supported|does not support (tools|function)|tool use is not supported|no endpoints found that support tool/i;

export type ProbeAttempt =
  | { kind: "answered"; toolNames: string[] }
  | { kind: "failed"; status?: number; message: string; timedOut: boolean };

/**
 * What one attempt says about tool support; `null` when it says nothing (retry, then "unknown").
 * @internal
 */
export function classifyProbeAttempt(
  attempt: ProbeAttempt,
): ToolCallingSupport | null {
  if (attempt.kind === "answered") {
    return attempt.toolNames.includes(PROBE_TOOL_NAME) ? "yes" : "no";
  }
  if (attempt.timedOut) return null;
  if (
    (attempt.status === 400 ||
      attempt.status === 404 ||
      attempt.status === 422) &&
    UNSUPPORTED_PATTERN.test(attempt.message)
  ) {
    return "no";
  }
  return null;
}

async function attemptProbe(model: LanguageModel): Promise<ProbeAttempt> {
  try {
    const result = await generateText({
      model,
      prompt: `Call the ${PROBE_TOOL_NAME} tool with value "ok". Do not answer in text.`,
      tools: {
        [PROBE_TOOL_NAME]: tool({
          description: "Reports that tool calling works.",
          inputSchema: jsonSchema<{ value: string }>({
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          }),
        }),
      },
      timeout: PROBE_TIMEOUT_MS,
      maxRetries: 0,
    });
    return {
      kind: "answered",
      toolNames: result.toolCalls.map((call) => call.toolName),
    };
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError");
    return {
      kind: "failed",
      status: (error as { statusCode?: number } | undefined)?.statusCode,
      message: error instanceof Error ? error.message : String(error),
      timedOut,
    };
  }
}

/** "yes", "no", or "unknown" after one retry of an attempt that said nothing. */
export async function probeToolCalling(
  model: LanguageModel,
  attempt: (model: LanguageModel) => Promise<ProbeAttempt> = attemptProbe,
): Promise<ToolCallingSupport> {
  for (let i = 0; i < 2; i++) {
    const verdict = classifyProbeAttempt(await attempt(model));
    if (verdict) return verdict;
  }
  return "unknown";
}
