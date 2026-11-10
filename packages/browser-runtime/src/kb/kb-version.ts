/**
 * The Apty version each site the user debugs runs, as the Agent knows it
 * (KB-RAG K12): from a check's files (`playerVersionOf`) when one has run,
 * else from the user's choice on the KB matches or verdict card. Kept in
 * the side panel's memory for its chat session, per site host; never
 * written to chrome.storage.
 */
import { siteHostOf } from "../conversation/site-host.js";
import type { KbTabVersion } from "./kb-index.js";

type Source = "evidence" | "user";

const known = new Map<string, { version: "4.x" | "5.x"; source: Source }>();

/** Records what a check's files or the user say; a check's files are not overridden by the user. */
export function rememberKbVersion(
  host: string | undefined,
  version: KbTabVersion,
  source: Source,
): void {
  if (!host) return;
  const current = known.get(host);
  if (source === "user" && current?.source === "evidence") return;
  if (version === "unknown") {
    if (source === "user") known.delete(host);
    return;
  }
  known.set(host, { version, source });
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
}
