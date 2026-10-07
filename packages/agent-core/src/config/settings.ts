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
   * treats `undefined` the same as) disabled: a skill script can import
   * CDN packages, which are fetched and executed with no integrity pinning,
   * and the fetch bridge's SSRF guard has a documented residual
   * DNS-rebinding risk (see packages/browser-runtime/src/vm/url-guard.ts).
   * Off by default until that's hardened further.
   */
  skillExecutionEnabled?: boolean;
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
};
