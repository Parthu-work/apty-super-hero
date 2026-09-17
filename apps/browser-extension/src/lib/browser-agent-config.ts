/**
 * Browser-specific agent configuration helpers
 * Provides default configuration for browser extension use cases
 */

import type { AppSettings, FunctionTool } from "@apty/agent-core";
import {
  type AutomationMode,
  aisdk,
  SessionStorage,
  STORAGE_KEYS,
  validateAutomationMode,
} from "@apty/agent-core";
import { SYSTEM_PROMPT } from "@apty/ui/components/chatbot/constants";
import {
  allBrowserProviders,
  allBrowserTools,
  IndexedDBStorage,
  selectRelevantTools,
} from "@apty/browser-runtime";
import { useStorage } from "@apty/browser-runtime/hooks";
import { useCallback, useMemo } from "react";
import { createAIProvider, isByokConfigured } from "./ai-provider";

/**
 * Create browser-specific storage instance
 */
export function useBrowserStorage() {
  return useMemo(
    () =>
      new SessionStorage(
        new IndexedDBStorage({
          dbName: "aipex-sessions",
          storeName: "sessions",
        }),
      ),
    [],
  );
}

/**
 * Create browser-specific model factory.
 *
 * Requires BYOK (Bring Your Own Key) to be configured — Apty's agent talks
 * directly to the configured provider, never through a third-party proxy.
 */
export function useBrowserModelFactory() {
  return useCallback((settings: AppSettings) => {
    if (!isByokConfigured(settings)) {
      throw new Error(
        "AI provider is not configured. Set an API key and model in Settings.",
      );
    }
    const provider = createAIProvider(settings);
    const modelId = settings.aiModel;
    if (!modelId) {
      throw new Error("AI model is not configured");
    }
    return aisdk(provider(modelId));
  }, []);
}

/**
 * Get browser-specific context providers
 */
export function useBrowserContextProviders() {
  return useMemo(() => allBrowserProviders, []);
}

/**
 * Filter tools based on automation mode
 * In background mode, filter out computer and screenshot-related tools
 */
function filterToolsByMode(
  tools: FunctionTool[],
  mode: AutomationMode,
): FunctionTool[] {
  // In background mode, filter out computer and screenshot-related tools
  if (mode === "background") {
    return tools.filter((tool) => {
      const toolName = tool.name.toLowerCase();
      // Filter out computer tool and all screenshot-related tools
      return (
        toolName !== "computer" &&
        !toolName.includes("screenshot") &&
        !toolName.includes("take_screenshot") &&
        !toolName.includes("capture_screenshot")
      );
    });
  }
  // In focus mode, include all tools
  return tools;
}

/**
 * Get browser-specific tools filtered by automation mode
 * In background mode, visual tools (computer, screenshot) are excluded
 */
export function useBrowserTools(): FunctionTool[] {
  const [automationModeRaw] = useStorage<string>(
    STORAGE_KEYS.AUTOMATION_MODE,
    "focus",
  );

  const automationMode: AutomationMode = useMemo(
    () => validateAutomationMode(automationModeRaw),
    [automationModeRaw],
  );

  return useMemo(
    () => filterToolsByMode(allBrowserTools, automationMode),
    [automationMode],
  );
}

/**
 * Returns a stable `ChatConfig.selectTools` callback: for each message,
 * picks the subset of `allBrowserTools` relevant to that message (see
 * `selectRelevantTools`), then applies the same automation-mode filtering
 * `useBrowserTools` applies to the full registry. Every tool remains
 * registered — this only narrows what's sent in the model's tool schema
 * for a given turn, keeping request size proportional to the task instead
 * of always including all ~59 tools.
 */
export function useSelectRelevantTools() {
  const [automationModeRaw] = useStorage<string>(
    STORAGE_KEYS.AUTOMATION_MODE,
    "focus",
  );

  const automationMode: AutomationMode = useMemo(
    () => validateAutomationMode(automationModeRaw),
    [automationModeRaw],
  );

  return useCallback(
    (text: string) =>
      filterToolsByMode(selectRelevantTools(text), automationMode),
    [automationMode],
  );
}

/**
 * Browser-specific agent configuration
 */
export const BROWSER_AGENT_CONFIG = {
  instructions: SYSTEM_PROMPT,
  name: "Apty Live Browser Debugging Agent",
  maxTurns: 2000,
} as const;
