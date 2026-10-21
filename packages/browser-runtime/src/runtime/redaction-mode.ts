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
  MAX_REDACT_INPUT_LENGTH,
  type RedactionMode,
  redactJsonAware,
  redactLogs,
  redactSensitiveText,
  unboundedPatternMatches,
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

/** The most JSON text `redactLargeJsonText` takes on; bounds the work. */
export const MAX_LARGE_JSON_CHARS = 2_000_000;

export type LargeJsonRedaction =
  | { ok: true; text: string }
  | {
      ok: false;
      reason: "not-json" | "string-too-large" | "too-large" | "crosses-members";
    };

class StringTooLarge extends Error {}

const REDACTED = "<REDACTED>";

/** `[key, value]` as it reads once the whole-text redactor has seen it with its key; invalid JSON after redaction is replaced whole. */
function redactMember(
  key: string | undefined,
  value: unknown,
  mode: RedactionMode,
  containerLimit: number,
): [string | undefined, unknown] {
  const snippet =
    key === undefined
      ? JSON.stringify([value])
      : JSON.stringify({ [key]: value });
  const isContainer = typeof value === "object" && value !== null;
  if (
    snippet.length <= MAX_REDACT_INPUT_LENGTH &&
    (!isContainer || snippet.length <= containerLimit)
  ) {
    try {
      const parsed: unknown = JSON.parse(redactSensitiveText(snippet, mode));
      if (key === undefined && Array.isArray(parsed) && parsed.length === 1) {
        return [undefined, parsed[0]];
      }
      if (
        key !== undefined &&
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        const [entry] = Object.entries(parsed);
        if (entry) return [entry[0], entry[1]];
      }
    } catch {
      // Redaction left something that is not JSON: the member is replaced whole.
    }
    return [
      key === undefined ? undefined : redactMemberKey(key, mode),
      REDACTED,
    ];
  }
  if (!isContainer) throw new StringTooLarge();
  if (key === undefined) {
    return [undefined, redactChildren(value as object, mode, containerLimit)];
  }
  // The whole-text pass masks what follows a key it finds sensitive by
  // name (`"auth":[123,` loses its `[123`); a container split apart would
  // not, so one under such a key is replaced whole.
  if (isSensitiveByName(key, mode)) {
    return [redactMemberKey(key, mode), REDACTED];
  }
  const keyed = keyedContainer(key, value as object, mode);
  return [
    redactMemberKey(key, mode),
    keyed === value
      ? redactChildren(value as object, mode, containerLimit)
      : keyed,
  ];
}

/** A key as the whole-text redactor would leave it: only what it recognizes in the key's own text. */
function redactMemberKey(key: string, mode: RedactionMode): string {
  const literal = JSON.stringify(key);
  if (literal.length > MAX_REDACT_INPUT_LENGTH) throw new StringTooLarge();
  try {
    const redacted: unknown = JSON.parse(redactSensitiveText(literal, mode));
    if (typeof redacted === "string") return redacted;
  } catch {
    // Fall through to the placeholder.
  }
  return REDACTED;
}

const PROBE = '"PROBE"';

/**
 * Whether some string (key or value) ends so that the free-text key/value
 * pass would carry on past its closing quote (`"... auth="` followed by
 * `,123`): in the whole text that masks what follows, which redacting the
 * members apart would not.
 */
function someStringRunsOn(node: unknown): boolean {
  const runsOn = (text: string) => {
    const literal = JSON.stringify(text).slice(1, -1);
    if (literal.length + PROBE.length + 1 > MAX_REDACT_INPUT_LENGTH) {
      throw new StringTooLarge();
    }
    return !redactSensitiveText(`"${literal}${PROBE}`, "off").includes(PROBE);
  };
  if (typeof node === "string") return runsOn(node);
  if (Array.isArray(node)) return node.some(someStringRunsOn);
  if (typeof node === "object" && node !== null) {
    return Object.entries(node).some(
      ([key, value]) => runsOn(key) || someStringRunsOn(value),
    );
  }
  return false;
}

