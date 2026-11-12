/**
 * The one way to read the settings (KB-RAG K22, S2): what the SE stored in
 * chrome.storage.local, with the organization policy and the loaded KB
 * packs applied (`effectiveSettings` in agent-core). No other file reads
 * `STORAGE_KEYS.SETTINGS` from storage; tooling/scripts/check-settings-readers.mjs
 * fails the build if one does.
 *
 * Writes still go to chrome.storage.local, through `saveSettings`: a write
 * to a field the policy locks is ignored and logged.
 */
import {
  type AppSettings,
  createLogger,
  type EffectiveSettings,
  effectiveSettings,
  isDemoKbPack,
  type KeyValueStorage,
  migrateSettings,
  type OrgPolicyState,
  STORAGE_KEYS,
  settingsForWrite,
  type WatchCallback,
} from "@apty/agent-core";
import type { KbPackState } from "../kb/kb-trust.js";
import { createKbPackStore } from "../storage/kb-store.js";
import { loadOrgPolicy, watchOrgPolicy } from "./org-policy.js";

const log = createLogger("EffectiveSettings");

/** chrome.storage.local key bumped when a KB pack is imported or removed, so every page re-reads the packs. */
const KB_PACKS_CHANGED_KEY = "apty_kb_packs_changed";

/** What the effective settings are made from; tests give their own. */
export interface EffectiveSettingsDeps {
  storedSettings(): Promise<AppSettings>;
  writeSettings(settings: AppSettings): Promise<void>;
  policy(): Promise<OrgPolicyState>;
  /** The loaded packs, each with whether it is used (K23). */
  packs(): Promise<KbPackState[]>;
}

function localArea(): chrome.storage.StorageArea | undefined {
  return typeof chrome !== "undefined" ? chrome.storage?.local : undefined;
}

let packStore: ReturnType<typeof createKbPackStore> | undefined;

const browserDeps: EffectiveSettingsDeps = {
  async storedSettings() {
    const area = localArea();
    if (!area) return {};
    const stored = await area.get(STORAGE_KEYS.SETTINGS);
    return (stored?.[STORAGE_KEYS.SETTINGS] as AppSettings | undefined) ?? {};
  },
  async writeSettings(settings) {
    await localArea()?.set({ [STORAGE_KEYS.SETTINGS]: settings });
  },
  policy: loadOrgPolicy,
  async packs() {
    if (typeof indexedDB === "undefined") return [];
    packStore ??= createKbPackStore();
    return packStore.info();
  },
};

/**
 * The loaded packs, read once per page and kept until a pack is imported or
 * removed (`noteKbPacksChanged`): reading them opens IndexedDB, which must
 * not sit on the path of a save that a closing or reloading page waits on.
 * A read that fails is not kept, so the next read tries again.
 */
let packCache = new WeakMap<EffectiveSettingsDeps, Promise<KbPackState[]>>();
let packListener = false;

function listenForPackChanges(): void {
  if (packListener) return;
  const onChanged =
    typeof chrome !== "undefined" ? chrome.storage?.onChanged : undefined;
  if (!onChanged) return;
  packListener = true;
  onChanged.addListener((changes, area) => {
    if (area === "local" && KB_PACKS_CHANGED_KEY in changes) {
      packCache = new WeakMap();
    }
  });
}

function packsOf(
  deps: EffectiveSettingsDeps,
  fresh = false,
): Promise<KbPackState[]> {
  listenForPackChanges();
  const cached = fresh ? undefined : packCache.get(deps);
  if (cached) return cached;
  const read = deps.packs();
  packCache.set(deps, read);
  read.catch(() => {
    if (packCache.get(deps) === read) packCache.delete(deps);
  });
  return read;
}

/**
 * Whether a pack that is not a verified demo pack is loaded, used or not
 * (K23 P3: an unsigned or expired pack still raises the floor while it sits
 * in IndexedDB). A store that cannot be read counts as one: the floor it
 * implies is the safer side.
 */
async function nonDemoPackLoaded(deps: EffectiveSettingsDeps, fresh = false) {
  try {
    return (await packsOf(deps, fresh)).some((pack) => !isDemoKbPack(pack));
  } catch {
    return true;
  }
}

/**
 * The loaded KB packs' descriptions (no card text), each judged now: read
 * afresh every time, since trust and dates change after import (K23 P4).
 */
export function loadKbPackInfos(
  deps: EffectiveSettingsDeps = browserDeps,
): Promise<KbPackState[]> {
  return packsOf(deps, true);
}

/** The policy and pack state the settings were last merged with. */
interface Overlay {
  policy: OrgPolicyState;
  nonDemoPackLoaded: boolean;
}

async function loadOverlay(
  deps: EffectiveSettingsDeps,
  fresh = false,
): Promise<Overlay> {
  const [policy, nonDemo] = await Promise.all([
    deps.policy(),
    nonDemoPackLoaded(deps, fresh),
  ]);
  return { policy, nonDemoPackLoaded: nonDemo };
}

/** The settings to act on: stored, with the policy and the loaded packs applied. */
export async function loadEffectiveSettings(
  deps: EffectiveSettingsDeps = browserDeps,
): Promise<EffectiveSettings> {
  const [stored, overlay] = await Promise.all([
    deps.storedSettings(),
    loadOverlay(deps),
  ]);
  return effectiveSettings(stored, overlay.policy, overlay);
}

