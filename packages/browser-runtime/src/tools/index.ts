import type { FunctionTool } from "@apty/agent-core";
import type { z } from "zod";
import { aptyTools } from "./apty";
import { computerTool } from "./computer";
import { devToolsTools } from "./devtools.js";
import { domHealthTools } from "./dom-health.js";
import {
  clickTool,
  fillElementByUidTool,
  fillFormTool,
  getEditorValueTool,
  hoverElementByUidTool,
} from "./element";
import { extensionNetworkTools } from "./extension-network.js";
import { interventionTools } from "./interventions/index.js";
import { investigationTools } from "./investigation.js";
import { networkCaptureTools } from "./network-capture.js";
import {
  getPageMetadataTool,
  highlightElementTool,
  highlightTextInlineTool,
  scrollToElementTool,
} from "./page";
import {
  captureScreenshotTool,
  captureScreenshotWithHighlightTool,
  captureTabScreenshotTool,
} from "./screenshot";
// Clipboard image tools – available but not registered in the default bundle.
// Enable explicitly if the product decides to ship clipboard access.
// import {
//   captureScreenshotToClipboardTool,
//   readClipboardImageTool,
//   getClipboardImageInfoTool,
// } from "./screenshot";
import { selectorTools } from "./selector.js";
import { skillTools } from "./skill";
import { searchElementsTool } from "./snapshot";
import {
  closeTabTool,
  createNewTabTool,
  getAllTabsTool,
  getCurrentTabTool,
  getTabInfoTool,
  switchToTabTool,
  ungroupTabsTool,
} from "./tab";
import { downloadChatImagesTool, downloadImageTool } from "./tools/downloads";
import { uploadFileToInputTool } from "./tools/upload-file";

/**
 * All browser tools registered for AI use
 * Total: 62 tools — 7 tab + 8 UI + 4 page + 3 screenshot + 2 download +
 * 4 intervention + 6 skill + 3 devtools + 1 DOM Health + 5 apty +
 * 9 investigation + 1 selector + 3 investigation-aware network capture +
 * 6 Apty Client extension network inspection. Recompute this from the arrays below
 * rather than trusting this comment when auditing — it has gone stale
 * before (see PROJECT_PROGRESS.md's tool-registry audit).
 *
 * Disabled tools (per aipex):
 * - duplicate_tab (not in aipex)
 * - wait (replaced by computer tool's wait action)
 * - capture_screenshot_to_clipboard (not enabled in aipex default bundle)
 * - read_clipboard_image (P1 clipboard tool – not enabled by default; requires security review)
 * - get_clipboard_image_info (P1 clipboard tool – not enabled by default; requires security review)
 * - download_text_as_markdown (not enabled in aipex)
 * - download_current_chat_images (architecture issue, not enabled in aipex)
 * - organize_tabs (stub implementation, temporarily disabled until AI grouping is complete)
 */
type BrowserFunctionTool = FunctionTool<
  unknown,
  z.ZodObject<any, any>,
  unknown
>;

// Browser/Tab Management (7 tools)
// Note: organize_tabs temporarily disabled (stub/not shipped)
const tabToolGroup: BrowserFunctionTool[] = [
  getAllTabsTool,
  getCurrentTabTool,
  switchToTabTool,
  createNewTabTool,
  getTabInfoTool,
  closeTabTool,
  ungroupTabsTool,
];

// UI Operations (8 tools) - computer tool replaces visual XY tools
const uiToolGroup: BrowserFunctionTool[] = [
  searchElementsTool,
  clickTool,
  fillElementByUidTool,
  getEditorValueTool,
  fillFormTool,
  hoverElementByUidTool,
  uploadFileToInputTool,
  computerTool,
];

// Page Content (4 tools)
const pageToolGroup: BrowserFunctionTool[] = [
  getPageMetadataTool,
  scrollToElementTool,
  highlightElementTool,
  highlightTextInlineTool,
];

// Screenshot (3 tools)
const screenshotToolGroup: BrowserFunctionTool[] = [
  captureScreenshotTool,
  captureScreenshotWithHighlightTool,
  captureTabScreenshotTool,
];

