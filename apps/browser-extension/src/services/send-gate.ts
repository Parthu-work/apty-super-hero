import type { AppSettings } from "@apty/agent-core";
import { routeSymptom } from "@apty/browser-runtime/apty/diagnosis/router";
import type { AuthCheckResult } from "@apty/ui/types";
import { isProviderConfigured } from "./ai-provider";

/**
 * Whether a message may be sent. Apty's agent is BYOK-only, with no login or
 * proxy fallback: a message the model answers needs a provider and key, but
 * one a check answers from the Apty Client's files, with no model call, can
 * go without them.
 */
export function checkAuth(
  settings: AppSettings,
  text: string,
): AuthCheckResult {
  if (isProviderConfigured(settings)) {
    return { needsAuth: false, hasCustomConfig: true };
  }
  return {
    needsAuth: routeSymptom(text) === undefined,
    hasCustomConfig: false,
  };
}
