import type { AIProviderKey } from "./ai-providers.js";
import type { ProviderType } from "./types.js";

export type { ProviderType };

/** Whether a model called a tool in Settings' Test Connection probe. */
export type ToolCallingSupport = "yes" | "no" | "unknown";

export interface CustomModelConfig {
  id: string;
  name?: string;
  providerType: ProviderType;
  aiHost?: string;
  aiToken: string;
  aiModel: string;
  /** Anthropic only: the workspace (`wrkspc_…`) a multi-workspace API key runs in, sent as `anthropic-workspace-id`. */
  aiWorkspaceId?: string;
  enabled: boolean;
  /** The last tool-calling probe, for the model id it tested. */
  toolCalling?: { model: string; support: ToolCallingSupport };
}

/**
 * How much diagnostic data is masked before it reaches the model, the side
 * panel or an export. The same values as `@apty/debug-contract`'s
 * `RedactionMode`: "strict" also masks page context (titles, paths),
 * "standard" masks secrets and personal data, "off" masks only secrets
 * recognised by their shape (tokens, keys, emails). Development only.
 */
export type RedactionModeSetting = "strict" | "standard" | "off";

export const REDACTION_MODES: readonly RedactionModeSetting[] = [
  "strict",
  "standard",
  "off",
];

/** Whether a screenshot may be sent to the AI provider: ask each time, always, or never. */
export type ScreenshotPolicySetting = "ask" | "allow" | "never";

export const SCREENSHOT_POLICIES: readonly ScreenshotPolicySetting[] = [
  "ask",
  "allow",
  "never",
];

export interface AppSettings {
  /** The stored schema's version; see `settings-migration.ts`. Missing means 0. */
  settingsVersion?: number;
  aiProvider?: AIProviderKey;
  aiHost?: string;
  aiToken?: string;
  aiModel?: string;
  /** Anthropic only: the workspace (`wrkspc_…`) a multi-workspace API key runs in, sent as `anthropic-workspace-id`. */
  aiWorkspaceId?: string;
  /**
   * Preferred default model for new sessions (does not affect runtime selection)
   */
  defaultModel?: string;
  language?: string;
  theme?: string;
  /**
   * Global toggle for BYOK/provider usage
   */
  providerEnabled?: boolean;
  /**
   * Provider type for current BYOK selection
   */
  providerType?: ProviderType;
  /**
   * Multiple BYOK custom model configurations
   */
  customModels?: CustomModelConfig[];
  /**
   * Opt-in toggle for the skills/QuickJS sandbox feature. Defaults to (and
   * treats `undefined` the same as) disabled: a skill script is
   * author-supplied code, and the fetch bridge's SSRF guard has a
   * documented residual DNS-rebinding risk (see
   * packages/browser-runtime/src/vm/url-guard.ts).
   */
  skillExecutionEnabled?: boolean;
  /**
   * Opt-in: fetch (redacted) response bodies of XHR/Fetch requests during a
   * page network capture. Off by default because bodies of any tab are
   * otherwise sent to the model. Only the user can change it, in Settings.
   */
  networkBodyCaptureEnabled?: boolean;
  /** Hosts (matching subdomains too) or URL substrings whose bodies are never captured. */
  networkBodyCaptureDenyList?: string[];
  /** Write debug-level logs to the extension's consoles in a production build, for troubleshooting. */
  verboseLogging?: boolean;
  /** Show developer-only tools in the side panel, such as the DOM Health route probe. */
  developerTools?: boolean;
  /** Extra page content DOM Health leaves out of an audit, one matcher per entry: `id:prefix`, `class:prefix` or `tag:name`. Added to the built-in overlay list. */
  domHealthIgnoredRoots?: string[];
  /**
   * Run the page-world script that captures console output from page load
   * and counts client-side routing (`pushState`) for DOM Health. On unless
   * turned off (Settings → Troubleshooting).
   */
  pageHooksEnabled?: boolean;
  /** Hosts (with their subdomains) or match patterns where that script never runs. */
  pageHooksExcludedSites?: string[];
  /**
   * Developer tools: overrides for DOM Health's unverified thresholds, by
   * name (`dom-health-thresholds.ts` in browser-runtime lists them and their
   * bounds). Every active override is listed in the audit result.
   */
  domHealthThresholdOverrides?: Record<string, number>;
  /** Redaction applied to diagnostic data; missing or unknown means "strict". */
  redactionMode?: RedactionModeSetting;
  /** Whether a screenshot may be sent to the AI provider; missing or unknown means "ask". */
  screenshotPolicy?: ScreenshotPolicySetting;
  /**
   * The largest request to send, in estimated tokens (characters / 4):
   * older history is left out to fit, and a message that cannot fit stops
   * with a message. Missing means no budget.
   */
  requestTokenBudget?: number;
  /** The most tokens one answer may use. Missing leaves the provider's default. */
  maxOutputTokens?: number;
  /**
   * When a chat grows long, the model summarizes its earlier turns and later
   * requests carry the summary instead. Missing means off.
   */
  summarizeEarlierTurns?: boolean;
  /**
   * The model that writes those summaries, with the chat's own provider.
   * Missing or empty: `claude-haiku-5-5` for Anthropic, the chat model
   * otherwise (`summaryModelFor`).
   */
  summaryModel?: string;
}

/** What Settings accepts for `requestTokenBudget`; a stored value outside it counts as unset. */
export const REQUEST_TOKEN_BUDGET_RANGE = {
  min: 2_000,
  max: 2_000_000,
} as const;
/** What Settings accepts for `maxOutputTokens`; a stored value outside it counts as unset. */
export const MAX_OUTPUT_TOKENS_RANGE = { min: 256, max: 1_000_000 } as const;

/**
 * What a fresh install's provider form starts on (decision C6): multi-step
 * tool use under a long, rule-heavy system prompt, with Anthropic's prompt
 * caching already wired in. Bring your own key: nothing is enabled until a
 * key is saved.
 */
export const DEFAULT_CHAT_MODEL = {
  provider: "anthropic",
  model: "claude-sonnet-5-5",
} as const satisfies { provider: AIProviderKey; model: string };

/** Anthropic's default for summaries of earlier turns: a short, plain task. */
export const DEFAULT_ANTHROPIC_SUMMARY_MODEL = "claude-haiku-5-5";

/**
 * The model id the summary request uses, or undefined for the chat model:
 * only while summaries are on, and only a different id from the chat's.
 */
export function summaryModelFor(settings: AppSettings): string | undefined {
  if (settings.summarizeEarlierTurns !== true) return undefined;
  const chosen =
    settings.summaryModel?.trim() ||
    (settings.aiProvider === "anthropic" ||
    (settings.aiProvider === undefined && settings.providerType === "claude")
      ? DEFAULT_ANTHROPIC_SUMMARY_MODEL
      : undefined);
  return chosen && chosen !== settings.aiModel?.trim() ? chosen : undefined;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  aiProvider: DEFAULT_CHAT_MODEL.provider,
  language: "en",
  theme: "system",
  providerType: "claude",
  providerEnabled: false,
  defaultModel: undefined,
  customModels: [],
  skillExecutionEnabled: false,
  networkBodyCaptureEnabled: false,
  networkBodyCaptureDenyList: [],
  verboseLogging: false,
  developerTools: false,
  domHealthIgnoredRoots: [],
  redactionMode: "strict",
  screenshotPolicy: "ask",
  pageHooksEnabled: true,
  pageHooksExcludedSites: [],
};
