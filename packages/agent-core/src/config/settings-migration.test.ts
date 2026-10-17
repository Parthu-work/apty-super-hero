import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS } from "./settings.js";
import {
  migrateSettings,
  SETTINGS_VERSION,
  type SettingsMigration,
  withSettingsDefaults,
} from "./settings-migration.js";

/** A history in which v2 adds a field, v3 renames one and v4 removes one. */
const history: SettingsMigration[] = [
  { version: 1, migrate: (s) => s },
  { version: 2, migrate: (s) => ({ ...s, auditDepth: "page" }) },
  {
    version: 3,
    migrate: ({ verboseLogging, ...rest }) => ({
      ...rest,
      debugLogging: verboseLogging,
    }),
  },
  {
    version: 4,
    migrate: ({ legacyVoice: _removed, ...rest }) => rest,
  },
];

describe("migrateSettings", () => {
  it("marks unversioned settings as the current version and keeps every field", () => {
    const { settings, changed } = migrateSettings({
      aiToken: "key",
      redactionMode: "standard",
    });

    expect(settings).toEqual({
      aiToken: "key",
      redactionMode: "standard",
      settingsVersion: SETTINGS_VERSION,
    });
    expect(changed).toBe(true);
  });

  it("takes the provider type of old flat settings from their provider, never the default", () => {
    const { settings } = migrateSettings({
      aiProvider: "anthropic",
      aiToken: "sk-ant-key",
      aiModel: "claude-x",
    });
    expect(settings.providerType).toBe("claude");
    expect(
      withSettingsDefaults(migrateSettings({ aiProvider: "google" }).settings)
        .providerType,
    ).toBe("google");
    expect(
      migrateSettings({ aiProvider: "anthropic", providerType: "openai" })
        .settings.providerType,
    ).toBe("openai");
    expect(
      migrateSettings({ aiProvider: "not-a-provider" }).settings.providerType,
    ).toBeUndefined();
  });

  it("leaves current settings alone", () => {
    const current = { aiToken: "key", settingsVersion: SETTINGS_VERSION };

    expect(migrateSettings(current)).toEqual({
      settings: current,
      changed: false,
    });
  });

  it("adds a field introduced in a later version", () => {
    const { settings } = migrateSettings({ settingsVersion: 1 }, history);

    expect(settings).toMatchObject({ auditDepth: "page", settingsVersion: 4 });
  });

  it("renames a field, keeping its value", () => {
    const { settings } = migrateSettings(
      { settingsVersion: 2, verboseLogging: true },
      history,
    );

    expect(settings).toMatchObject({ debugLogging: true });
    expect(settings).not.toHaveProperty("verboseLogging");
  });

  it("removes a field that no longer exists", () => {
    const { settings } = migrateSettings(
      { settingsVersion: 3, legacyVoice: "on", aiModel: "m" },
      history,
    );

    expect(settings).toEqual({ aiModel: "m", settingsVersion: 4 });
  });

  it("runs every step in order from version 0", () => {
    const { settings } = migrateSettings(
      { verboseLogging: false, legacyVoice: "on" },
      [...history].reverse(),
    );

    expect(settings).toEqual({
      auditDepth: "page",
      debugLogging: false,
      settingsVersion: 4,
    });
  });

  it("is idempotent", () => {
    const once = migrateSettings({ verboseLogging: true }, history).settings;

    expect(migrateSettings(once, history)).toEqual({
      settings: once,
      changed: false,
    });
  });

  it("never downgrades settings written by a newer version", () => {
    const newer = { settingsVersion: 99, futureField: 1 };

    expect(migrateSettings(newer, history)).toEqual({
      settings: newer,
      changed: false,
    });
  });

  it("starts from nothing when storage holds something that isn't settings", () => {
    for (const stored of [null, undefined, "x", 3, []]) {
      expect(migrateSettings(stored)).toEqual({
        settings: { settingsVersion: SETTINGS_VERSION },
        changed: true,
      });
    }
  });
});

describe("withSettingsDefaults", () => {
  it("fills missing fields with their defaults and keeps stored values", () => {
    const filled = withSettingsDefaults({ redactionMode: "off", aiToken: "k" });

    expect(filled).toMatchObject({
      redactionMode: "off",
      aiToken: "k",
      screenshotPolicy: DEFAULT_APP_SETTINGS.screenshotPolicy,
      pageHooksEnabled: true,
      customModels: [],
    });
  });

  it("treats an explicit false or empty value as set", () => {
    const filled = withSettingsDefaults({
      pageHooksEnabled: false,
      pageHooksExcludedSites: [],
    });

    expect(filled.pageHooksEnabled).toBe(false);
  });
});
