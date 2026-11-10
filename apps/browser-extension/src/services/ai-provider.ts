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
import {
  type AiDestination,
  type AppSettings,
  type DestinationVerdict,
  destinationAllowed,
  destinationOf,
  detectProviderFromHost,
  type OrgPolicyState,
  originOf,
} from "@apty/agent-core";
import {
  loadOrgPolicy,
  peekOrgPolicy,
} from "@apty/browser-runtime/runtime/org-policy";
import {
  isIPv4,
  isPrivateIPv4,
  isPrivateIPv6,
} from "@apty/browser-runtime/vm/url-guard";
import { createTranslationFunction } from "@apty/ui/i18n/index";
import type { I18nContextValue } from "@apty/ui/i18n/types";
import { type LanguageModelMiddleware, wrapLanguageModel } from "ai";

type Translate = I18nContextValue["t"];
const englishTranslate: Translate = createTranslationFunction("en");

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
export function validateHostUrl(url: string | undefined): string | undefined {
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
 * Turn a provider/model connection check failure into a short, actionable
 * message safe to show in the UI — never the raw error object, which for
 * some AI SDK providers can carry request/response bodies. Extracts a
 * status code when present (e.g. `401`, `404`) and redacts anything that
 * looks like a credential, in case a provider ever echoes one back.
 */
export function describeConnectionTestError(
  error: unknown,
  workspaceIdFix: string = WORKSPACE_ID_FIX,
): string {
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

  if (/anthropic-workspace-id/.test(message)) {
    message += ` ${workspaceIdFix}`;
  }
  return typeof statusCode === "number" ? `${statusCode}: ${message}` : message;
}

/** Where to fix Anthropic's "not scoped to a workspace" error in this extension. */
const WORKSPACE_ID_FIX =
  "Fix: enter the workspace ID (wrkspc_…, from Claude Console → Settings → Workspaces) in Settings → AI Configuration → Workspace ID, or use an API key created for a single workspace.";

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
 * The Anthropic SDK appends `/messages` to its base URL, which must end in
 * `/v1`. Hosts saved by older presets were the bare origin
 * (`https://api.anthropic.com`), which sent every request to a 404.
 */
export function anthropicBaseUrl(baseURL: string | undefined) {
  if (!baseURL) return baseURL;
  const url = new URL(baseURL);
  return url.pathname === "/" || url.pathname === ""
    ? `${url.origin}/v1`
    : baseURL;
}

/**
 * Headers every request to Anthropic from this extension needs. The API
 * treats an extension page as a browser origin and refuses it (401) without
 * `anthropic-dangerous-direct-browser-access`; the key is the user's own,
 * stored locally, which is what the header acknowledges. A multi-workspace
 * key also needs `anthropic-workspace-id` (a key created for one workspace
 * runs in it without the header).
 */
export function anthropicHeaders(
  workspaceId: string | undefined,
): Record<string, string> {
  const id = workspaceId?.trim();
  return {
    "anthropic-dangerous-direct-browser-access": "true",
    ...(id ? { "anthropic-workspace-id": id } : {}),
  };
}

/**
 * OpenAI's Responses API keeps every request (page data, screenshots) on
 * OpenAI's side unless the request says `store: false`.
 */
const openAINoStoreMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => ({
    ...params,
    providerOptions: {
      ...params.providerOptions,
      openai: { ...params.providerOptions?.openai, store: false },
    },
  }),
};

/** True when a tool's JSON schema declares no properties (empty or absent). */
function hasNoProperties(inputSchema: unknown): boolean {
  const properties = (inputSchema as { properties?: unknown } | null)
    ?.properties;
  return (
    !properties ||
    typeof properties !== "object" ||
    Object.keys(properties).length === 0
  );
}

/**
 * Groq rejects a `strict: true` function whose parameters have no properties
 * ("'required' present but 'properties' is missing") while accepting the same
 * schema without `strict`. The SDK marks every tool strict, so a tool with no
 * arguments is sent without it; tools with parameters keep their setting.
 */
const groqEmptyToolsNotStrictMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => ({
    ...params,
    tools: params.tools?.map((tool) => {
      if (tool.type !== "function" || !hasNoProperties(tool.inputSchema)) {
        return tool;
      }
      const { strict: _strict, ...withoutStrict } = tool;
      return withoutStrict;
    }),
  }),
};

type PromptMessage = Parameters<
  NonNullable<LanguageModelMiddleware["transformParams"]>
>[0]["params"]["prompt"][number];

function withCacheBreakpoint(message: PromptMessage): PromptMessage {
  return {
    ...message,
    providerOptions: {
      ...message.providerOptions,
      anthropic: {
        ...message.providerOptions?.anthropic,
        cacheControl: { type: "ephemeral" },
      },
    },
  };
}

/**
 * Anthropic caches a request's prefix only where it is marked. Two of its
 * four breakpoints: the system prompt, which also covers the tools sent
 * before it, and the newest message, so the next step of a tool loop or the
 * next turn reads the conversation so far instead of paying for it again.
 * A cache write costs 1.25 times the input price and a read about a tenth;
 * a prefix below the model's minimum (512 to 4,096 tokens) is not cached
 * and costs nothing extra.
 */
const anthropicPromptCacheMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => {
    const lastSystem = params.prompt.findLastIndex((m) => m.role === "system");
    const last = params.prompt.length - 1;
    return {
      ...params,
      prompt: params.prompt.map((message, i) =>
        i === lastSystem || i === last ? withCacheBreakpoint(message) : message,
      ),
    };
  },
};

