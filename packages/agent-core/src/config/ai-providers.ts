import type { ProviderType } from "./types.js";

export interface AIProviderConfig {
  name: string;
  icon: string;
  host?: string;
  /**
   * Suggested model ids only, from the provider's own documentation;
   * empty where none could be verified. Settings' "Fetch models" reads the
   * live list. Audited in C1 (REVIEW.md lists the sources).
   */
  models: readonly string[];
  /** Shown in Settings when the agent is not expected to work with this preset. */
  experimental?: string;
  tokenPlaceholder: string;
  docs: string;
  providerType: ProviderType;
}

export const AI_PROVIDERS = {
  custom: {
    name: "Custom",
    icon: "⚙️",
    host: "",
    models: [] as const,
    tokenPlaceholder: "Your API Key",
    docs: "",
    providerType: "openai",
  },
  openai: {
    name: "OpenAI",
    icon: "🤖",
    host: "https://api.openai.com/v1",
    // The documented current ids could not be confirmed (only the
    // non-production "chat-latest" alias was); use "Fetch models".
    models: [] as const,
    tokenPlaceholder: "sk-...",
    docs: "https://platform.openai.com/api-keys",
    providerType: "openai",
  },
  anthropic: {
    name: "Anthropic",
    icon: "🧠",
    // The SDK appends "/messages" to this; without "/v1" every request 404s.
    host: "https://api.anthropic.com/v1",
    // Anthropic publishes no floating aliases; these are the current model
    // ids from platform.claude.com/docs/en/about-claude/models/overview.
    models: [
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "claude-fable-5-1",
    ] as const,
    tokenPlaceholder: "sk-ant-...",
    docs: "https://console.anthropic.com/settings/keys",
    providerType: "claude",
  },
  google: {
    name: "Google",
    icon: "🔍",
    // Google's own floating aliases, not a pinned model snapshot — a
    // pinned id (gemini-2.5-flash-exp, gemini-1.5-pro, ...) reliably goes
    // stale as Google retires each generation, which is exactly the 404
    // ("models/X is not found for API version v1beta") users kept hitting
    // here. "-latest" is remapped by Google itself to whatever the
    // current production model is, so this list doesn't need to be
    // manually re-pinned every time Google ships a new generation.
    models: [
      "gemini-flash-latest",
      "gemini-flash-lite-latest",
      "gemini-pro-latest",
    ] as const,
    tokenPlaceholder: "AIza...",
    docs: "https://aistudio.google.com/app/apikey",
    providerType: "google",
  },
  openrouter: {
    name: "OpenRouter",
    icon: "🔀",
    host: "https://openrouter.ai/api/v1",
    models: [] as const,
    tokenPlaceholder: "sk-or-v1-...",
    docs: "https://openrouter.ai/keys",
    providerType: "openai",
  },
  requesty: {
    name: "Requesty",
    icon: "🔀",
    host: "https://router.requesty.ai/v1",
    models: [] as const,
    tokenPlaceholder: "sk-...",
    docs: "https://app.requesty.ai/api-keys",
    providerType: "openai",
  },
  deepseek: {
    name: "DeepSeek",
    icon: "🔍",
    host: "https://api.deepseek.com",
    // deepseek-chat and deepseek-reasoner were retired; api-docs.deepseek.com.
    models: ["deepseek-flash", "deepseek-v4-pro"] as const,
    tokenPlaceholder: "sk-...",
    docs: "https://platform.deepseek.com/api_keys",
    providerType: "openai",
  },
  groq: {
    name: "Groq",
    icon: "⚡",
    host: "https://api.groq.com/openai/v1",
    models: [] as const,
    tokenPlaceholder: "gsk_...",
    docs: "https://console.groq.com/keys",
    providerType: "openai",
  },
  together: {
    name: "Together AI",
    icon: "🤝",
    host: "https://api.together.ai/v1",
    models: [] as const,
    tokenPlaceholder: "...",
    docs: "https://api.together.xyz/settings/api-keys",
    providerType: "openai",
  },
  mistral: {
    name: "Mistral AI",
    icon: "🌬️",
    host: "https://api.mistral.ai/v1",
    models: [
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest",
    ] as const,
    tokenPlaceholder: "...",
    docs: "https://console.mistral.ai/api-keys",
    providerType: "openai",
  },
  cohere: {
    name: "Cohere",
    icon: "🔗",
    // The OpenAI-compatible endpoint (docs.cohere.com/docs/compatibility-api);
    // /v1 is Cohere's native API, which the agent cannot speak.
    host: "https://api.cohere.ai/compatibility/v1",
    models: [] as const,
    tokenPlaceholder: "...",
    docs: "https://dashboard.cohere.com/api-keys",
    providerType: "openai",
  },
  perplexity: {
    name: "Perplexity",
    icon: "🔎",
    host: "https://api.perplexity.ai",
    models: ["sonar", "sonar-pro"] as const,
    experimental:
      "Perplexity does not document tool calling on this API, which the agent needs.",
    tokenPlaceholder: "pplx-...",
    docs: "https://www.perplexity.ai/settings/api",
    providerType: "openai",
  },
  fireworks: {
    name: "Fireworks AI",
    icon: "🎆",
    host: "https://api.fireworks.ai/inference/v1",
    models: [] as const,
    tokenPlaceholder: "fw_...",
    docs: "https://fireworks.ai/api-keys",
    providerType: "openai",
  },
  replicate: {
    name: "Replicate",
    icon: "🔁",
    host: "https://api.replicate.com/v1",
    models: [] as const,
    experimental:
      "Replicate has no OpenAI-compatible chat API, so chats with this preset fail. Kept so saved settings still load.",
    tokenPlaceholder: "r8_...",
    docs: "https://replicate.com/account/api-tokens",
    providerType: "openai",
  },
  azure: {
    name: "Azure OpenAI",
    icon: "☁️",
    // The v1 API (no api-version); the model is your deployment's name.
    host: "https://YOUR-RESOURCE.openai.azure.com/openai/v1",
    models: [] as const,
    tokenPlaceholder: "YOUR-API-KEY",
    docs: "https://portal.azure.com",
    providerType: "openai",
  },
} as const satisfies Record<string, AIProviderConfig>;