/** `loadEffectiveSettings()`'s settings alone, for a reader that needs no more. */
export async function loadSettings(): Promise<AppSettings> {
  return (await loadEffectiveSettings()).settings;
}

/**
 * Stores `next`, keeping each locked field's stored value; returns the
 * fields it ignored. The settings UI saves through `effectiveSettingsStorage`.
 * @internal
 */
export async function saveSettings(
  next: AppSettings,
  deps: EffectiveSettingsDeps = browserDeps,
): Promise<(keyof AppSettings)[]> {
  // One storage read and the cached overlay, then the write: a page that
  // saves and then closes or reloads must not lose it, so nothing slow
  // (IndexedDB) is on this path.
  const [stored, overlay] = await Promise.all([
    deps.storedSettings(),
    loadOverlay(deps),
  ]);
  const effective = effectiveSettings(stored, overlay.policy, overlay);
  const { settings, ignored } = settingsForWrite(stored, next, effective);
  if (ignored.length > 0) {
    log.warn(
      `Ignored a write to ${ignored.join(", ")}: set by your organization`,
    );
  }
  await deps.writeSettings(settings);
  return ignored;
}

/** Writes stored settings back in the current schema (run once per update). */
export async function upgradeStoredSettings(
  deps: EffectiveSettingsDeps = browserDeps,
): Promise<void> {
  const area = localArea();
  const stored = area
    ? (await area.get(STORAGE_KEYS.SETTINGS))?.[STORAGE_KEYS.SETTINGS]
    : await deps.storedSettings();
  if (stored === undefined) return;
  const { settings, changed } = migrateSettings(stored);
  if (changed) await deps.writeSettings(settings);
}

/** Tells every page the loaded KB packs changed (the redaction floor depends on them). */
export async function noteKbPacksChanged(): Promise<void> {
  await localArea()?.set({ [KB_PACKS_CHANGED_KEY]: Date.now() });
}

/**
 * Calls `onChange` with the effective settings whenever what they are made
 * of changes: the stored settings (merged at once with the last policy and
 * pack state, with no read), the policy or the loaded packs (re-read).
 */
export function watchEffectiveSettings(
  onChange: (effective: EffectiveSettings) => void,
  deps: EffectiveSettingsDeps = browserDeps,
): () => void {
  let live = true;
  let overlay: Overlay | undefined;
  // Each update takes a number; a re-read that a newer update overtook is
  // dropped, so an older value never overwrites a newer one.
  let latest = 0;
  const reload = () => {
    const mine = ++latest;
    void loadOverlay(deps, true)
      .then(async (next) => {
        overlay = next;
        const stored = await deps.storedSettings().catch(() => ({}));
        if (live && mine === latest) {
          onChange(effectiveSettings(stored, next.policy, next));
        }
      })
      .catch(() => undefined);
  };
  void loadOverlay(deps)
    .then((next) => {
      overlay ??= next;
    })
    .catch(() => undefined);
  const onChanged =
    typeof chrome !== "undefined" ? chrome.storage?.onChanged : undefined;
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ) => {
    if (area !== "local") return;
    if (KB_PACKS_CHANGED_KEY in changes) return reload();
    const change = changes[STORAGE_KEYS.SETTINGS];
    if (!change) return;
    if (!overlay) return reload();
    latest += 1;
    const stored = (change.newValue as AppSettings | undefined) ?? {};
    onChange(effectiveSettings(stored, overlay.policy, overlay));
  };
  onChanged?.addListener(listener);
  const stopPolicy = watchOrgPolicy(reload);
  return () => {
    live = false;
    onChanged?.removeListener(listener);
    stopPolicy();
  };
}

/**
 * A key-value store for the settings UI (`@apty/ui`, which cannot reach
 * Chrome): loading the settings key gives the effective settings, saving
 * it goes through `saveSettings`, and watching it hears the policy and the
 * packs too. Every other key passes through to `base`.
 */
export function effectiveSettingsStorage(
  base: KeyValueStorage<unknown>,
  deps: EffectiveSettingsDeps = browserDeps,
): KeyValueStorage<unknown> {
  return {
    async load(key) {
      if (key !== STORAGE_KEYS.SETTINGS) return base.load(key);
      return (await loadEffectiveSettings(deps)).settings;
    },
    async save(key, data) {
      if (key !== STORAGE_KEYS.SETTINGS) return base.save(key, data);
      await saveSettings(data as AppSettings, deps);
    },
    delete: (key) => base.delete(key),
    listAll: () => base.listAll(),
    query: (predicate) => base.query(predicate),
    watch(key, callback: WatchCallback<unknown>) {
      if (key !== STORAGE_KEYS.SETTINGS) return base.watch(key, callback);
      return watchEffectiveSettings(
        (effective) => callback({ newValue: effective.settings }),
        deps,
      );
    },
  };
}

/** @internal Forgets the cached packs and their change listener. */
export function resetEffectiveSettingsForTests(): void {
  packCache = new WeakMap();
  packListener = false;
}
