/**
 * Consent before a screenshot is sent to the AI provider (Settings → Data
 * handling → Screenshots). "ask" goes through the same approval gate as other
 * risky tools, "allow" sends without asking, "never" refuses. Only screenshots
 * the model would see are gated; one kept on the device is not.
 */
import {
  type AppSettings,
  type ScreenshotPolicySetting,
  STORAGE_KEYS,
} from "@apty/agent-core";
import { type ApprovalDeniedResult, gateRiskyAction } from "./approval.js";

export interface ScreenshotRefusal {
  success: false;
  status: "refused";
  toolName: string;
  message: string;
}

export function parseScreenshotPolicy(value: unknown): ScreenshotPolicySetting {
  return value === "allow" || value === "never" ? value : "ask";
}

/** Read fresh on every call: a screenshot is rare, and a change in Settings must apply to the next one. */
export async function getScreenshotPolicy(): Promise<ScreenshotPolicySetting> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return parseScreenshotPolicy(
      (stored?.[STORAGE_KEYS.SETTINGS] as AppSettings | undefined)
        ?.screenshotPolicy,
    );
  } catch {
    return "ask";
  }
}

function siteOf(url: string | undefined): string {
  if (!url) return "this page";
  try {
    return new URL(url).origin;
  } catch {
    return "this page";
  }
}

export async function gateScreenshotForModel<T>(
  request: {
    conversationId?: string;
    toolName: string;
    tab: { id?: number; url?: string };
  },
  capture: () => Promise<T>,
): Promise<T | ApprovalDeniedResult | ScreenshotRefusal> {
  const policy = await getScreenshotPolicy();
  if (policy === "allow") return capture();
  if (policy === "never") {
    return {
      success: false,
      status: "refused",
      toolName: request.toolName,
      message:
        "Screenshots are not sent to the AI provider (Settings → Data handling → Screenshots is Never). Use search_elements to read the page instead.",
    };
  }
  return gateRiskyAction(
    request.conversationId,
    request.toolName,
    `Send a screenshot of ${siteOf(request.tab.url)} to your AI provider`,
    request.tab.url,
    capture,
    { tabId: request.tab.id },
  );
}
