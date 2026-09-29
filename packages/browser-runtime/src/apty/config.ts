/**
 * Apty integration configuration
 *
 * Extension IDs and diagnostic endpoints for Studio/Client/Service-Worker
 * integrations are deployment-specific and must never be hardcoded here —
 * they're placeholders until Apty engineering supplies real values.
 *
 * Source of truth at build time: apps/browser-extension/.env.example (copy to
 * .env and fill in). browser-ext seeds these into chrome.storage.local on
 * every service-worker startup (see
 * apps/browser-extension/src/entrypoints/background/lifecycle.ts), and this
 * module reads them back at call time — they can also be set later via the
 * Options UI without a rebuild.
 *
 * Reads and writes are all funneled through `enqueue()` below, which
 * serializes them into a single in-process chain. `chrome.storage.local`'s
 * get-then-set is not atomic; without this, two overlapping updates (e.g.
 * the service worker's own startup seeding racing an Options-page save)
 * could each read the same "before" state and the second write would
 * silently discard the first.
 */

const STORAGE_KEY = "apty-integration-config";

export interface AptyIntegrationConfig {
  studioExtensionId?: string;
  clientExtensionId?: string;
  serviceWorkerExtensionId?: string;
  serviceWorkerDiagnosticEndpoint?: string;
}

let writeQueue: Promise<unknown> = Promise.resolve();

/** Runs `run` only after every previously enqueued read/write has settled (success or failure), so storage access from this module is never interleaved. */
function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(run, run);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readConfig(): Promise<AptyIntegrationConfig> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as AptyIntegrationConfig | undefined) ?? {};
  } catch {
    return {};
  }
}

export async function getAptyIntegrationConfig(): Promise<AptyIntegrationConfig> {
  return enqueue(readConfig);
}

/** Replace the entire stored config. Prefer `updateAptyIntegrationConfig` for a partial change — this is for the rare case of writing a fully-formed object (e.g. a migration). */
export async function setAptyIntegrationConfig(
  config: AptyIntegrationConfig,
): Promise<void> {
  await enqueue(() => chrome.storage.local.set({ [STORAGE_KEY]: config }));
}

/**
 * Merge `patch` into the current stored config and return the result.
 * A key explicitly set to `undefined` in `patch` clears that key (e.g. the
 * Options UI's "disconnect" action) — this is a real, intentional merge,
 * not a seed; see `seedAptyIntegrationConfigDefaults` for "only fill what's
 * currently unset" semantics.
 */
export async function updateAptyIntegrationConfig(
  patch: Partial<AptyIntegrationConfig>,
): Promise<AptyIntegrationConfig> {
  return enqueue(async () => {
    const current = await readConfig();
    const next: AptyIntegrationConfig = { ...current, ...patch };
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  });
}

/**
 * Seed build-time defaults, filling in ONLY the keys that currently have no
 * stored value — never overwriting a value the user configured (or a prior
 * seed already established) with a new default, and never wiping a key with
 * `undefined` just because this build's `.env` doesn't set it. Safe to call
 * on every service-worker startup.
 */
export async function seedAptyIntegrationConfigDefaults(
  defaults: Partial<AptyIntegrationConfig>,
): Promise<AptyIntegrationConfig> {
  return enqueue(async () => {
    const current = await readConfig();
    const next: AptyIntegrationConfig = { ...current };
    for (const key of Object.keys(
      defaults,
    ) as (keyof AptyIntegrationConfig)[]) {
      const value = defaults[key];
      if (value === undefined) continue; // this build has no default for it
      if (next[key] !== undefined) continue; // already set — never override
      next[key] = value;
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  });
}