type Refusal = Exclude<DestinationVerdict, { allowed: true }>;

/** What the chat shows when the organization policy refuses a destination (KB-RAG K22, S3). */
export function destinationRefusalMessage(
  verdict: Refusal,
  policyReason?: string,
  t: Translate = englishTranslate,
): string {
  if (verdict.reason === "invalid-policy") {
    return t("orgPolicy.invalidNoRequests", { reason: policyReason ?? "" });
  }
  return t("orgPolicy.destinationRefused", {
    allowed: verdict.allowedValues.join(", ") || t("orgPolicy.none"),
  });
}

/** The organization policy refused the request's destination; nothing was sent. */
export class AiDestinationRefusedError extends Error {
  readonly verdict: Refusal;
  readonly policyReason?: string;
  constructor(verdict: Refusal, policyReason?: string, t?: Translate) {
    super(destinationRefusalMessage(verdict, policyReason, t));
    this.name = "AiDestinationRefusedError";
    this.verdict = verdict;
    this.policyReason = policyReason;
  }
}

function refuseUnlessAllowed(
  state: OrgPolicyState,
  destination: AiDestination,
): void {
  const verdict = destinationAllowed(state, destination);
  if (!verdict.allowed) {
    throw new AiDestinationRefusedError(
      verdict,
      state.kind === "invalid" ? state.reason : undefined,
    );
  }
}

/** The `model` of a JSON request body, when it names one. */
function modelInBody(body: unknown): string | undefined {
  if (typeof body !== "string") return undefined;
  try {
    const model = (JSON.parse(body) as { model?: unknown }).model;
    return typeof model === "string" ? model : undefined;
  } catch {
    return undefined;
  }
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/**
 * `fetch` that checks every request against the policy as it is read now
 * (hard rule 2): the URL's origin, the provider and the body's model must
 * be allowed, or nothing is sent.
 * @internal exported for tests; `createAIProvider` uses it.
 */
export function policyGuardedFetch(
  settings: AppSettings,
  base: typeof fetch | undefined,
  loadPolicy: () => Promise<OrgPolicyState> = loadOrgPolicy,
): typeof fetch {
  const destination = destinationOf(settings);
  return async (input, init) => {
    const url = urlOf(input);
    const origin = originOf(url);
    refuseUnlessAllowed(await loadPolicy(), {
      provider: destination.provider,
      ...(origin ? { origin } : {}),
      ...((modelInBody(init?.body) ?? destination.model)
        ? { model: modelInBody(init?.body) ?? destination.model }
        : {}),
    });
    return (base ?? globalThis.fetch)(input, init);
  };
}

/**
 * Create an AI SDK provider for BYOK mode. Refuses, with
 * `AiDestinationRefusedError` and before any request, a destination the
 * organization policy does not allow: when the provider is built, for each
 * model id it builds, and again on every request it sends.
 */
export type ProviderModelFactory = (
  modelId: string,
) => ReturnType<typeof wrapLanguageModel>;

export function createAIProvider(
  settings: AppSettings,
  options: {
    fetch?: typeof fetch;
    /** The policy to check against; by default the one read from managed storage. */
    policy?: OrgPolicyState;
  } = {},
): ProviderModelFactory {
  const policyNow = () => options.policy ?? peekOrgPolicy();
  const destination = destinationOf(settings);
  const known = policyNow();
  if (known) refuseUnlessAllowed(known, destination);
  const fetchImpl = policyGuardedFetch(
    settings,
    options.fetch,
    options.policy ? async () => options.policy as OrgPolicyState : undefined,
  );
  const factory = buildProvider(settings, fetchImpl);
  return (modelId: string) => {
    const state = policyNow();
    if (state) refuseUnlessAllowed(state, { ...destination, model: modelId });
    return factory(modelId);
  };
}

function buildProvider(
  settings: AppSettings,
  fetchImpl: typeof fetch,
): ProviderModelFactory {
  const options = { fetch: fetchImpl };
  const provider = settings.aiProvider ?? "openai";
  const apiKey = settings.aiToken ?? "";
  const baseURL = validateHostUrl(settings.aiHost || undefined);

  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey,
        baseURL: anthropicBaseUrl(baseURL),
        headers: anthropicHeaders(settings.aiWorkspaceId),
        fetch: options.fetch,
      });
      return (modelId: string) =>
        wrapLanguageModel({
          model: anthropic(modelId),
          middleware: anthropicPromptCacheMiddleware,
        });
    }
    case "google":
      return createGoogleGenerativeAI({
        apiKey,
        baseURL,
        fetch: options.fetch,
      });
    case "openai": {
      const openai = createOpenAI({ apiKey, baseURL, fetch: options.fetch });
      return (modelId: string) =>
        wrapLanguageModel({
          model: openai(modelId),
          middleware: openAINoStoreMiddleware,
        });
    }
    default: {
      // For custom providers, baseURL is required
      if (!baseURL) {
        throw new Error(
          `Custom provider "${provider}" requires aiHost to be specified`,
        );
      }
      const compatible = createOpenAICompatible({
        apiKey,
        baseURL,
        name: provider,
        fetch: options.fetch,
      });
      if (detectProviderFromHost(baseURL) !== "groq") return compatible;
      return (modelId: string) =>
        wrapLanguageModel({
          model: compatible(modelId),
          middleware: groqEmptyToolsNotStrictMiddleware,
        });
    }
  }
}
