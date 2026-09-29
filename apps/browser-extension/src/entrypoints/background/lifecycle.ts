/**
 * Extension lifecycle: seeding build-time Apty integration config on every
 * service-worker startup, and handling install/update.
 */

import { seedAptyIntegrationConfigDefaults } from "@apty/browser-runtime";

export function seedAptyIntegrationConfig(): void {
  // Seed Apty integration config (Studio/Client/Service-Worker extension IDs
  // and diagnostic endpoints) from build-time env vars into
  // chrome.storage.local, where the diagnostics tools read it at call time.
  // Runs on every service-worker startup so a rebuild's .env values take
  // effect without requiring a fresh install — but only fills keys that are
  // still unset, so it can never clobber a value the user configured via
  // Options (or a previous seed) with an empty/unset .env value.
  seedAptyIntegrationConfigDefaults({
    studioExtensionId:
      import.meta.env.VITE_APTY_STUDIO_EXTENSION_ID || undefined,
    clientExtensionId:
      import.meta.env.VITE_APTY_CLIENT_EXTENSION_ID || undefined,
    serviceWorkerExtensionId:
      import.meta.env.VITE_APTY_SERVICE_WORKER_EXTENSION_ID || undefined,
    serviceWorkerDiagnosticEndpoint:
      import.meta.env.VITE_APTY_SERVICE_WORKER_DIAGNOSTIC_ENDPOINT || undefined,
  }).catch((error) => {
    console.error("Failed to seed Apty integration config:", error);
  });
}

export function registerInstallHandler(): void {
  // Handle extension installation or update
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
      console.log("Apty Agent extension installed");
      chrome.runtime.openOptionsPage();
    } else if (details.reason === "update") {
      console.log(
        "Apty Agent extension updated to version",
        chrome.runtime.getManifest().version,
      );
    }
  });
}
