/**
 * AI Provider Factory
 * Creates AI SDK provider instances based on configuration.
 *
 * BYOK (Bring Your Own Key) only – the user (or Apty's backend, once wired
 * in) supplies a provider + API key. There is no third-party proxy fallback.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AIProviderKey, AppSettings } from "@apty/agent-core";
import {
  isIPv4,
  isPrivateIPv4,
  isPrivateIPv6,
} from "@apty/browser-runtime/vm/url-guard";

export interface ProviderConfig {
  provider: AIProviderKey;
  apiKey: string;
  baseURL?: string;
}

const CLOUD_METADATA_HOSTNAMES = new Set([
  "metadata.google.internal",
  "169.254.169.254",
]);

const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
]);

/**
 * Validate that a user-provided host URL is safe to use.
 * Rejects private/internal addresses to mitigate SSRF risks, with an
 * explicit loopback exception so local model servers (Ollama, LM Studio,
 * etc.) on localhost/127.0.0.1 keep working.
 *
 * IP-literal obfuscation (decimal, hex, octal, trailing-dot forms like
 * `2130706433` or `0x7f.0.0.1` for `127.0.0.1`) is handled by the WHATWG URL
 * parser itself: `new URL(...).hostname` is already normalized to
 * dotted-decimal/canonical form before we read it below.
 */
function validateHostUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid aiHost URL: ${url}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `Unsupported protocol in aiHost: ${parsed.protocol} (only http/https allowed)`,
    );
  }

  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");

  if (CLOUD_METADATA_HOSTNAMES.has(hostname)) {
    throw new Error(`aiHost points to a restricted address: ${hostname}`);
  }

  const isLoopback =
    LOOPBACK_HOSTNAMES.has(hostname) ||
    hostname === "::1" ||
    (isIPv4(hostname) && hostname.startsWith("127."));

  const isPrivate = isPrivateIPv4(hostname) || isPrivateIPv6(hostname);

  if (isPrivate && !isLoopback) {
    throw new Error(`aiHost points to a restricted address: ${hostname}`);
  }

  if (parsed.protocol !== "https:" && !isLoopback) {
    throw new Error(
      "Unsupported protocol in aiHost: http: (only https is allowed for non-loopback hosts)",
    );
  }

  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

/**
 * Turn a provider/model connection-test failure into a short, actionable
 * message safe to show in the UI — never the raw error object, which for
 * some AI SDK providers can carry request/response bodies. Extracts a
 * status code when present (e.g. `401`, `404`) and redacts anything that
 * looks like a credential, in case a provider ever echoes one back.
 */
export function describeConnectionTestError(error: unknown): string {
  const statusCode = (error as { statusCode?: number } | undefined)?.statusCode;
  const rawMessage =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  let message = rawMessage
    .replace(
      /Authorization:\s*(Bearer\s+)?[^\s,}"\]]+/gi,
      "Authorization: [REDACTED]",
    )
    .replace(/(bearer\s+)[a-zA-Z0-9._-]{10,}/gi, "$1[REDACTED]")
    .replace(
      /\b(sk-ant-|sk-or-v1-|sk-|gsk_|AIza)[a-zA-Z0-9_-]{8,}\b/g,
      "[REDACTED]",
    );

  if (message.length > 300) {
    message = `${message.slice(0, 300)}...`;
  }

  return typeof statusCode === "number" ? `${statusCode}: ${message}` : message;
}

/**
 * Check whether the current settings have a usable provider configured.
 * This product is BYOK-only: a non-empty token and model is the whole
 * definition — there is no separate enable flag.
 */
export function isProviderConfigured(settings: AppSettings): boolean {
  const hasToken = Boolean(settings.aiToken?.trim());
  const hasModel = Boolean(settings.aiModel?.trim());
  return hasToken && hasModel;
}

/**
 * Create an AI SDK provider for BYOK mode.
 */
export function createAIProvider(settings: AppSettings) {
  const provider = settings.aiProvider ?? "openai";
  const apiKey = settings.aiToken ?? "";
  const baseURL = validateHostUrl(settings.aiHost || undefined);

  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey, baseURL });
    case "google":
      return createGoogleGenerativeAI({ apiKey, baseURL });
    case "openai":
      return createOpenAI({ apiKey, baseURL });
    default:
      // For custom providers, baseURL is required
      if (!baseURL) {
        throw new Error(
          `Custom provider "${provider}" requires aiHost to be specified`,
        );
      }
      return createOpenAICompatible({ apiKey, baseURL, name: provider });
  }
}

/**
 * Stateful SSE stream transform that fixes parameterless tool calls from
 * providers like Anthropic via OpenRouter/proxy.
 *
 * Some providers stream tool_calls with `"arguments":""` for every chunk when
 * the tool has no parameters. The AI SDK uses `isParsableJson` to decide when
 * a tool call is complete, and `""` never passes that check, so the tool call
 * is silently dropped.
 *
 * A naive text-replacement of `""` → `"{}"` on every chunk would break tools
 * that DO have arguments (the first empty chunk would be treated as complete
 * `{}`, and all subsequent real-argument chunks would be discarded).
 *
 * This transform tracks tool call state across the stream:
 * - Passes all SSE lines through **unchanged** during streaming
 * - When `finish_reason: "tool_calls"` arrives, injects a synthetic SSE chunk
 *   with `"arguments":"{}"` for every tool call whose accumulated arguments
 *   are still empty — right before the finish chunk
 */
export function createEmptyToolArgsFinalizer(
  original: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  // Track accumulated arguments per tool call index
  const toolCallArgs = new Map<
    number,
    { id: string; name: string; args: string }
  >();
  // Capture the chunk id so synthetic events look like they belong to the same response
  let streamId: string | undefined;

  function processLine(
    line: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") {
      controller.enqueue(encoder.encode(`${line}\n`));
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(line.slice(6));
    } catch {
      controller.enqueue(encoder.encode(`${line}\n`));
      return;
    }

    if (!streamId && parsed.id) {
      streamId = parsed.id;
    }

    const choice = parsed.choices?.[0];

    // Track tool call arguments
    const toolCalls = choice?.delta?.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const idx = tc.index;
        if (typeof idx !== "number") continue;

        const existing = toolCallArgs.get(idx);
        if (!existing) {
          toolCallArgs.set(idx, {
            id: tc.id ?? "",
            name: tc.function?.name ?? "",
            args: tc.function?.arguments ?? "",
          });
        } else {
          if (tc.function?.arguments != null) {
            existing.args += tc.function.arguments;
          }
        }
      }
    }

    // When finish_reason is tool_calls, inject synthetic chunks for empty args
    if (choice?.finish_reason === "tool_calls") {
      for (const [idx, tc] of toolCallArgs) {
        if (tc.args === "") {
          const synthetic = {
            id: streamId ?? parsed.id ?? "",
            object: "chat.completion.chunk",
            created: parsed.created ?? 0,
            model: parsed.model ?? "",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: idx,
                      function: { arguments: "{}" },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(synthetic)}\n\n`),
          );
        }
      }
    }

    controller.enqueue(encoder.encode(`${line}\n`));
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = original.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.length > 0) {
              processLine(buffer, controller);
            }
            controller.close();
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            processLine(line, controller);
          }
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
