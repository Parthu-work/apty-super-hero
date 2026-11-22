/**
 * The Apty version each site the user debugs runs, as the Agent knows it
 * (KB-RAG K12): from a check's files (`playerVersionOf`, the content CDN's
 * files included), the user's choice, the Apty Client's observed file names,
 * or a file name in the question.
 *
 * KB-RAG K29, B1: kept per site host on the device, in the extension's local
 * storage (`apty_kb_site_versions`: host, version, source and the day it was
 * last used), so a new chat or a panel reload keeps it. Loaded at start-up
 * (`whenKbVersionsLoaded`), followed across the extension's pages through
 * `chrome.storage.onChanged`, cleared by Options' Delete stored data now
 * (`clearKbVersions`), and an entry unused for 90 days is dropped. Never
 * sent anywhere.
 */
import { siteHostOf } from "../conversation/site-host.js";
import type { KbTabVersion } from "./kb-index.js";

/**
 * Where a site's version came from, strongest last: a file name in the
 * question (K29, B3), the Apty Client's observed file names (K27, F7), the
 * user's choice, or a check's files.
 */
export type KbVersionSource = "question" | "client" | "user" | "evidence";

const RANK: Record<KbVersionSource, number> = {
  question: 0,
  client: 1,
  user: 2,
  evidence: 3,
};

interface KbSiteVersion {
  version: "4.x" | "5.x";
  source: KbVersionSource;
  /** When the site's version was last set or used, in ms. */
  at: number;
}

/** @internal the storage key, for tests. */
export const KB_VERSIONS_KEY = "apty_kb_site_versions";
/** @internal how long an unused site is kept, for tests. */
export const KB_VERSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_SITES = 500;

const known = new Map<string, KbSiteVersion>();
const listeners = new Set<() => void>();

function storageArea(): chrome.storage.LocalStorageArea | undefined {
  try {
    return typeof chrome === "undefined" ? undefined : chrome.storage?.local;
  } catch {
    return undefined;
  }
}

const isSource = (value: unknown): value is KbVersionSource =>
  typeof value === "string" && value in RANK;

/** The stored entries that are well formed and used in the last 90 days. */
function parse(raw: unknown, now: number): Map<string, KbSiteVersion> {
  const sites = new Map<string, KbSiteVersion>();
  if (typeof raw !== "object" || raw === null) return sites;
  for (const [host, entry] of Object.entries(raw)) {
    const { version, source, at } = (entry ?? {}) as Record<string, unknown>;
    if (
      (version === "4.x" || version === "5.x") &&
      isSource(source) &&
      typeof at === "number" &&
      now - at < KB_VERSION_MAX_AGE_MS
    ) {
      sites.set(host, { version, source, at });
    }
  }
  return sites;
}

function replaceKnown(next: Map<string, KbSiteVersion>) {
  known.clear();
  for (const [host, entry] of next) known.set(host, entry);
  notify();
}

async function persist(): Promise<void> {
  const area = storageArea();
  if (!area) return;
  const now = Date.now();
  const kept = [...known.entries()]
    .filter(([, entry]) => now - entry.at < KB_VERSION_MAX_AGE_MS)
    .sort(([, a], [, b]) => a.at - b.at)
    .slice(-MAX_SITES);
  try {
    await area.set({ [KB_VERSIONS_KEY]: Object.fromEntries(kept) });
  } catch {
    // Kept for this panel only; the next change tries again.
  }
}

let loading: Promise<void> | undefined;

/** Reads the stored sites once; a site set before the load ends keeps its newer value. */
export function whenKbVersionsLoaded(): Promise<void> {
  loading ??= (async () => {
    const area = storageArea();
    if (!area) return;
    try {
      const items = await area.get(KB_VERSIONS_KEY);
      const stored = parse(items?.[KB_VERSIONS_KEY], Date.now());
      for (const [host, entry] of known) stored.set(host, entry);
      replaceKnown(stored);
    } catch {
      // Unreadable storage: the session starts with nothing known.
    }
    try {
      chrome.storage.onChanged?.addListener((changes, areaName) => {
        if (areaName !== "local" || !(KB_VERSIONS_KEY in changes)) return;
        replaceKnown(parse(changes[KB_VERSIONS_KEY]?.newValue, Date.now()));
      });
    } catch {
      // No change events: this page keeps its own copy.
    }
  })();
  return loading;
}

