/**
 * Where a model request goes, and whether the organization policy allows it
 * (KB-RAG K22, D-SEC4). Pure; `createAIProvider` and the outbound filters
 * call it on every request.
 */
import { AI_PROVIDERS, type AIProviderKey } from "./ai-providers.js";
import { isDemoKbPack } from "./effective-settings.js";
import { type OrgPolicyState, originOf } from "./org-policy.js";
import type { AppSettings } from "./settings.js";

export interface AiDestination {
  provider: AIProviderKey;
  /** The base URL's origin; undefined when there is none (a custom provider with no host). */
  origin?: string;
  model?: string;
}

/** Providers whose SDK has a built-in base URL and no preset host. */
const SDK_DEFAULT_ORIGINS: Partial<Record<AIProviderKey, string>> = {
  google: "https://generativelanguage.googleapis.com",
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
};

/** The provider, origin (the provider's default when `aiHost` is empty) and model a request with `settings` goes to. */
export function destinationOf(settings: AppSettings): AiDestination {
  const provider: AIProviderKey =
    settings.aiProvider && Object.hasOwn(AI_PROVIDERS, settings.aiProvider)
      ? settings.aiProvider
      : "openai";
  const preset = AI_PROVIDERS[provider] as { host?: string };
  const host =
    settings.aiHost?.trim() ||
    preset.host ||
    SDK_DEFAULT_ORIGINS[provider] ||
    "";
  const origin = host ? originOf(host) : undefined;
  const model = settings.aiModel?.trim();
  return {
    provider,
    ...(origin ? { origin } : {}),
    ...(model ? { model } : {}),
  };
}

export type DestinationVerdict =
  | { allowed: true }
  | {
      allowed: false;
      /** Which check refused it; `invalid-policy` refuses every destination. */
      reason: "invalid-policy" | "provider" | "origin" | "model";
      /** The list the destination is not on (empty for `invalid-policy`). */
      allowedValues: readonly string[];
    };

/**
 * Whether the policy allows a request to `destination`: its provider in
 * `allowedProviders`, its origin exactly in `allowedOrigins` (scheme, host
 * and port), its model in `allowedModels`. A list the policy leaves out
 * does not restrict; an invalid policy allows nothing (fail closed).
 */
export function destinationAllowed(
  state: OrgPolicyState,
  destination: AiDestination,
): DestinationVerdict {
  if (state.kind === "none") return { allowed: true };
  if (state.kind === "invalid") {
    return { allowed: false, reason: "invalid-policy", allowedValues: [] };
  }
  const { allowedProviders, allowedOrigins, allowedModels } = state.policy;
  if (allowedProviders && !allowedProviders.includes(destination.provider)) {
    return {
      allowed: false,
      reason: "provider",
      allowedValues: allowedProviders,
    };
  }
  if (
    allowedOrigins &&
    !(destination.origin && allowedOrigins.includes(destination.origin))
  ) {
    return { allowed: false, reason: "origin", allowedValues: allowedOrigins };
  }
  if (
    allowedModels &&
    !(destination.model && allowedModels.includes(destination.model))
  ) {
    return { allowed: false, reason: "model", allowedValues: allowedModels };
  }
  return { allowed: true };
}

/** Whether a request URL (what is actually fetched) is at an allowed origin. */
export function requestUrlAllowed(state: OrgPolicyState, url: string): boolean {
  if (state.kind === "none") return true;
  if (state.kind === "invalid") return false;
  const { allowedOrigins } = state.policy;
  if (!allowedOrigins) return true;
  const origin = originOf(url);
  return origin !== undefined && allowedOrigins.includes(origin);
}

export type KbEgressReason =
  /** Every loaded pack is a demo pack (D-SEC1's exception). */
  | "demo"
  /** The policy approves KB text to this destination. */
  | "approved"
  | "no-pack"
  /** No policy, or one with `kbToModel` off. */
  | "policy-off"
  | "invalid-policy"
  /** `kbToModel` is approved, but not for this destination. */
  | "destination"
  /** The policy, settings or packs could not be read: withheld (fail closed). */
  | "check-failed";

export interface KbEgressDecision {
  allowed: boolean;
  reason: KbEgressReason;
}

/**
 * Whether KB card text may go with a request to `destination` (D-SEC1): only
 * when every loaded pack is a demo pack, or the policy sets `kbToModel` to
 * "approved" and allows the destination.
 */
export function kbEgressAllowed(
  state: OrgPolicyState,
  destination: AiDestination,
  packs: readonly { site: string }[],
): KbEgressDecision {
  if (packs.length === 0) return { allowed: false, reason: "no-pack" };
  if (packs.every(isDemoKbPack)) return { allowed: true, reason: "demo" };
  if (state.kind === "invalid") {
    return { allowed: false, reason: "invalid-policy" };
  }
  if (state.kind === "none" || state.policy.kbToModel !== "approved") {
    return { allowed: false, reason: "policy-off" };
  }
  if (!destinationAllowed(state, destination).allowed) {
    return { allowed: false, reason: "destination" };
  }
  return { allowed: true, reason: "approved" };
}
