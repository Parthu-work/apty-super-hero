/**
 * Apty integration configuration
 *
 * Extension IDs and diagnostic endpoints for Studio/Widget/Client/Service-
 * Worker integrations are deployment-specific and must never be hardcoded
 * here — they're placeholders until Apty engineering supplies real values.
 *
 * Source of truth at build time: packages/browser-ext/.env.example (copy to
 * .env and fill in). browser-ext seeds these into chrome.storage.local on
 * install/startup (see packages/browser-ext/src/background.ts), and this
 * module reads them back at call time — which also means they can be
 * updated later via an Options UI without a rebuild, if that's added.
 */

const STORAGE_KEY = "apty-integration-config";

export interface AptyIntegrationConfig {
  studioExtensionId?: string;
  widgetExtensionId?: string;
  clientExtensionId?: string;
  serviceWorkerExtensionId?: string;
  serviceWorkerDiagnosticEndpoint?: string;
}

export async function getAptyIntegrationConfig(): Promise<AptyIntegrationConfig> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as AptyIntegrationConfig | undefined) ?? {};
  } catch {
    return {};
  }
}

export async function setAptyIntegrationConfig(
  config: AptyIntegrationConfig,
): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}
