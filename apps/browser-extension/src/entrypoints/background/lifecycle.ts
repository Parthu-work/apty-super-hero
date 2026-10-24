/**
 * Extension lifecycle: seeding build-time Apty integration config on every
 * service-worker startup, and handling install/update.
 */

import { createLogger, migrateSettings, STORAGE_KEYS } from "@apty/agent-core";
import { seedAptyIntegrationConfigDefaults } from "@apty/browser-runtime";
import { ensureAgentSessionsMigrated } from "@apty/browser-runtime/storage/agent-session-store";
import { moveLegacyDatabases } from "@apty/browser-runtime/storage/legacy-databases";

const log = createLogger("Lifecycle");

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

let legacyStorageMove: Promise<void> | null = null;

/**
 * Moves data stored under the upstream AIPex names to the Apty ones. Calls
 * made while a move runs share it, so start-up and onInstalled never race.
 */
export function migrateLegacyStorage(): Promise<void> {
  legacyStorageMove ??= Promise.all([
    ensureAgentSessionsMigrated(),
    moveLegacyDatabases(),
  ])
    .then(() => undefined)
    .finally(() => {
      legacyStorageMove = null;
    });
  return legacyStorageMove;
}

/** Writes stored settings back in the current schema, once per update. */
async function upgradeStoredSettings(): Promise<void> {
  const key = STORAGE_KEYS.SETTINGS;
  const stored = (await chrome.storage.local.get(key))[key];
  if (stored === undefined) return;
  const { settings, changed } = migrateSettings(stored);
  if (changed) await chrome.storage.local.set({ [key]: settings });
}

export function registerInstallHandler(): void {
  // Handle extension installation or update
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
      log.debug("Apty Agent extension installed");
      chrome.runtime.openOptionsPage().catch(() => {
        console.warn("[Background] options_page_open_failed");
      });
    } else if (details.reason === "update") {
      log.debug(
        "Apty Agent extension updated to version",
        chrome.runtime.getManifest().version,
      );
      migrateLegacyStorage()
        .then(upgradeStoredSettings)
        .catch(() => {
          console.warn("[Background] settings_upgrade_failed");
        });
    }
  });
}
