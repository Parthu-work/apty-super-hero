/**
 * The Apty version each site the user debugs runs, as the Agent knows it
 * (KB-RAG K12): from a check's files (`playerVersionOf`) when one has run,
 * else from the user's choice on the KB matches or verdict card. Kept in
 * the side panel's memory for its chat session, per site host; never
 * written to chrome.storage.
 */
import { siteHostOf } from "../conversation/site-host.js";
import type { KbTabVersion } from "./kb-index.js";

/**
 * Where a site's version came from: a check's files, the user's choice, or
 * the Apty Client's observed file names (K27, F7). A check's files beat the
 * user, and the user beats the Client's file names.
 */
type Source = "evidence" | "user" | "client";

const RANK: Record<Source, number> = { client: 0, user: 1, evidence: 2 };

const known = new Map<string, { version: "4.x" | "5.x"; source: Source }>();
const listeners = new Set<() => void>();

/** Records what a check's files, the user or the Client's file names say; a weaker source never overrides a stronger one. */
export function rememberKbVersion(
  host: string | undefined,
  version: KbTabVersion,
  source: Source,
): void {
  if (!host) return;
  const current = known.get(host);
  if (current && RANK[current.source] > RANK[source]) return;
  if (version === "unknown") {
    if (source === "user") {
      known.delete(host);
      notify();
    }
    return;
  }
  known.set(host, { version, source });
  notify();
}

function notify() {
  for (const listener of listeners) listener();
}

/** Called whenever a site's version changes; returns the unsubscribe. */
export function subscribeKbVersions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How the site's version was decided, or undefined when it is not known. */
export function kbVersionSourceForHost(
  host: string | undefined,
): Source | undefined {
  return host ? known.get(host)?.source : undefined;
}

const FOUR_X_FILES = /(?:^|\/)(?:flows?|segments|rules)\.json$/i;
const FIVE_X_FILES = /(?:^|\/)(?:workflow|segment|rule)\.json$/i;

/**
 * The Apty version the Client's observed file names show (K13 markers):
 * flow.json, segments.json or rules.json mean 4.x; workflow.json,
 * segment.json or rule.json mean 5.x; both or neither, unknown.
 * @internal exported for tests
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

/** @internal for tests. */
export function forgetKbVersions(): void {
  known.clear();
  asked.clear();
}
