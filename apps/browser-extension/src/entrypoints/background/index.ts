/**
 * Background Service Worker
 * Handles extension lifecycle events and keyboard commands
 */

import { createLogger } from "@apty/agent-core";
import { initLogging } from "../../lib/logging";
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

const log = createLogger("Background");

initLogging();
lockdownStorageAccess();
seedAptyIntegrationConfig();
registerSidepanelActionClick();
registerCommandHandlers();
registerInstallHandler();
registerSidepanelPortLifecycle();
registerMessageRouter();
registerGlobalDownloadHelper();
registerMcpBridge();

log.debug("Apty Agent background service worker started");
