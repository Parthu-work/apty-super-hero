/**
 * Background Service Worker
 * Handles extension lifecycle events and keyboard commands
 */

import { registerCommandHandlers } from "./commands";
import { registerGlobalDownloadHelper } from "./downloads";
import { registerInstallHandler, seedAptyIntegrationConfig } from "./lifecycle";
import { registerMcpBridge } from "./mcp-bridge";
import { registerMessageRouter } from "./message-router";
import {
  registerSidepanelActionClick,
  registerSidepanelPortLifecycle,
} from "./sidepanel";
import { lockdownStorageAccess } from "./storage-lockdown";

lockdownStorageAccess();
seedAptyIntegrationConfig();
registerSidepanelActionClick();
registerCommandHandlers();
registerInstallHandler();
registerSidepanelPortLifecycle();
registerMessageRouter();
registerGlobalDownloadHelper();
registerMcpBridge();

console.log("Apty Agent background service worker started");
