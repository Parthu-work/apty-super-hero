/**
 * The MAIN-world console bridge (which also installs DOM Health's
 * `pushState`/`attachShadow` hooks) as a dynamically registered content
 * script, so the user can turn it off or exclude sites (Settings →
 * Troubleshooting). It used to be a static `<all_urls>` content script in
 * the manifest, which nothing could switch off.
 *
 * The build emits the bridge at a fixed path (`CONSOLE_BRIDGE_FILE`, see
 * the extension's vite.config.ts); the service worker reconciles the
 * registration on install, update, startup and every settings change.
 * Registrations persist across browser sessions.
 */
import { type AppSettings, STORAGE_KEYS } from "@apty/agent-core";

export const CONSOLE_BRIDGE_SCRIPT_ID = "apty-console-bridge";
export const CONSOLE_BRIDGE_FILE = "content/console-bridge.js";

const MATCH_PATTERN =
  /^(\*|https?|file|ftp|wss?):\/\/(\*|\*\.[^/*:\s]+|[^/*:\s]+)?\/\S*$/;
const HOST = /^[a-z0-9.-]+$/i;

export interface PageHookSettings {
  pageHooksEnabled?: boolean;
  pageHooksExcludedSites?: string[];
}

/** Settings that exist but could not be read: the bridge stays off, since an exclusion might be missing. */
export const SETTINGS_UNREADABLE = "settings-unreadable" as const;

export type PageHookSettingsRead =
  | PageHookSettings
  | null
  | typeof SETTINGS_UNREADABLE;

function pageHooksEnabled(settings: PageHookSettingsRead): boolean {
  if (settings === SETTINGS_UNREADABLE) return false;
  return settings?.pageHooksEnabled !== false;
}

/**
 * `excludeMatches` for the excluded-sites list: a host excludes itself and
 * its subdomains on every scheme and port; a full match pattern is used as
 * written. Anything else is skipped and returned in `invalid` (one invalid
 * pattern would make Chrome reject the whole registration).
 * @internal
 */
export function excludeMatchesFor(sites: readonly string[]): {
  patterns: string[];
  invalid: string[];
} {
  const patterns: string[] = [];
  const invalid: string[] = [];
  for (const raw of sites) {
    const site = raw.trim();
    if (!site) continue;
    if (site.includes("://")) {
      if (MATCH_PATTERN.test(site)) patterns.push(site);
      else invalid.push(site);
    } else if (HOST.test(site)) {
      const host = site.toLowerCase().replace(/^\.+/, "");
      patterns.push(`*://${host}/*`, `*://*.${host}/*`);
    } else {
      invalid.push(site);
    }
  }
  return { patterns: [...new Set(patterns)], invalid };
}

/** Whether the bridge may run on `url`: the switch is on and no excluded host matches. Full match patterns in the list are honoured by Chrome's registration, not here. */
export function pageHooksAllowedOn(
  url: string | undefined,
  settings: PageHookSettingsRead,
): boolean {
  if (!pageHooksEnabled(settings) || settings === SETTINGS_UNREADABLE) {
    return false;
  }
  let host = "";
  try {
    host = new URL(url ?? "").hostname.toLowerCase();
  } catch {
    return false;
  }
  return !(settings?.pageHooksExcludedSites ?? []).some((raw) => {
    const site = raw.trim().toLowerCase().replace(/^\.+/, "");
    return (
      HOST.test(site) &&
      site !== "" &&
      (host === site || host.endsWith(`.${site}`))
    );
  });
}

/** @internal */
export function desiredRegistration(
  settings: PageHookSettingsRead,
): chrome.scripting.RegisteredContentScript | null {
  if (!pageHooksEnabled(settings) || settings === SETTINGS_UNREADABLE) {
    return null;
  }
  const { patterns } = excludeMatchesFor(
    settings?.pageHooksExcludedSites ?? [],
  );
  return {
    id: CONSOLE_BRIDGE_SCRIPT_ID,
    js: [CONSOLE_BRIDGE_FILE],
    matches: ["<all_urls>"],
    ...(patterns.length > 0 ? { excludeMatches: patterns } : {}),
    allFrames: true,
    matchOriginAsFallback: true,
    runAt: "document_start",
    world: "MAIN",
    persistAcrossSessions: true,
  };
}

function sameRegistration(
  a: chrome.scripting.RegisteredContentScript,
  b: chrome.scripting.RegisteredContentScript,
): boolean {
  const norm = (r: chrome.scripting.RegisteredContentScript) =>
    JSON.stringify({
      js: r.js ?? [],
      matches: r.matches ?? [],
      excludeMatches: [...(r.excludeMatches ?? [])].sort(),
      allFrames: r.allFrames ?? false,
      runAt: r.runAt ?? "document_idle",
      world: r.world ?? "ISOLATED",
    });
  return norm(a) === norm(b);
}

/** @internal */
export type PageHooksReconcileResult =
  | "registered"
  | "updated"
  | "unregistered"
  | "unchanged"
  | "failed";

async function loadSettings(): Promise<
  AppSettings | null | typeof SETTINGS_UNREADABLE
> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return (stored?.[STORAGE_KEYS.SETTINGS] as AppSettings | undefined) ?? null;
  } catch {
    return SETTINGS_UNREADABLE;
  }
}

let queue: Promise<PageHooksReconcileResult> = Promise.resolve("unchanged");

/**
 * Make the registered bridge match the settings. Calls are serialized.
 * @internal
 */
export function reconcilePageHooks(
  settings?: PageHookSettingsRead,
): Promise<PageHooksReconcileResult> {
  queue = queue.then(async () => {
    try {
      const desired = desiredRegistration(
        settings === undefined ? await loadSettings() : settings,
      );
      const [current] = await chrome.scripting.getRegisteredContentScripts({
        ids: [CONSOLE_BRIDGE_SCRIPT_ID],
      });
      if (!desired) {
        if (!current) return "unchanged";
        await chrome.scripting.unregisterContentScripts({
          ids: [CONSOLE_BRIDGE_SCRIPT_ID],
        });
        return "unregistered";
      }
      if (!current) {
        await chrome.scripting.registerContentScripts([desired]);
        return "registered";
      }
      if (sameRegistration(current, desired)) return "unchanged";
      // updateContentScripts can't clear excludeMatches, so replace it.
      await chrome.scripting.unregisterContentScripts({
        ids: [CONSOLE_BRIDGE_SCRIPT_ID],
      });
      await chrome.scripting.registerContentScripts([desired]);
      return "updated";
    } catch (error) {
      console.warn("[PageHooks] Could not register the console bridge:", error);
      return "failed";
    }
  });
  return queue;
}

/** Reconcile now and whenever the switch or the excluded-sites list changes. */
export function watchPageHookSettings(): void {
  void reconcilePageHooks();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const change = changes[STORAGE_KEYS.SETTINGS];
    if (!change) return;
    const before = change.oldValue as PageHookSettings | undefined;
    const after = change.newValue as PageHookSettings | undefined;
    if (
      pageHooksEnabled(before ?? null) !== pageHooksEnabled(after ?? null) ||
      JSON.stringify(before?.pageHooksExcludedSites ?? []) !==
        JSON.stringify(after?.pageHooksExcludedSites ?? [])
    ) {
      void reconcilePageHooks(after ?? null);
    }
  });
}
