import type { AppSettings } from "@apty/agent-core";
import { asksAboutDapty } from "@apty/browser-runtime/apty/diagnosis/dapty-route";
import { routeSymptom } from "@apty/browser-runtime/apty/diagnosis/router";
import type { AuthCheckResult } from "@apty/ui/types";
import { isProviderConfigured } from "./ai-provider";

/**
 * Whether a message may be sent. Apty's agent is BYOK-only, with no login or
 * proxy fallback: a message the model answers needs a provider and key, but
 * one a check answers from the Apty Client's files, or the KB pack's cards
 * answer (`kbAnswers`, KB-RAG K6), with no model call, can go without them.
 */
export function checkAuth(
  settings: AppSettings,
  text: string,
  kbAnswers = false,
): AuthCheckResult {
  if (isProviderConfigured(settings)) {
    return { needsAuth: false, hasCustomConfig: true };
  }
  return {
    needsAuth:
      !asksAboutDapty(text) && routeSymptom(text) === undefined && !kbAnswers,
    hasCustomConfig: false,
  };
}
