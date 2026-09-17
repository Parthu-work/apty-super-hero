/**
 * Background Service Worker
 * Handles extension lifecycle events and keyboard commands
 */

import { registerCommandHandlers } from "./commands";
import { registerGlobalDownloadHelper } from "./downloads";
import { registerExternalMessaging } from "./external-messaging";
import { registerInstallHandler, seedAptyIntegrationConfig } from "./lifecycle";
import { registerMcpBridge } from "./mcp-bridge";
import { registerMessageRouter } from "./message-router";
import {
  registerSidepanelActionClick,
  registerSidepanelPortLifecycle,
} from "./sidepanel";

seedAptyIntegrationConfig();
registerSidepanelActionClick();
registerCommandHandlers();
registerInstallHandler();
registerSidepanelPortLifecycle();
registerMessageRouter();
registerGlobalDownloadHelper();
registerExternalMessaging();
registerMcpBridge();

console.log("AIPex background service worker started");
