import { type AppSettings, DEFAULT_APP_SETTINGS } from "./settings.js";

/** One step of the stored-settings schema: upgrades settings at `version - 1` to `version`. */
export interface SettingsMigration {
  version: number;
  migrate: (settings: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Every schema change to the stored settings, oldest first. Settings saved
 * before versioning existed have no `settingsVersion` and count as version 0;
 * version 1 is that same shape, so its step changes nothing but the number.
 * Add a step here (never edit an old one) when a field is added with a value
 * that differs from its default, renamed, or removed.
 */
export const SETTINGS_MIGRATIONS: readonly SettingsMigration[] = [
  { version: 1, migrate: (settings) => settings },
];

export const SETTINGS_VERSION = Math.max(
  ...SETTINGS_MIGRATIONS.map((step) => step.version),
);

export interface MigratedSettings {
  settings: AppSettings;
  /** True when the stored value needs writing back. */
  changed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Brings stored settings up to the current schema. Idempotent; settings from
 * a newer version are returned as they are, never downgraded.
 */
export function migrateSettings(
  stored: unknown,
  migrations: readonly SettingsMigration[] = SETTINGS_MIGRATIONS,
): MigratedSettings {
  let settings: Record<string, unknown> = isRecord(stored) ? { ...stored } : {};
  const from =
    typeof settings.settingsVersion === "number" ? settings.settingsVersion : 0;
  const steps = [...migrations]
    .filter((step) => step.version > from)
    .sort((a, b) => a.version - b.version);
  for (const step of steps) {
    settings = { ...step.migrate(settings), settingsVersion: step.version };
  }
  return {
    settings: settings as AppSettings,
    changed: steps.length > 0 || !isRecord(stored),
  };
}

/** Fills every field the stored settings leave out with its default. */
export function withSettingsDefaults(
  settings: AppSettings,
  defaults: AppSettings = DEFAULT_APP_SETTINGS,
): AppSettings {
  const filled: Record<string, unknown> = { ...settings };
  for (const [key, value] of Object.entries(defaults)) {
    if (filled[key] === undefined) filled[key] = value;
  }
  return filled as AppSettings;
}
