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
};
