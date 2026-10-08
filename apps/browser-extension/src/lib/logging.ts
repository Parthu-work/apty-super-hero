import {
  type AppSettings,
  type LogLevel,
  STORAGE_KEYS,
  setLogLevel,
} from "@apty/agent-core";

/**
 * Production builds log warnings and errors only; development builds log
 * everything. Settings → Troubleshooting → Verbose logging turns debug
 * output on in a production build, for extension pages and the service
 * worker. Content scripts can't read extension storage; one that adopts the
 * logger must call `initLogging({ followSettings: false })`.
 */
export function initLogging({ followSettings = true } = {}): void {
  const base: LogLevel = import.meta.env.DEV ? "debug" : "warn";
  setLogLevel(base);
  if (!followSettings || !chrome.storage?.local) return;

  const apply = (settings: unknown) =>
    setLogLevel(
      (settings as Partial<AppSettings> | undefined)?.verboseLogging
        ? "debug"
        : base,
    );

  chrome.storage.local
    .get(STORAGE_KEYS.SETTINGS)
    .then((result) => apply(result[STORAGE_KEYS.SETTINGS]))
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEYS.SETTINGS]) {
      apply(changes[STORAGE_KEYS.SETTINGS]?.newValue);
    }
  });
}