// Download (2 tools)
const downloadToolGroup: BrowserFunctionTool[] = [
  downloadImageTool,
  downloadChatImagesTool,
];

// Intervention (4 tools)
const interventionToolGroup: BrowserFunctionTool[] =
  interventionTools as unknown as BrowserFunctionTool[];

// Skills (6 tools)
const skillToolGroup: BrowserFunctionTool[] =
  skillTools as unknown as BrowserFunctionTool[];

// DevTools / CDP diagnostics (3 tools)
const devToolsToolGroup: BrowserFunctionTool[] =
  devToolsTools as unknown as BrowserFunctionTool[];

// Apty DOM Health / DOM Readiness audit (1 tool)
const domHealthToolGroup: BrowserFunctionTool[] =
  domHealthTools as unknown as BrowserFunctionTool[];

// Apty integration (5 tools)
const aptyToolGroup: BrowserFunctionTool[] =
  aptyTools as unknown as BrowserFunctionTool[];

// Investigation lifecycle, timeline/evidence correlation, and the
// autonomous orchestrator's next-action recommendation (9 tools)
const investigationToolGroup: BrowserFunctionTool[] =
  investigationTools as unknown as BrowserFunctionTool[];

// Selector diagnostics (1 tool)
const selectorToolGroup: BrowserFunctionTool[] =
  selectorTools as unknown as BrowserFunctionTool[];

// Investigation-aware network capture (3 tools)
const networkCaptureToolGroup: BrowserFunctionTool[] =
  networkCaptureTools as unknown as BrowserFunctionTool[];

// Apty Client extension Service Worker network inspection (6 tools)
const extensionNetworkToolGroup: BrowserFunctionTool[] =
  extensionNetworkTools as unknown as BrowserFunctionTool[];

const browserFunctionTools: BrowserFunctionTool[] = [
  ...tabToolGroup,
  ...uiToolGroup,
  ...pageToolGroup,
  ...screenshotToolGroup,
  ...downloadToolGroup,
  ...interventionToolGroup,
  ...skillToolGroup,
  ...devToolsToolGroup,
  ...domHealthToolGroup,
  ...aptyToolGroup,
  ...investigationToolGroup,
  ...selectorToolGroup,
  ...networkCaptureToolGroup,
  ...extensionNetworkToolGroup,
] as const;

export const allBrowserTools: FunctionTool[] =
  browserFunctionTools as unknown as FunctionTool[];

/**
 * The same tools as `allBrowserTools`, grouped by category. Used by
 * `./tool-relevance.js` to expose only the tools relevant to a given
 * request instead of the entire registry — every tool below still exists
 * and is fully registered; this is only about what's *offered* to the
 * model for a specific message.
 */
export const browserToolGroups = {
  tabs: tabToolGroup,
  ui: uiToolGroup,
  page: pageToolGroup,
  screenshot: screenshotToolGroup,
  download: downloadToolGroup,
  intervention: interventionToolGroup,
  skill: skillToolGroup,
  devtools: devToolsToolGroup,
  domHealth: domHealthToolGroup,
  apty: aptyToolGroup,
  investigation: investigationToolGroup,
  selector: selectorToolGroup,
  networkCapture: networkCaptureToolGroup,
  extensionNetwork: extensionNetworkToolGroup,
} as const;

export type BrowserToolGroupName = keyof typeof browserToolGroups;

export type { BrowserFunctionTool };

// Note: takeSnapshotTool is not included in allBrowserTools as it's called internally
// Skills tools are enabled to match aipex tool set

// Export intervention tools separately for optional registration
export { interventionTools } from "./interventions/index.js";

interface ToolRegistryLike {
  register(tool: (typeof allBrowserTools)[number]): unknown;
}

/**
 * Register all default browser tools with a registry-like object
 */
export function registerDefaultBrowserTools<T extends ToolRegistryLike>(
  registry: T,
): T {
  for (const tool of allBrowserTools) {
    registry.register(tool);
  }
  return registry;
}

export type {
  ConversationRunContext,
  ToolRunContext,
} from "./tab-utils";
export {
  executeScriptInActiveTab,
  executeScriptInTab,
  getActiveTab,
  resolveDiagnosticTab,
} from "./tab-utils";
