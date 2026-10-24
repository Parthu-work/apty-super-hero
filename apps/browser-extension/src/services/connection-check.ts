/**
 * Test Connection, shared by Settings and the preflight page: one minimal
 * request to the configured model, then the tool-calling probe. Throws an
 * Error with a message safe to show (never the raw provider error).
 */
import type { AppSettings, ToolCallingSupport } from "@apty/agent-core";
import { generateText, type LanguageModel } from "ai";
import { createAIProvider, describeConnectionTestError } from "./ai-provider";
import { englishTranslate, type Translate } from "./model-list";
import { probeToolCalling } from "./tool-probe";

export const TEST_CONNECTION_TIMEOUT_MS = 20_000;

export interface ConnectionTestOutcome {
  /** How long the basic request took. */
  latencyMs: number;
  toolCalling: ToolCallingSupport;
}

export async function testConnection(
  settings: AppSettings,
  now: () => number = Date.now,
  t: Translate = englishTranslate,
): Promise<ConnectionTestOutcome> {
  const modelId = settings.aiModel;
  if (!modelId) {
    throw new Error(t("providerErrors.noModelSelected"));
  }

  const provider = createAIProvider(settings);
  const started = now();
  try {
    await generateText({
      model: provider(modelId) as LanguageModel,
      prompt: "Hi",
      // Without this, a request to an unreachable or misconfigured host
      // (e.g. a website URL typed into "AI Host" instead of an API
      // endpoint) can hang indefinitely with no error and no way for the
      // "Test connection" button to ever stop spinning. maxRetries: 0
      // so a test fails fast and clearly instead of silently retrying.
      timeout: TEST_CONNECTION_TIMEOUT_MS,
      maxRetries: 0,
    });
  } catch (error) {
    // Only a sanitized message leaves here, thrown or logged: some
    // providers' SDKs attach request/response bodies to the raw error.
    const isAbort =
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError");
    const message = isAbort
      ? t("providerErrors.connectionTimedOut", {
          seconds: TEST_CONNECTION_TIMEOUT_MS / 1000,
        })
      : describeConnectionTestError(error, t("providerErrors.workspaceIdFix"));

    console.error(`Connection test failed: ${message}`);
    throw new Error(message);
  }
  const latencyMs = now() - started;
  const toolCalling = await probeToolCalling(
    provider(modelId) as LanguageModel,
  );
  return { latencyMs, toolCalling };
}
