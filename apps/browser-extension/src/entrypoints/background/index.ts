/**
 * Background Service Worker
 * Handles extension lifecycle events and keyboard commands
 */

import { createLogger } from "@apty/agent-core";
import { watchPageHookSettings } from "@apty/browser-runtime/runtime/page-hooks-registration";
import { getRedactionMode } from "@apty/browser-runtime/runtime/redaction-mode";
import { initLogging } from "../../lib/logging";
import { registerCommandHandlers } from "./commands";
import { registerGlobalDownloadHelper } from "./downloads";
import { registerGlobalErrorHandlers } from "./global-errors";
import {
  migrateLegacyStorage,
  registerInstallHandler,
  seedAptyIntegrationConfig,
} from "./lifecycle";
import { registerMcpBridge } from "./mcp-bridge";
import { registerMessageRouter } from "./message-router";
import { registerSidepanelActionClick } from "./sidepanel";
import { lockdownStorageAccess } from "./storage-lockdown";

const log = createLogger("Background");

registerGlobalErrorHandlers();
initLogging();
lockdownStorageAccess();
// Settings are read only after data under the old AIPex names has moved (R2).
void migrateLegacyStorage()
  .catch(() => {
    console.warn("[Background] legacy_storage_migration_failed");
  })
  .then(() => {
    // Read the redaction mode now, so the first MCP tool result is redacted in it.
    void getRedactionMode();
    // Register the MAIN-world console bridge per Settings → Troubleshooting, on
    // every service-worker start (install, update, browser start) and change.
    watchPageHookSettings();
  });
seedAptyIntegrationConfig();
registerSidepanelActionClick();
registerCommandHandlers();
registerInstallHandler();
registerMessageRouter();
registerGlobalDownloadHelper();
registerMcpBridge();

log.debug("Apty Agent background service worker started");
