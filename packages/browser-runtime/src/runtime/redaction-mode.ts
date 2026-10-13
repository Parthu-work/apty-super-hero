/**
 * The one place diagnostic data is redacted with the user's chosen mode
 * (Settings → Data handling → Redaction).
 *
 * Every caller in the side panel and the service worker goes through
 * `redactText` / `redactLogEntries` instead of calling `@apty/debug-contract`
 * directly; `redaction-mode.test.ts` fails if one does not. The mode is read
 * once from settings, kept in memory, and updated from
 * `chrome.storage.onChanged`, so redaction stays synchronous. Until the first
 * read completes it is "strict", the most protective mode.
 */
import {
  type AppSettings,
  type RedactionModeSetting,
  STORAGE_KEYS,
} from "@apty/agent-core";
import {
  type RedactionMode,
  redactJsonAware,
  redactLogs,
  redactSensitiveText,
} from "@apty/debug-contract";

const DEFAULT_MODE: RedactionMode = "strict";

let cached: RedactionMode | null = null;
let loading: Promise<RedactionMode> | null = null;
let listening = false;

export function parseRedactionMode(value: unknown): RedactionMode {
  return value === "standard" || value === "off" ? value : DEFAULT_MODE;
}

function modeFromSettings(settings: unknown): RedactionMode {
  return parseRedactionMode(
    (settings as AppSettings | undefined)?.redactionMode,
  );
}

function storageArea(): chrome.storage.StorageArea | null {
  return typeof chrome !== "undefined" && chrome.storage?.local
    ? chrome.storage.local
    : null;
}

function listenForChanges(): void {
  if (listening || typeof chrome === "undefined") return;
  const onChanged = chrome.storage?.onChanged;
  if (!onChanged) return;
  listening = true;
  onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const change = changes[STORAGE_KEYS.SETTINGS];
    if (change) cached = modeFromSettings(change.newValue);
  });
}

/** The current mode, read from settings on first use and cached after. */
export function getRedactionMode(): Promise<RedactionMode> {
  listenForChanges();
  if (cached !== null) return Promise.resolve(cached);
  loading ??= (async () => {
    try {
      const area = storageArea();
      const stored = area ? await area.get(STORAGE_KEYS.SETTINGS) : undefined;
      // A change event that arrived while reading is newer than the read.
      cached ??= modeFromSettings(stored?.[STORAGE_KEYS.SETTINGS]);
    } catch {
      cached ??= DEFAULT_MODE;
    }
    loading = null;
    return cached;
  })();
  return loading;
}

/** The cached mode, or "strict" while the first read is still pending (which this call starts). */
export function currentRedactionMode(): RedactionMode {
  if (cached === null) void getRedactionMode();
  return cached ?? DEFAULT_MODE;
}

/** Free text (console output, a body, a URL) redacted in the current mode. */
export function redactText(text: string): string {
  return redactSensitiveText(text, currentRedactionMode());
}

function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]),
    );
  }
  return value;
}

/**
 * A JSON object or array redacted by key and then string by string, so the
 * result is still valid JSON: the free-text passes can swallow a brace after a
 * key like "session". Anything else is redacted as text.
 */
export function redactJsonTextInMode(
  text: string,
  mode: RedactionMode,
): string {
  const trimmed = text.trim();
  const looksLikeJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!looksLikeJson) return redactSensitiveText(text, mode);
  try {
    JSON.parse(trimmed);
  } catch {
    return redactSensitiveText(text, mode);
  }
  const keyed: unknown = JSON.parse(redactJsonAware(trimmed, mode));
  return JSON.stringify(
    mapStrings(keyed, (leaf) => redactSensitiveText(leaf, mode)),
  );
}

/**
 * Only what is recognizable by its shape (tokens, keys, JWTs, bearer values,
 * emails), leaving surrounding prose and JSON keys alone: "off" mode does
 * not run the page-context key profiles but always runs these passes.
 */
export function redactStructuralSecrets(text: string): string {
  return redactSensitiveText(text, "off");
}

/** Log entries with each `message` redacted in the current mode. */
export function redactLogEntries<T extends { message: string }>(
  entries: T[],
): T[] {
  return redactLogs(entries, currentRedactionMode());
}

/** Text that leaves the device for someone else (a validation bundle): always strict, whatever the setting. */
export function redactTextStrict(text: string): string {
  return redactSensitiveText(text, "strict");
}

/** What `text` becomes in `mode`, for the Settings preview. Never used on real data. */
export function previewRedaction(
  text: string,
  mode: RedactionModeSetting,
): string {
  return redactSensitiveText(text, mode);
}

/** Test-only: forget the cached mode and the change listener. */
export function resetRedactionModeForTests(): void {
  cached = null;
  loading = null;
  listening = false;
}
