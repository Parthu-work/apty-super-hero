import type { AIProviderKey } from "./ai-providers.js";
import type { ProviderType } from "./types.js";

export type { ProviderType };

export interface CustomModelConfig {
  id: string;
  name?: string;
  providerType: ProviderType;
  aiHost?: string;
  aiToken: string;
  aiModel: string;
  enabled: boolean;
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

export interface AppSettings {
  aiProvider?: AIProviderKey;
  aiHost?: string;
  aiToken?: string;
  aiModel?: string;
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
  /** Redaction applied to diagnostic data; missing or unknown means "strict". */
  redactionMode?: RedactionModeSetting;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  aiProvider: "openai",
  language: "en",
  theme: "system",
  providerType: "openai",
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
  pageHooksEnabled: true,
  pageHooksExcludedSites: [],
};