/** Whether the free-text key/value pass masks a value under `key`. */
function isSensitiveByName(key: string, mode: RedactionMode): boolean {
  const probe = JSON.stringify({ [key]: "probe-value" });
  return !redactSensitiveText(probe, mode).includes("probe-value");
}

/** What the key-based pass makes of a container under `key`: the container itself, or its replacement when the key is sensitive. */
function keyedContainer(
  key: string,
  value: object,
  mode: RedactionMode,
): unknown {
  const probe = JSON.parse(
    redactJsonAware(
      JSON.stringify({ [key]: Array.isArray(value) ? [] : {} }),
      mode,
    ),
  ) as Record<string, unknown>;
  const replaced = Object.values(probe)[0];
  return typeof replaced === "object" && replaced !== null ? value : replaced;
}

function redactChildren(
  node: object,
  mode: RedactionMode,
  containerLimit: number,
): unknown {
  if (Array.isArray(node)) {
    return node.map(
      (item) => redactMember(undefined, item, mode, containerLimit)[1],
    );
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => {
      const [redactedKey, redacted] = redactMember(
        key,
        value,
        mode,
        containerLimit,
      );
      return [redactedKey ?? key, redacted];
    }),
  );
}

/**
 * A JSON body longer than `redactSensitiveText` takes whole (it refuses
 * input over MAX_REDACT_INPUT_LENGTH), redacted member by member: each
 * object property (key and value together) or array item is run through
 * that same redactor as a small JSON text of its own, and a container whose
 * text is still too long is split the same way. Nothing is cut off.
 *
 * It must never show what redacting the whole text would hide, so where the
 * two could differ it is stricter or refuses: a member the redactor leaves
 * as invalid JSON is replaced whole, as is a split container under a key the
 * key/value pass masks, and a body is refused when it is not JSON, is longer
 * than MAX_LARGE_JSON_CHARS, holds one string the redactor can't take, or
 * has a match that would run from one member into the next (a PEM block,
 * URL userinfo, or a string ending in `token=`). large-json-equivalence.test.ts
 * compares it with whole-text redaction.
 *
 * `containerLimit` splits containers longer than that (default: only those
 * too long to redact whole); tests lower it to split small bodies.
 */
export function redactLargeJsonText(
  text: string,
  mode: RedactionMode,
  containerLimit: number = MAX_REDACT_INPUT_LENGTH,
): LargeJsonRedaction {
  if (text.length > MAX_LARGE_JSON_CHARS)
    return { ok: false, reason: "too-large" };
  const trimmed = text.trim();
  const looksLikeJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!looksLikeJson) return { ok: false, reason: "not-json" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: "not-json" };
  }
  // A PEM block or URL userinfo match spanning two members is masked by the
  // whole-text pass but by neither member alone: such a body is refused.
  const keyed = redactJsonAware(JSON.stringify(parsed), mode);
  if (unboundedPatternMatches(keyed).some((match) => match.includes('"'))) {
    return { ok: false, reason: "crosses-members" };
  }
  try {
    if (someStringRunsOn(parsed)) {
      return { ok: false, reason: "crosses-members" };
    }
    return {
      ok: true,
      text: JSON.stringify(
        redactChildren(parsed as object, mode, containerLimit),
      ),
    };
  } catch (error) {
    if (error instanceof StringTooLarge)
      return { ok: false, reason: "string-too-large" };
    throw error;
  }
}

/** A JSON body too long for `redactText`, redacted member by member in the current mode; undefined when it cannot be (see `redactLargeJsonText`). */
export function redactLargeJson(text: string): string | undefined {
  const redacted = redactLargeJsonText(text, currentRedactionMode());
  return redacted.ok ? redacted.text : undefined;
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