/** Hosts earlier presets saved that no longer work; Settings moves a built-in provider still on one to its current host. */
export const SUPERSEDED_PRESET_HOSTS: Partial<Record<AIProviderKey, string>> = {
  anthropic: "https://api.anthropic.com",
  together: "https://api.together.xyz/v1",
  cohere: "https://api.cohere.ai/v1",
  azure:
    "https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT",
};

export type AIProviderKey = keyof typeof AI_PROVIDERS;

export function detectProviderFromHost(host: string): AIProviderKey {
  if (host.includes("api.openai.com")) return "openai";
  if (host.includes("anthropic.com")) return "anthropic";
  if (host.includes("generativelanguage.googleapis.com")) return "google";
  if (host.includes("openrouter.ai")) return "openrouter";
  if (host.includes("requesty.ai")) return "requesty";
  if (host.includes("deepseek.com")) return "deepseek";
  if (host.includes("groq.com")) return "groq";
  if (host.includes("together.xyz") || host.includes("together.ai")) {
    return "together";
  }
  if (host.includes("mistral.ai")) return "mistral";
  if (host.includes("cohere.ai")) return "cohere";
  if (host.includes("perplexity.ai")) return "perplexity";
  if (host.includes("fireworks.ai")) return "fireworks";
  if (host.includes("replicate.com")) return "replicate";
  if (host.includes("azure.com")) return "azure";
  if (host.includes("minimaxi.com") || host.includes("minimax.io")) {
    return host.includes("anthropic") ? "anthropic" : "openai";
  }
  return "custom";
}
