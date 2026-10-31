/**
 * Reads the Ask Dapty chat from a source of calls: the Apty Client, which
 * records the widget's own calls (the chat POST and the stored chat files),
 * or a HAR file. Bodies go through the same deny list and redaction as the
 * content files (`readResourceBody`).
 */
import { getRedactionMode } from "../../runtime/redaction-mode.js";
import {
  loadBodyDenyList,
  readResourceBody,
} from "../extension-network-inspector.js";
import { matchingDenyEntry } from "../resource-body-utils.js";
import { ConfiguredServiceWorkerDiagnosticsProvider } from "../service-worker-diagnostics.js";
import type { AptyObservedResource } from "../types.js";
import { daptyEvidenceFromCalls, daptyKindOf } from "./dapty-parse.js";
import type { DaptyEvidence, RawDaptyCall } from "./dapty-types.js";
import { connectionFailure, type ResourceSource } from "./loader.js";

/** Chat calls and stored chats read at most, newest first. */
const MAX_CALLS = 20;

/**
 * A call as a source may describe it beyond the contract's fields: the
 * request body the Client records for an allow-listed call (older Clients
 * send none), and the Origin header a HAR keeps.
 */
export type DaptyResource = AptyObservedResource & {
  requestBody?: string;
  origin?: string;
};

const stringField = (resource: DaptyResource, key: "requestBody" | "origin") =>
  typeof resource[key] === "string" ? resource[key] : undefined;

/**
 * The chat calls a source holds, read through the deny list and redaction.
 * @internal
 */
export async function daptyCallsFrom(
  provider: ResourceSource,
  source: RawDaptyCall["source"],
): Promise<
  | { ok: true; calls: RawDaptyCall[] }
  | { ok: false; connection: DaptyEvidence["connection"] }
> {
  await getRedactionMode();
  const list = await provider.listResources();
  if (!list.ok) {
    return { ok: false, connection: connectionFailure(list).connection };
  }
  const denyList = await loadBodyDenyList();
  const relevant = list.resources
    .flatMap((resource) => {
      const kind = daptyKindOf(resource.url, resource.method);
      return kind ? [{ resource, kind }] : [];
    })
    .sort((a, b) => b.resource.timestamp - a.resource.timestamp)
    .slice(0, MAX_CALLS);

  const calls: RawDaptyCall[] = [];
  for (const { resource, kind } of relevant) {
    const denied = matchingDenyEntry(resource.url, denyList) !== null;
    const read = await readResourceBody(provider, resource, denyList);
    const requestBody = denied
      ? undefined
      : stringField(resource, "requestBody");
    const origin = stringField(resource, "origin");
    calls.push({
      source,
      kind,
      url: resource.url,
      method: resource.method,
      ...(resource.status !== undefined ? { status: resource.status } : {}),
      ...(resource.failed ? { failed: true } : {}),
      ...(resource.errorText ? { errorText: resource.errorText } : {}),
      ...(requestBody !== undefined ? { requestBody } : {}),
      ...(origin ? { origin } : {}),
      ...("body" in read && read.body && !read.body.isBinary
        ? { responseBody: read.body.text }
        : {}),
      timestamp: resource.timestamp,
    });
  }
  return { ok: true, calls };
}

/** The Ask Dapty chat from any source of calls. */
export async function loadDaptyFrom(
  provider: ResourceSource,
  source: RawDaptyCall["source"],
): Promise<DaptyEvidence> {
  const read = await daptyCallsFrom(provider, source);
  if (!read.ok) {
    return {
      source,
      connection: read.connection,
      turns: [],
      calls: 0,
      storedChats: 0,
      suggestionIds: true,
    };
  }
  return daptyEvidenceFromCalls(read.calls, source);
}

/** The Ask Dapty chat as the Apty Client recorded it, in extension mode. */
export function loadDaptyFromClient(
  extensionId: string | undefined,
): Promise<DaptyEvidence> {
  return loadDaptyFrom(
    new ConfiguredServiceWorkerDiagnosticsProvider({
      extensionId,
      peer: "client",
    }),
    "client",
  );
}
