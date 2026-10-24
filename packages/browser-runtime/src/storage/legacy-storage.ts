import { STORAGE_KEYS } from "@apty/agent-core";

/**
 * chrome.storage.local keys the Agent stored under its upstream AIPex names,
 * and the names that replaced them. The input-mode and ZenFS keys are owned by
 * `apps/browser-extension/src/state/input-mode-context.tsx` and
 * `vm/migration.ts`; the names here must match theirs.
 * @internal
 */
export const LEGACY_KEY_RENAMES: Readonly<Record<string, string>> = {
  aipex_theme: STORAGE_KEYS.THEME,
  aipex_language: STORAGE_KEYS.LANGUAGE,
  aipex_settings: STORAGE_KEYS.SETTINGS,
  aipex_host_access_config: STORAGE_KEYS.HOST_ACCESS_CONFIG,
  aipex_automation_mode: STORAGE_KEYS.AUTOMATION_MODE,
  aipex_risky_origin_grants: STORAGE_KEYS.RISKY_ORIGIN_GRANTS,
  aipex_zenfs_migration_status: "apty_zenfs_migration_status",
  aipex_zenfs_migration_v2_status: "apty_zenfs_migration_v2_status",
  "aipex-input-mode": "apty-input-mode",
};

const OLD_KEY_BY_NEW = new Map(
  Object.entries(LEGACY_KEY_RENAMES).map(([oldKey, newKey]) => [
    newKey,
    oldKey,
  ]),
);

/** @internal */
export function legacyKeyFor(key: string): string | undefined {
  return OLD_KEY_BY_NEW.get(key);
}

export type StorageAreaLike = Pick<
  chrome.storage.StorageArea,
  "get" | "set" | "remove"
>;

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Move one key: copy it, read the copy back, and only then delete the old
 * key. A value already under the new name wins (a run interrupted after the
 * copy, or a write made since). Returns whether an old key was removed.
 */
async function moveKey(
  area: StorageAreaLike,
  oldKey: string,
  newKey: string,
): Promise<boolean> {
  const found = await area.get([oldKey, newKey]);
  if (found[oldKey] === undefined) return false;
  if (found[newKey] === undefined) {
    await area.set({ [newKey]: found[oldKey] });
    const copied = (await area.get(newKey))[newKey];
    if (!sameValue(copied, found[oldKey])) {
      throw new Error("legacy_storage_verify_failed");
    }
  }
  await area.remove(oldKey);
  return true;
}

/** Moves every legacy key; idempotent. Returns the old keys it removed. */
export async function migrateLegacyStorageKeys(
  area: StorageAreaLike = chrome.storage.local,
): Promise<string[]> {
  const moved: string[] = [];
  for (const [oldKey, newKey] of Object.entries(LEGACY_KEY_RENAMES)) {
    if (await moveKey(area, oldKey, newKey)) moved.push(oldKey);
  }
  return moved;
}

/** Moves one legacy key, for a reader that finds the new key empty. */
export async function migrateLegacyKey(
  key: string,
  area: StorageAreaLike = chrome.storage.local,
): Promise<boolean> {
  const oldKey = legacyKeyFor(key);
  return oldKey ? moveKey(area, oldKey, key) : false;
}