void whenKbVersionsLoaded();

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Records what a check's files, the user, the Client's file names or the
 * question say; a weaker source never overrides a stronger one. The user's
 * "Not sure" forgets a choice they made.
 */
export function rememberKbVersion(
  host: string | undefined,
  version: KbTabVersion,
  source: KbVersionSource,
): void {
  if (!host) return;
  const current = known.get(host);
  const now = Date.now();
  if (current && RANK[current.source] > RANK[source]) {
    known.set(host, { ...current, at: now });
    void persist();
    return;
  }
  if (version === "unknown") {
    if (source === "user" && current) {
      known.delete(host);
      notify();
      void persist();
    }
    return;
  }
  known.set(host, { version, source, at: now });
  notify();
  void persist();
}

/** Marks the site's version as used now, so it is kept another 90 days. */
export function touchKbVersion(host: string | undefined): void {
  const current = host ? known.get(host) : undefined;
  if (!host || !current) return;
  known.set(host, { ...current, at: Date.now() });
  void persist();
}

/** Called whenever a site's version changes; returns the unsubscribe. */
export function subscribeKbVersions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How the site's version was decided, or undefined when it is not known. */
export function kbVersionSourceForHost(
  host: string | undefined,
): KbVersionSource | undefined {
  return host ? known.get(host)?.source : undefined;
}

const FOUR_X_FILES = /(?:^|\/)(?:flows?|segments|rules)\.json$/i;
const FIVE_X_FILES = /(?:^|\/)(?:workflow|segment|rule)\.json$/i;

/**
 * The Apty version the Client's observed file names show (K13 markers):
 * flow.json, segments.json or rules.json mean 4.x; workflow.json,
 * segment.json or rule.json mean 5.x; both or neither, unknown.
 */
export function versionFromFileNames(names: readonly string[]): KbTabVersion {
  const four = names.some((name) => FOUR_X_FILES.test(name.trim()));
  const five = names.some((name) => FIVE_X_FILES.test(name.trim()));
  if (four === five) return "unknown";
  return four ? "4.x" : "5.x";
}

const asked = new Set<string>();

/**
 * Resolves `host`'s version from the Client's observed files, once per site
 * in the panel's session, when nothing has decided it yet (K27, F7).
 * `observedNames` gives undefined while no Client answers; it is asked
 * again on the next turn.
 */
export async function resolveKbVersionFromClient(
  host: string | undefined,
  observedNames: () => Promise<readonly string[] | undefined>,
): Promise<void> {
  await whenKbVersionsLoaded();
  if (!host || known.has(host) || asked.has(host)) return;
  const names = await observedNames().catch(() => undefined);
  if (!names) return;
  asked.add(host);
  rememberKbVersion(host, versionFromFileNames(names), "client");
}

export function kbVersionForHost(host: string | undefined): KbTabVersion {
  return (host ? known.get(host)?.version : undefined) ?? "unknown";
}

/** Whether the version for `host` came from a check's files, which the user's choice does not change. */
export function kbVersionFromEvidence(host: string | undefined): boolean {
  return host !== undefined && known.get(host)?.source === "evidence";
}

export function kbVersionForUrl(url: string | undefined): KbTabVersion {
  return kbVersionForHost(siteHostOf(url));
}

/** Options' Delete stored data now: forgets every site's version, here and on the device. */
export async function clearKbVersions(): Promise<void> {
  asked.clear();
  replaceKnown(new Map());
  try {
    await storageArea()?.remove(KB_VERSIONS_KEY);
  } catch {
    // Nothing stored to remove.
  }
}

/** @internal for tests: forgets the memory, not the device. */
export function forgetKbVersions(): void {
  known.clear();
  asked.clear();
}

/** @internal for tests: reads the device's store again. */
export function reloadKbVersionsForTests(): Promise<void> {
  loading = undefined;
  known.clear();
  asked.clear();
  return whenKbVersionsLoaded();
}
